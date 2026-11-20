# Architecture and failure recovery

The API, Vite bundle, MongoDB and Redis use a single public origin. The API serves the compiled SPA and JSON/SSE on `/api/v1`. MongoDB and Redis are reachable on the private Compose network. A reverse proxy can terminate TLS in production.

## Data and indexes

| Collection | Contents | Indexes beyond the primary key |
| --- | --- | --- |
| `users` | Creator account and bcrypt hash | Unique normalized email |
| `auth_sessions` | Hash of opaque random token, user ID, expiry | TTL on expiry. The app independently enforces expiry on every lookup. |
| `polls` | Ownership, schedule, immutable published choices, counts, version and pending projection marker | Unique slug, owner/created/ID, pending/dirty timestamp/ID |
| `votes` | Durable poll, identity, choice and timestamp | Unique poll/identity, poll/timestamp |
| `rooms` | Ordered question references, public room code, host revision, current question and deadline | Unique code, owner/created/ID |

Redis uses one expiring string per poll projection and a shared notification channel. Room presence uses an expiring sorted set of guest hashes. Rate limiter keys expire at the end of their fixed window.

## Vote acceptance and projection

1. Parse and bound the payload. Resolve the server-issued browser identity or authenticated account, depending on the poll rule.
2. Start a majority-commit MongoDB transaction. Conditionally increment the poll count and version while it accepts votes, and set its projection marker. Insert a uniquely indexed vote in the same transaction. If the insert conflicts, MongoDB rolls back the increment.
3. The worker scans pending polls every 300 ms in batches of 64. Each row holds the complete current counts. This coalesces writes and bounds outbox storage to one marker per poll. The worker publishes to Redis and clears the marker with a compare-and-set on the exact poll version.
4. A Lua script replaces the cached snapshot and publishes a poll/version notification when the incoming revision is newer, or when the cache key is missing. Ordering uses 19-digit decimal strings. Replays can replace a missing key, and no Redis operation increments vote totals.
5. Each API replica uses one Redis subscription. It coalesces wakeups into one slot per listener. SSE sends fresh snapshots, checks access and lifecycle on each read, and rechecks every ten seconds to repair missed notifications. Clients ignore lower versions. Schedule transitions can update state at the same version.

MongoDB provides durable transaction isolation across close, vote and host operations involving the same poll document. Scheduled start and expiry are evaluated from stored timestamps, so they survive process restarts. Admission uses the transaction attempt's server time. A vote accepted just before expiry can commit after it. Keep replica clocks synchronized.

## Recovery and trade-offs

- Redis loss leaves the MongoDB ledger and aggregate intact. The next snapshot read seeds the missing key from the aggregate. The worker retries dirty polls until published. On cancellation between Redis mutation and MongoDB acknowledgement, the same revision can be retried safely.
- Pub/Sub can lose messages. A reconnect always starts with a snapshot. A heartbeat repairs missed updates even when the connection stays alive. During a prolonged dependency outage, the UI can show its last known result with a reconnecting state.
- Accepted ballots are never read as a collection in the vote path. The poll aggregate is a contention point for a single hot poll. The API performs indexed MongoDB checks on each stream wakeup for authorization, schedule and version consistency. The 512-stream process cap protects connection and memory budgets. Benchmark before raising it.
- Room actions use a durable room version and update the active poll in the same transaction. Redis room notifications can be lost, and the same heartbeat repairs them. A poll is reserved to its first live room. Duplicate a poll to reuse it in another room.
- Hourly analytics scan an indexed seven-day range of durable votes. Choices and CSV totals use the durable aggregate. Analytics may briefly show a newer time-series total than its aggregate because they are separate reads.
- Guest voting deduplicates one signed browser cookie for its lifetime. Signed-in-only polls deduplicate accounts. Cookie deletion, expiry, and multiple devices/accounts are outside this guarantee.
- MongoDB must support transactions. For production use a managed replica set, majority writes, backups, monitoring and database access controls.

References: [MongoDB Go driver transactions](https://www.mongodb.com/docs/drivers/go/current/crud/transactions/) · [Redis Pub/Sub delivery semantics](https://redis.io/docs/latest/develop/interact/pubsub/)
