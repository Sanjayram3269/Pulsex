# Demo recording guide

Target length: 3–5 minutes. The official submission asks for a public GitHub link, a working deployment, and an unlisted YouTube or publicly viewable Drive video link.

| Time | Show and explain |
| --- | --- |
| 0:00–0:25 | Open the app and introduce the audience polling problem. Show the public URL when available. |
| 0:25–1:15 | Sign in, write a poll, show its preview, publish and copy the audience link. |
| 1:15–2:00 | Open guest and independent spectator views. Cast a vote and show the total changing on the spectator tab. Show room presentation if time permits. |
| 2:00–3:15 | Explain the vote/close race and the risk of committing to MongoDB while Redis is unavailable. Walk from transaction to persisted projection marker, monotonic Lua update, and reconnect snapshot. Explain which failures were exercised. |
| 3:15–3:45 | Disclose AI assistance and describe which parts you personally read, tested and can explain. Only say what you actually did. |

Codex generated the initial implementation, test code, documentation and local verification scripts, and used actual execution output to iterate. The presenter should be ready to explain why a unique vote index also needs an atomic aggregate update, what Pub/Sub can lose, and why browser cookies cannot enforce one-person-one-vote.

The submission address in the assignment is `devhiring@hclguvi.com`. Confirm the links are accessible without a login before emailing them.

## Reproduce local captures

From `frontend/`, run `npm ci`, `npx playwright install chromium`, and `node scripts/capture.mjs` against the running Compose stack. `BASE_URL` overrides the local URL. Set `VIDEO_DIR` to record a captioned walkthrough and `SCREENSHOT_DIR` to override the screenshot destination. The capture uses synthetic accounts and records actual votes through the application.
