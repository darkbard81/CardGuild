# Test execution

[Policy](testing-policy.md) determines whether a test should exist; the [risk map](test-risk-map.md) assigns each assertion to its cheapest capable layer. Issue #60 replaced all previous tests, fixtures, snapshots, runners and the Full CI entry point. Quick now uses the replacement Domain suite. There is no legacy suite.

## Commands and ownership

Use Node 24 and npm 11+. In a fresh checkout run `npm ci` and `npx playwright install --with-deps chromium`.

| Command | Contract |
| --- | --- |
| `npm run check` | Production content/assets, TypeScript, ESLint, client/server build; no behavioral tests |
| `npm run test:domain` | Pure rules, commands, legality, progression, authority and save validation |
| `npm run test:integration` | Services, HTTP/WS, commit/publication, real file SQLite and built-process restart |
| `npm run test:interaction` | Real UI/controller/client with only backend responses controlled |
| `npm run test:journey` | Four real built-app/server journeys with production content and isolated disk DBs |
| `npm test` | Domain then Integration; no browser |
| `npm run test:all` | The four leaf suites in order, each once |

The full local and CI gate is:

```sh
CI=true npm run check && CI=true npm run test:all
```

`check` now includes build; do not add another build between these commands. Standalone Integration restart and Journey runs require `npm run build` after product source changes. Neither leaf silently builds, uses a development server, or accesses the development DB. `CI Contracts / Contracts` runs only on PRs targeting main. `CI Quick / Quick` runs `check` followed by `test:domain` on pushes to branches other than main, with no Chromium installation. Main pushes run neither test workflow. A feature push to an open PR intentionally runs Quick and the PR gate independently; only Contracts is the required full gate. Repository branch protection must select `Contracts` instead of the removed `Full` check; repository settings are external to this change.

## Focused reproduction

```sh
npm run test:domain -- tests/domain/adventure-contracts.test.ts -t 'victory awards'
npm run test:integration -- tests/integration/contracts/publication.test.ts -t 'delayed user save'
npm run test:interaction -- tests/interaction/battle.spec.ts --grep 'pinch/pan release'
npm run test:journey -- tests/journeys/start-continue.spec.ts --grep 'J-CONTINUE'
```

Omit `-t` / `--grep` to run a whole file. Vitest uses `run`, never watch. Browser scripts load `tsx` so product JSON imports behave in the Node test harness. Browser application code still loads normally through Vite or the deployment bundle.

Discovery is explicitly disjoint: `tests/domain/**/*.test.ts`, `tests/integration/contracts/**/*.test.ts`, `tests/interaction/**/*.spec.ts`, `tests/journeys/**/*.spec.ts`. Support files are outside every include. There is no default runner config that accidentally collects another layer. Empty filtered suites and failed cases must exit nonzero. `test:all` invokes leaves directly, not nested aggregates.

## Isolation and cost

Domain has up to four Node workers and no external I/O. Integration files run serially; only the HTTP/WS/disk/process cases open those resources. Both Playwright suites use one Chromium worker at 1024×768 and no automatic retries. They run serially after the Node layers. Interaction owns a strict Vite port (4191, override with `CARDGUILD_INTERACTION_PORT`), refuses to reuse a server, and creates fresh browser contexts. Built-server cases reserve a local ephemeral port and create a fresh temporary directory and SQLite file; cleanup runs in `finally`/fixture teardown. Test accounts and browser storage are disposable. No test uses `.data/cardguild.dev.sqlite` or `tools/dev-coop.ts`.

Seed 60 is the shared reproducible production-content checkpoint. Small pure combat cases use their declared seed. Deferred adapters control commit delay/failure; actual restart tests use actual SIGTERM and SIGKILL. Browser long press advances a virtual clock; ordinary interactions wait for real DOM/client state. General actions have a 5-second failure ceiling; Journey navigation 10 seconds, assertions 8 seconds, whole Journey 60 seconds. These are failure limits, not fixed waits.

Baseline on 2026-09-17, Node 24.18.1 / npm 11.16.0, local Linux, installed dependencies (one sequential `test:all`, no retries):

| Suite | Actual executed cases / files | Runner elapsed | Review budget |
| --- | --- | --- | --- |
| Domain | 44 / 5 | 1.34 s | 15 s |
| Integration | 11 / 5 | 5.86 s | 30 s |
| Interaction | 19 / 4 | 50.5 s | 120 s |
| Journey | 4 / 2 | 23.2 s | 90 s |

