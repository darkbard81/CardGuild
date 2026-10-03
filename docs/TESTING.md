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

`check` now includes build; do not add another build between these commands. Standalone Integration restart, Interaction and Journey runs require `npm run build` after product source changes. None silently rebuilds or accesses the development DB. Only the development-only terrain editor uses a Vite development server. `CI Contracts / Contracts` runs only on PRs targeting main. `CI Quick / Quick` runs `check` followed by `test:domain` on pushes to branches other than main, with no Chromium installation. Main pushes run neither test workflow. A feature push to an open PR intentionally runs Quick and the PR gate independently; only Contracts is the required full gate. Repository branch protection must select `Contracts` instead of the removed `Full` check; repository settings are external to this change.

## Focused reproduction

```sh
npm run test:domain -- tests/domain/adventure-contracts.test.ts -t 'victory awards'
npm run test:integration -- tests/integration/contracts/publication.test.ts -t 'delayed user save'
npm run test:interaction -- tests/interaction/battle.spec.ts --grep 'pinch/pan release'
npm run test:journey -- tests/journeys/start-continue.spec.ts --grep 'J-CONTINUE'
```

Omit `-t` / `--grep` to run a whole file. Vitest uses `run`, never watch. Browser scripts load `tsx` so product JSON imports behave in the Node test harness. Browser application code loads through the deployment bundle; development-only terrain tests load source modules through Vite.

Discovery is explicitly disjoint: `tests/domain/**/*.test.ts`, `tests/integration/contracts/**/*.test.ts`, `tests/interaction/**/*.spec.ts`, `tests/journeys/**/*.spec.ts`. Support files are outside every include. There is no default runner config that accidentally collects another layer. Empty filtered suites and failed cases must exit nonzero. `test:all` invokes leaves directly, not nested aggregates.

## Isolation and cost

Domain has up to four Node workers and no external I/O. Integration files run serially; only the HTTP/WS/disk/process cases open those resources. Both Playwright suites use one Chromium worker at 1024×768 and no automatic retries. They run serially after the Node layers. Interaction uses two disjoint projects with one global worker: `ui` loads the existing build from Vite preview (4191, `CARDGUILD_INTERACTION_PORT`); `terrain` owns `terrain-elevation.spec.ts`, `standee-occlusion.spec.ts`, and `campaign-authoring.spec.ts` on the Vite development server (4192, `CARDGUILD_TERRAIN_TEST_PORT`). Neither server is reused, and each case gets a fresh browser context. No file runs in both projects. The normal full gate reuses the build from `check`, so it pays no additional build cost. Built-server cases reserve a local ephemeral port and create a fresh temporary directory and SQLite file; cleanup runs in `finally`/fixture teardown. Test accounts and browser storage are disposable. No test uses `.data/cardguild.dev.sqlite` or `tools/dev-coop.ts`.

`controlledSession` defaults to reconnecting with a seeded disposable credential. It waits for the real hello/snapshot exchange; gameplay is never seeded in browser storage. Only tests whose risk includes entry use `join` or `create`. The one-time seed marker survives page reload so product exit/retirement can actually clear the credential. `Prepare controlled session: <entry>` is a separate Playwright step for timing/trace diagnosis. Page navigation waits for DOM content, and each case waits for its actual UI completion condition rather than every unrelated resource.

Chapter field-map briefing bindings are checked in Domain; one objective-map Interaction covers their shared departure flow, with the forest cancellation/destruction and final reward/ending flows retaining their separate owners. Exact authored content totals are not gates; tutorial order, selected class roster, reachability floors and missing/stale references remain enforced. Scene asset validation decodes each sheet once and checks every frame's original pixels. It has no cross-run cache or stale validation result.

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

### 2026-10-03 cost reduction

The final configuration passed `CI=true npm run check && CI=true npm run test:all` in one uninterrupted run, exit 0: **162 Domain + 28 Integration + 78 Interaction + 4 Journey = 272 passed**, no failures/skips/retries. Only documentation/evidence changed afterward. Node 24.18.1 / npm 11.16.0, same local Linux machine, one global browser worker and unchanged failure limits. [Structured measurements](test-cost-evidence.json).

The following comparison holds the **same 272 cases** fixed: after simplifying ownership/setup, all ordinary UI still used the development server; the final configuration serves that UI from the existing deployment build. The terrain cases continue using source modules. Times include process/server startup and teardown.

| Measured interval | Development UI | Final built UI |
| --- | ---: | ---: |
| `check` + `test:all` wall time | 329.6 s | 224.4 s |
| `test:all` wall time | 300.9 s | 197.2 s |
| Interaction phase wall time | 255.2 s | 151.8 s |

This is a **34.5% reduction in local `test:all` time**, leaving about 103 seconds under the existing five-minute step limit on this machine. It is not a GitHub CI timing guarantee; these changes have not been published or run in GitHub CI.

Earlier focused measurements of battle/chapter/feedback went from 21 cases / 76.3 s to 19 cases / 66.4 s after moving the two duplicate departures into a Domain binding check and reconnecting directly. With those same 19 cases, summed case time (excluding runner startup) then fell from 62.7 s to 37.0 s on the deployment bundle. Entry/create forms, ACK/snapshot ordering, rejection, ownership and reload-after-exit remain exercised. Discovery found 78 cases in 16 files, with disjoint `ui` and `terrain` assignments; the final gate executed all 78.

Asset validation measured 4.0 s before and 3.1 s after decoding the scene sheet once. A byte-for-byte comparison matched all 16 original RGBA frame extractions. Every alpha/chroma/geometry check remains; persistent cache/invalidation machinery was not warranted by this measured cost. Authored min/max totals were removed while tutorial order, class roster, reachable minimums, reference validity and stale reserve checks remain.

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
