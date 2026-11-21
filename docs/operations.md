# Operations and deployment

## Local

Run `docker compose up -d --build --wait` and visit `http://localhost:8080`. Compose starts a single-node MongoDB replica set, ephemeral Redis, the web/API container and the projection worker. MongoDB persists in the Compose volume. Stop with `docker compose down`.

Create a local `.env` from `.env.example` to override defaults. If changing the published port, also set `APP_ORIGIN` to match. For Vite hot reload, set `APP_ORIGIN=http://localhost:5173` on the API, recreate it, then run `npm ci` and `npm run dev` from `frontend/`. Vite proxies the API and SSE to port 8080.

## Public hosting

1. Provision a managed MongoDB replica set with a dedicated database user and backups. Provision a Redis service that supports TLS, EVAL, Pub/Sub and sorted sets. Put the app and data services in close regions.
2. In a container hosting provider such as Render, create a Docker web service from the GitHub repository's `main` branch. The root Dockerfile builds the SPA and Go binaries. Use the default entrypoint and configure `/api/v1/ready` as its health check.
3. Set `APP_ORIGIN` to the exact HTTPS URL, `COOKIE_SECURE=true`, `MONGO_URI`, `MONGO_DB`, `REDIS_URL`, and `GUEST_SECRET` from a secret generator. Generate a stable secret, for example with `openssl rand -hex 32`. Restrict network access to the hosted workload and retain the same guest key across replicas and releases.
4. Set `RUN_WORKER=true` to run the worker inside the API process, or start a second service from the image with entrypoint `/usr/local/bin/worker` and the same data/secrets configuration. Use one of these setups. Multiple projection workers can safely retry updates.
5. On a reverse proxy disable SSE buffering and allow idle time longer than the ten-second heartbeat. Configure trusted proxy CIDRs only when verified for your platform.
6. Verify `/api/v1/health` and `/api/v1/ready` through the actual URL. Exercise signup, create, share, vote and live updates from two independent browsers. Confirm secure cookies and that an untrusted Origin receives 403. Point Playwright at a clean staging deployment with `BASE_URL`.

Provider references: [Render Docker](https://render.com/docs/docker) · [Render health checks](https://render.com/docs/health-checks) · [Render environment variables](https://render.com/docs/configure-environment-variables)

## V2 deployment notes

The evaluation deployment runs on a free Render Docker web service, MongoDB Atlas and Upstash Redis in Oregon. Atlas allows Render's Oregon outbound ranges, and the application database user has read/write permission scoped to `pulsex`. Upstash uses a TLS connection. Render stores the deployment secrets in the web service environment. [Public app](https://pulsex-sanjayram.onrender.com) · [Hosted verification](v2-verification.md)

Deploy the web API and projection worker from the same V2 image. V1 documents continue to load without a data migration. Coordinate the upgrade so old workers do not process new question types. The startup index setup adds the quiz, Q&A, moderation, and demo expiration indexes.

Render can run the web image with the internal worker enabled. Its free web instances can spin down, so a free setup is suitable for an evaluation preview. For an always-on deployment, use a paid container service with transaction-capable MongoDB and a Redis endpoint supporting Lua, Pub/Sub and sorted sets. Confirm the offered database limits before selecting tiers. [Render free instances](https://render.com/docs/free) · [Render pricing](https://render.com/pricing) · [MongoDB Atlas free limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)

Verify a public URL with two browser contexts. Confirm HTTPS cookies, an unbuffered SSE stream, reconnect after interruption, and an active projection worker. Authenticated hosting and data-service access are required.

## Incident checks

- **Readiness failure**: Check database network, replica-set primary, Redis URL and TLS. Liveness checks only the HTTP server.
- **Stale results**: Inspect worker logs for projection retries, check pending projection markers and Redis capacity. Open the results snapshot endpoint to trigger reconciliation. Never alter the durable counter without validating it against the vote ledger.
- **Stream disconnects**: Verify the proxy preserves chunked streaming, allows the heartbeat and isn't caching API responses. Check the replica's stream cap and dependency health.
- **Spiky vote latency**: Check MongoDB transaction retries on hot polls, round-trip latency, CPU and connection limits before increasing concurrency.
- **Restore**: Restore MongoDB and verify ledger/aggregate consistency. Start restored data against an empty Redis namespace. A MongoDB restore to an earlier revision requires discarding the old Redis projections.
