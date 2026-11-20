# Security review

| Threat | Control | Residual risk |
| --- | --- | --- |
| Leaked login tokens | Random 256-bit opaque tokens, hashes stored in MongoDB, seven-day expiry, HttpOnly and SameSite=Lax cookies. Secure cookies and HSTS on HTTPS. | Email verification, password reset, MFA, and a multi-device session screen are outside V1. |
| CSRF and cross-origin writes | Same-origin architecture, exact configured Origin on mutating API requests, no cross-origin grants. | Reverse proxies must preserve Origin. |
| Unauthorized creator access | Resource queries scope IDs by session owner. Public payloads expose poll and room data intended for the audience. | Share links and room codes are invitations. Use account-required voting when browser identity is insufficient. |
| Duplicate, wrong-choice, or late vote | Strict choice validation, durable unique poll/identity index, transaction state filter and atomic vote ledger/aggregate update. | Multiple browsers or accounts can represent one person. |
| Password flooding | Redis per-IP limits, bounded bcrypt concurrency, equivalent work for unknown login emails. | Distributed credential stuffing needs edge controls and monitoring. |
| Client input and output injection | JSON type and body-size limits, MongoDB filters assembled from typed values, React escaping, CSP, and CSV formula neutralization. | Text can still contain misleading human-readable messages. |
| Spoofed forwarded IP | Forwarded headers are ignored unless immediate peer matches `TRUSTED_PROXY_CIDRS`. | When proxy addresses are unconfigured, clients behind the proxy share its rate limit. Use documented trusted proxy CIDRs or enforce per-client limits at the edge. |
| Secret or PII logs | Structured logs include route template, status and duration, without raw URLs, request bodies, cookies or credential-bearing database errors. | Secure access to hosting and database logs independently. |

## V2 controls

- Quiz answer keys stay in owner-only configuration until the configured reveal. Rejoining returns only the caller's player ID and alias. Duplicate answers roll back the player and round counters.
- Quiz exports omit aliases. Named players are told their name will appear in the room leaderboard.
- Q&A owner access is checked on each stream read. The public query selects approved documents only and returns no identity hashes. The unique upvote key and room transaction protect the counter.
- Word clouds accept bounded plain text, normalize compatibility characters and whitespace, and require manual approval before display. The public snapshot and export contain approved phrases only.
- The demo endpoint is rate-limited. A demo has no creator owner and expires after one hour. Demo-only TTL indexes cannot match regular documents without an expiration field.

## Operational checks

Use `go vet ./...`, `govulncheck ./...` and `npm audit --audit-level=moderate` before release. Run the browser and integration checks from the README. Test actual TLS, proxy headers, origin allowlisting, stream buffering and timeout behavior on the chosen public platform. Use resource-limited containers and rotate credentials through the hosting secret store.
