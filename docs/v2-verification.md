# PULSEX V2 verification

The V2 suite exercises the compiled SPA and Go API with real MongoDB replica-set and Redis containers. The V1 regression tests remain in place.

| Area | Verification |
| --- | --- |
| V1 | Creator signup and sign-out, standalone sharing, mobile guest vote, independent spectator reconnect, CSV, and two-question room presentation passed in Chromium. |
| Poll types | Single choice, multiple choice, rating 1–10, Borda ranking, and word-cloud submission and moderation passed. Verified that two selections count as one ballot and pending phrases remain private. |
| Quiz | Two players answered a three-question quiz, reconnected, and finished with 300 and 100 points. Verified answer secrecy in the public payload, rejoin response, duplicate and late rejection, and an alias-free score export with owner access. |
| Q&A | Pending questions stayed private before approval. Upvote and removal propagated, and a pinned question appeared on a separate presentation tab. |
| Insights | Quiz report displayed five ballots, 80% accuracy, two joined identities, 50% completion, and mean score of 200 using real browser test responses. |
| Guided demo | An unauthenticated guest started an isolated room and cast an actual multi-select ballot. |
| Static checks | TypeScript, Docker image, Go tests and vet, dependency scans, and OpenAPI lint run as release checks. |

## Replay, recovery and load

Run `node scripts/verify-v2.mjs --recovery` before the original V1 rate-limit drill. The V2 script passed simultaneous ballots and spectators, quiz answer retries, a timed round with zero answers, ties, cross-owner access, pending Q&A and identical upvotes. Restarting Redis, the API and the worker recovered the typed ballot totals, final leaderboard and Q&A vote count. The V1 worker interruption, duplicate race, vote-versus-close race and Redis rate limit also passed.

In the local Windows Docker run, 30 simultaneous multi-select ballots produced 60 selections with zero failed unique submissions. Twenty-four SSE spectators converged in 324 ms, and vote latency was 99 ms p95. After the browser suite, a point-in-time container sample showed about 9 MiB for the API, 7 MiB for the worker, 9 MiB for Redis, and 350 MiB for MongoDB. These are local burst and post-test measurements. Production load, peak memory, geographic latency and hosted failover require a deployment.

## GUVI × HCL compliance

| Requirement | Status |
| --- | --- |
| React, Go/Gin, MongoDB and Redis | Implemented and locally verified |
| Separate frontend and backend, server validation, basic login and protected creation | Implemented and locally verified |
| Create, share, vote, see live results | Exercised with independent browser contexts |
| README, GitHub source and architectural decisions | Included |
| Working public deployment | [Hosted PULSEX](https://pulsex-sanjayram.onrender.com). Public readiness returned HTTP 200 and all five hosted Chromium tests passed. |
| Public 3–5 minute submission video and AI disclosure | V1 local recording and AI disclosure exist. Public video and V2 walkthrough remain pending. |
| Submit by email | Pending the required approval and public links |

## Release limits

Quiz sessions cap enrollment at 200 signed browser identities. Analytics distinguish browser identities from people and disclose the quiz participation denominator. Regular rooms expose recent browser presence and poll ballot counts. The comparison view pairs sessions of the same type. Presenter theme presets and a true/false question starter ship with the release. Saved custom template libraries and historical rank-movement tracking remain future work. Hosted load, managed service capacity, and multi-replica failover remain unverified.

## Hosted verification

On November 21, 2026, Render deployed application commit `4b9bdcd68ac147cc8e8d331585ee091d862e482a` with Atlas and Upstash. Five Chromium tests passed against the public HTTPS endpoint. They exercised creator signup and sign-in, mobile guest voting, independent live spectators and reconnects, CSV, two-question presentation, advanced poll types, quiz scoring, moderated Q&A, and the guided demo. An API smoke test independently verified secure cookie attributes, anonymous and untrusted-Origin creation rejection, publish, guest voting, an updated SSE snapshot, duplicate vote rejection, close, archive and sign-out. Test accounts and responses were synthetic.
