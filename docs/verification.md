# Verification and assignment compliance

PULSEX was exercised with real Chromium browser contexts and the Docker services for Go, MongoDB and Redis. Test accounts and ballots were created through the UI and API. Timings below are measurements of the local Docker stack.

## Local evidence

| Check | Result |
| --- | --- |
| Production container build and Compose readiness | Passed. MongoDB replica set primary, Redis, API and independent projection worker started. |
| Go unit tests, race detector, vet and govulncheck | Passed. The race detector ran inside a Linux Go container. The initial vulnerability scan flagged `quic-go` v0.59.0. Upgrading to v0.59.1 cleared the reported vulnerability on the repeat scan. |
| TypeScript and Vite build, npm dependency audit | Passed. The build splits editor, results, room and analytics assets into route chunks. The dependency audit reported zero vulnerabilities. |
| OpenAPI lint | Passed without warnings under the minimal Redocly ruleset. |
| Chromium Playwright | 2 passed. Signup, draft edit, publish, guest voting, independent spectator reconnect, creator updates, closed state, CSV, logout and login. Second test covers two questions and live presentation in a room. |
| Accessibility | Axe reported zero WCAG A/AA violations on the tested mobile guest screen. |
| Integration guards | Rejected unauthenticated creation, bad origins, invalid choices, unauthorized analytics, draft links, hidden results, and closed or expired votes. Account-required scheduled voting and Redis HTTP 429 passed. |
| Concurrent duplicate attempts | One accepted vote and eleven HTTP 409 responses using the same browser identity. The result held one vote. |
| Vote versus close | Concurrent requests returned only accepted or closed responses. The final counts matched the number of committed ballots. |
| Redis worker interruption | MongoDB committed one more ballot while the worker was stopped. Redis stayed at 24 votes, then advanced to 25 after the worker returned and before an HTTP snapshot read. |
| Redis, API and worker restart | A cold Redis projection and reconnecting spectator both recovered the 25 durable votes. |
| SSE burst | 24 unique votes accepted in 201 ms. All 24 SSE spectators saw the final total within 353 ms from burst start. |
| Two API replicas | A separate API replica handled all 48 SSE spectators while the first accepted 24 votes. The writes completed in 248 ms and spectators converged in 384 ms. |
| k6 burst | 60 votes across 12 virtual users. 120/120 checks passed, no failed HTTP requests, p95 vote latency 134.01 ms, and final totals `[60,0]`. |

## Audit changes

- Fixed a browser sign-out race between the route guard and session updates.
- Added reconnect backoff and recovery from browser offline state, including a spectator who missed a vote while offline.
- Made Redis ordering use integer-safe version keys and fixed draft projection recovery when the number of choices changes.
- Protected a live question from being claimed by multiple rooms. Room actions and poll transitions share a MongoDB transaction.
- Added bounded password work, write rate limits, exact-origin checks, and secure-cookie configuration for public origins.
- Verified README screenshots from the running application using real test votes and synthetic test identities.

## GUVI × HCL assignment checklist

| Requirement in the brief | Status | Evidence |
| --- | --- | --- |
| React frontend | Verified locally | TypeScript/Vite build and Chromium workflows. |
| Go and Gin backend | Verified locally | Go checks and real HTTP/SSE traffic through Gin. |
| MongoDB persistence | Verified locally | Durable transactional vote ledger, state changes, verified collection indexes, and persistence through the app/Redis restart. |
| Redis actively drives counts and live delivery | Verified locally | Worker stop/start, Redis projection checks, Pub/Sub fan-out and SSE burst. |
| Separate frontend and backend | Complete | `frontend/` and `backend/`, shared only by build and HTTP contracts. |
| Backend validation | Verified locally | Typed and bounded inputs, ownership and cross-origin integration checks. |
| Create, share, vote and live results without refresh | Verified locally | Independent creator, guest and spectator browser contexts. |
| Basic signup and login with protected management | Verified locally | Signup/login/logout and unauthorized resource tests. |
| README with local run steps and decisions | Complete | Quickstart, deployment, screenshots, API, architecture, operations and security documentation. |
| Public GitHub repository | Complete | [Sanjayram3269/Pulsex](https://github.com/Sanjayram3269/Pulsex). |
| Working public deployment | Complete | [PULSEX public preview](https://pulsex-sanjayram.onrender.com). Public HTTPS readiness and the hosted Chromium suite passed. [Hosted verification](v2-verification.md) |
| 3–5 minute publicly viewable demo | Pending publication | A scripted local walkthrough and a recording guide show the working flow, consistency challenge and AI disclosure. |
| Email submission | Pending | The submission requires all three public links. |

Public HTTPS and live SSE were verified on Render. Hosted failover and long-duration load remain unverified. Local burst measurements describe this environment and workload only. The UI supports mobile and desktop layouts. The accessibility result is scoped to the tested guest page.
