# PULSEX implementation plan

| Area | Acceptance criteria |
| --- | --- |
| Identity and Studio | Register, sign in, create and manage owned polls. Reject malformed input, unauthorized requests and invalid state changes. |
| Durable voting | A vote, aggregate and projection marker commit in one MongoDB transaction. Duplicate identities and votes after closure are rejected under concurrency. |
| Live delivery | Redis holds versioned counts, publishes changes and feeds SSE. New and reconnecting spectators receive the latest snapshot. Restart Redis and verify repair. |
| Arena and Insights | Run multiple questions in a room, present results and export real participation data. |
| Release | Build and run with Docker, verify against real services and browsers, commit and push main, update repository metadata, document the results and capture screenshots. |
| Submission | Verify a public deployment, prepare the demo and disclose AI use. Report any access blockers against the assignment checklist. |
