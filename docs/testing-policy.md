# Player contract testing

[Issue #60](https://github.com/darkbard81/CardGuild/issues/60) defines the reconstruction. Tests protect player-visible behavior and gameplay invariants. They do not preserve implementation structure, old test counts, or coverage percentages.

A case must identify a concrete player loss, an independently stated expected result, its cheapest capable layer, and a single assertion owner in [the risk map](test-risk-map.md). The cost must be proportional to the risk. Tests that cannot explain these points are removed.

| Layer | Responsibility | Boundary |
| --- | --- | --- |
| Domain | Rules, resource conservation, legality, adventure/growth, pure save validation | Public pure command and query APIs; no browser, HTTP server or DB |
| Integration | Authentication, wire delivery, commit/publication, SQLite and restart | Real I/O only where the risk requires it; faults at storage/transport boundaries |
| Interaction | Input to intent, confirmed-state feedback, focus, hit testing and gestures | Actual UI, controller and client; only backend responses controlled |
| Journey | The product remains playable across connected screens and services | Built app and server, production content, isolated file DB, actual HTTP/WS |

Higher layers protect connections, not lower-layer calculation or permission tables. Expected values come from stated gameplay rules, never by invoking the same production resolver twice. Rejected commands preserve gameplay and RNG. A click is not proof of a saved action; successful confirmation requires both ACK and its applied snapshot.

Use small typed builders and public domain commands to prepare preconditions. Do not bypass the input, transition, network or persistence boundary a case claims to test. Journey preparation may write a validated save before the measured journey begins. Test fixtures and preparation endpoints must never enter the production bundle/API.

Prefer roles, accessible names, meaningful displayed state, and public command outcomes. Do not assert private fields, internal call ordering, source strings, DOM nesting, CSS class counts, implementation data structures, or whole-state golden snapshots. A compact before/after resource projection is appropriate for conservation; literal implementation hashes are not.

Time, random seeds and delayed network/storage responses are controllable at their boundary. Wait on observable state, readiness or completion, not arbitrary sleeps. A timed non-occurrence assertion must state why its observation window is necessary. Each case owns its browser storage and required account, session, port and DB identity. Cleanup runs on success and failure.

The PR gate uses one Chromium desktop profile (1024×768). Touch scenarios are selected for distinct gesture risks, not duplicated wholesale for every viewport. Representative board/popover/preparation screenshots complement behavior assertions. Desktop touch emulation does not prove physical iPad compatibility; real-device evidence is reported separately.

Automatic retries and skipped core risks cannot produce a completion claim. Failures name risk ID and contract, with deterministic seed and relevant request/revision diagnostics. Browser failures retain trace and screenshot. Server diagnostics must exclude passwords, cookies and reconnect tokens.

The final gate is `npm run check` followed by `npm run test:all`. `check` validates content/assets, types, lint and product builds. `npm test` is Domain plus Integration. Each aggregate invokes its leaf suites exactly once. Suite absence and failed cases must return nonzero. Execution and individual-case reproduction belong in [TESTING.md](TESTING.md).

Before declaring reconstruction complete, prove the full risk map, file-backed and process recovery, non-overlapping discovery, failure propagation, and representative fault detection (premature publication, duplicate award, gesture as action). Remove all replaced tests, fixtures, obsolete runners/scripts, and product exports used only by those helpers. Record measured costs and budgets after the new suite runs; do not invent speed improvements.
