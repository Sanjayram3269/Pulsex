# V2 architecture decisions

## Typed ballots use the existing poll transaction

The optional `question` object carries contract version 1 and a type. Existing documents without it remain single choice. Choice IDs are zero-based option indexes. Rating values are submitted as the actual scale number. Ranked ballots contain a complete permutation. A word-cloud ballot is one normalized phrase submitted for moderation.

| Type | MongoDB aggregate and Redis projection |
| --- | --- |
| Single choice | One ballot and one count increment |
| Multiple choice | One ballot and one increment per distinct selected option. Percentages divide by ballots, so they can sum above 100%. |
| Rating | One ballot and one scale bucket. The UI calculates the average from the distribution. |
| Ranked | One first-preference count and Borda points per ranking. A rank of first receives N−1 points, with zero for last. Equal highest points share the lead. |
| Word cloud | Durable submission pending review. Approval commits the normalized term count and version in the same transaction. Public snapshots contain approved phrases only. |

The `votes` collection retains its unique `(poll, identity)` index and adds a moderation queue index. New typed ballots store their variant and selections or phrase. Poll state and aggregate remain atomic with ballot insertion. Existing Redis keys keep their version prefix. The worker publishes typed projections with ballots, ranked points and approved terms where applicable. Use a coordinated API and worker rollout to avoid older binaries processing V2 data.

## Quizzes share the room lifecycle and stream hub

Each quiz owns one existing-format room document with a private quiz configuration and a separate host-control revision. A unique room code serves both the participant and projector routes. Host edits and controls use optimistic compare-and-set. Writes to the same room serialize deadline admission against host controls.

`quiz_players` uniquely indexes `(quiz, identity)` and ranks by points descending, correct answers descending, then ObjectID ascending. `quiz_answers` uniquely indexes `(quiz, round, identity)`. An answer transaction verifies room, round, revision and server deadline, increments the player and round totals, then inserts its durable answer. A unique-index conflict rolls all changes back. Correct answers earn the configured points. An optional bonus is the floor of half the base score multiplied by the remaining fraction of the timer. Incorrect and late answers earn zero. A late answer is rejected.

The public view sends one opened question. Answers and ranks are hidden until the room's reveal rules allow them. At the finish, opened questions are reviewed and ordered scores become the final podium. A current room revision gates the Redis leaderboard cache. On a cache miss, an indexed player read is checked against the same durable revision before publication. Redis Pub/Sub wakes subscribers on change, and the existing heartbeat reconciles dropped messages or a cache loss. The room cap is 200 joined identities.

## Moderation and analytics

Q&A documents are indexed by room and state, with indexes to sort pinned questions by votes or recency. Upvotes have a unique `(room, question, identity)` index. A room update, vote and count change commit together. Pending questions appear only in the authenticated owner stream. Redis notifications wake all replicas and clients fetch bounded, indexed snapshots. Audience pages learn the Q&A revision on the existing room or quiz stream, preserving HTTP/1 connection slots for ballots. The protected host queue uses its own stream. The wall displays 50 public questions and 50 pending ones at a time. A browser can submit six questions per room.

Room analytics report durable poll ballots and approximate recent browser presence. Direct poll links may contribute ballots, so regular rooms omit participation rates. Quiz analytics use signed browser identities that joined, including late arrivals. Completion means a player submitted every configured answer in an ended quiz. Accuracy divides correct answers by submitted answers. The quiz answer ledger is scanned only for on-demand analytics within the 200-player, 20-round bound. Score CSV exports contain rank and scores without participant aliases.

## Isolated reviewer demo

The public demo endpoint creates a sample room and poll transactionally with no creator owner. Requests are rate-limited by IP. An hour-long expiration is enforced in ballot admission. TTL indexes delete demo documents and their ballots. Normal polls and ballots omit the demo expiration field. Demo data uses the real voting and projection path.