These are measurements of the replacement suite, not a speedup against the removed suite. The budgets include startup headroom for CI hardware. `test:all` has a five-minute CI step ceiling; installation is outside it. Slowest baseline Journey was J-COOP (8.5 s): two real contexts must reach a guest turn, disconnect and regain control. J-CONTINUE (5.8 s) pays for process restart and fresh authentication. Interaction's slowest case was board facing (3.6 s); actual Chromium/Pixi bootstrap dominates, so rule tables remain in Domain. Integration's disk/process/auth cases justify real I/O; publication faults use a cheap deferred adapter. No baseline case retried or skipped.

Budgets cover warm installed dependencies, not npm/browser installation. Exceeding a budget requires investigating the slow owner, shrinking the precondition or moving detailed assertions down a layer before changing the allowance. Core risks cannot be skipped or hidden behind retries. A flaky failure blocks the gate until its cause is fixed; if unresolved, record risk ID, owner and deadline in an issue and report the gate incomplete.

## Diagnostics and visual review

Failures name a risk ID and the violated player contract. Node assertions show relevant gameplay fields; wire timeouts include the last safe message types, request IDs and gameplay/control revisions. Credentials and full wire payloads are intentionally omitted. Process readiness failures include server logs; Journey failures attach the server log with seed 60.

Playwright retains a trace, screenshot and error context on failure under `test-results/<layer>`. Preparation and board cases also attach representative successful screenshots. View a local trace with `npx playwright show-trace <trace.zip>`. Before sharing diagnostics, create a new sanitized directory:

```sh
python3 tools/testing/redact-artifacts.py test-results sanitized-test-results
```

The utility removes password/cookie/authorization/reconnect values from text and trace members. CI uploads only the sanitized copy after this step succeeds. Use disposable accounts only; do not attach development database files. Raw traces remain local and ignored. Screenshots still require review for user-entered visible text.

Representative board and preparation screenshots must be inspected for legibility and obstruction; generating a file is not a visual verdict. CDP touch exercises distinct pinch/long-press risks but is not physical iPad or WebKit evidence. Those device profiles are additional risk-driven checks, not duplicated PR matrices.

## Playtest

`npm run playtest -- --seeds N` is a balance investigation tool, not a test gate. Use the same seeds and party/policy selection before and after changes to encounter layout, enemies, rewards or starter strength. `--json <output>` writes evidence. Compare completion/defeat, encounter reached, turns, damage and selected rewards; a policy winning does not prove every human strategy viable. Preserve the source revision and command with exported comparisons. Do not turn a full campaign playthrough into a browser regression for a small UI action.

## Reconstruction evidence

Discovery collected 44/11/19/4 cases across 5/5/4/2 files. The four collected file sets are pairwise disjoint and their union is every remaining test file. This is discovery evidence; execution evidence is the baseline table and final gate result.

An absent file filter returned exit 1 in all four leaf scripts. Temporary deliberately failing cases returned exit 1 in each leaf. With a failing Domain probe, both `npm test` and `test:all` returned exit 1 before Integration; the probes were removed. The normal aggregate log contains each leaf header once. None of these failure probes is retained or marked skipped.

Limited mutation detection is recorded in [the risk map](test-risk-map.md#detection-evidence). A real failing Journey trace was sanitized and scanned: its known password, cookie and reconnect token were absent from the readable sanitized ZIP. Successful board and long-press preparation screenshots were inspected at 1024×768: the board target and End Turn control are visible, and the Vicious Swing tooltip stays inside the viewport with readable text. The character panel has its existing internal scroll; no exhaustive visual or physical-device claim is made.

Final local gate on 2026-09-17: `CI=true npm run check && CI=true npm run test:all` completed in **105.97 s, exit 0**. Content/assets, all TypeScript boundaries, ESLint and both product builds passed; Domain 44, Integration 11, Interaction 19 and Journey 4 all passed once, with zero retries/skips. An earlier full attempt found one entry test still using removed `data-auth` telemetry; that test now waits for the HTTP response and checks the visible draft/focus and authenticated landing. Its focused check passed before this fresh complete gate. The HP-corruption save case also uses a matching checksum so semantic validation owns its rejection. GitHub CI and physical iPad/WebKit were not run locally.
