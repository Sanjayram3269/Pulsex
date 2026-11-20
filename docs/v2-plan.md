# PULSEX V2 delivery plan

Verified starting commit: `0af16d82dacb8b7e222b9db81e55aed02c2a6cd7`. Development branch: `feature/pulsex-v2`.

| Phase | Acceptance gate |
| --- | --- |
| Foundation | Existing V1 browser and API tests pass against real services. Existing polls and votes require no migration. |
| Advanced polls | Each type has an editor, validated ballot, durable aggregate, visible results, and export. Parallel duplicate submissions commit one ballot. Cache restart recovers the same data. Only approved cloud terms are public. |
| Quiz Arena | A host runs a three-question room. Two participants receive server-calculated scores and deterministic ranking. Answer secrecy, reconnect, retries and expiry are tested. |
| Q&A | Guests submit and vote on approved questions. Owners moderate, pin and present content. Unauthorized viewers never receive pending text. |
| Intelligence | Counts distinguish ballots, selections, participants and presence. Exports and charts use measured denominators. |
| Experience | Responsive, themed presentation and sandboxed reviewer demo. Verify keyboard workflows and take screenshots from the running app. |
| Release | Re-run compatibility, recovery, security and load checks. Publish working changes on the feature branch. Merge after full V2 gates pass. Verify public hosting when access is available. |

MongoDB remains the source of truth. Ballots and aggregates share the existing transaction and versioned Redis projection. Quiz and Q&A use separate collections where their access and lifecycle differ from polls. Record test evidence and incomplete gates explicitly.
