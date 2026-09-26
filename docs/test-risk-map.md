# Player failure ownership

Reconstructed from [#60](https://github.com/darkbard81/CardGuild/issues/60), product source and [policy](testing-policy.md). The old suite's file list/counts were not requirements. Each row below names actual assertions, not merely executed code. Paths are relative to `tests/`. File/case filters and measured suite budgets are in [TESTING](TESTING.md).

| Risk | Player loss → independently expected result | Assertion owner / cases | Why this boundary; cost class |
| --- | --- | --- | --- |
| G-RULE | Incorrect checks/stats/damage → degree thresholds and natural rolls, strongest typed bonuses/penalties, stacked untyped penalties, level/proficiency, armor DEX cap, MAP and damage floor/critical arithmetic | Domain `rules.test.ts` | Public pure resolvers; milliseconds |
| G-MOVE | Promised movement illegal or obstacle bypass → ally traversal without occupied stopping, enemy blocking, terrain/mode/action-budget limits, legal query agrees with execution | Domain `combat-contracts.test.ts`, movement promises | Pure query + public command; milliseconds |
| G-COMBAT | Invalid/repeated input consumes resources or RNG → rejection preserves resource projection; accepted card/reaction spends once, pass resumes interrupted movement without spending reaction | Domain `combat-contracts.test.ts`, accepted/refused input and reactions | Pure command; milliseconds |
| G-REPLAY | Same history diverges → meaningful gameplay matches for same seed/content, different content refused | Domain `combat-contracts.test.ts`, replay | Public replay boundary, no literal golden hash; milliseconds |
| G-ADVENTURE | Double reward/EXP or defeat reward → victory awards 200 once, selected card adds one, duplicate/stale result and invalid/repeated choice inert, defeat cannot depart | Domain `adventure-contracts.test.ts`, settlement | Pure adventure command; milliseconds |
| G-GROWTH | Wrong level or unspent growth bypass → 999/1000 and multi-level EXP thresholds, pending Lv3 blocks departure, out-of-order/duplicate choice rejected, accepted progression reaches next battle | Domain `adventure-contracts.test.ts`, progression | Pure progression + bridge; does not repeat stat arithmetic; milliseconds |
| G-LOADOUT | Overspent inventory, ineligible preparation or preview equips → slot/copy/capacity/class/level limits, two individually legal members cannot allocate one final copy, preview inert, accepted removal reaches combat equipment/deck | Domain `adventure-contracts.test.ts`, loadout | Pure party allocation + bridge; milliseconds |
| G-AUTHORITY | Player acts outside ownership/phase → guest claim requirements, host-only departure, preparation controller, active actor and reaction-head/trigger permission, resume gate | Domain `authority.test.ts` | Public intent rejection, no browser disabled-state substitute; milliseconds |
| G-SAVE | Lost gameplay or resurrected identity → spent HP/actions and card zones/RNG, pending reaction continuation, growth gate and reward/EXP survive restore; fresh session replaces live identity; corrupt JSON/hash/health, unsupported version/content rejected without rewrite | Domain `saves.test.ts` | Pure projection/restore. Migration registry is empty: unregistered versions/content are refused; no invented compatibility; milliseconds |
| B-ACCOUNT | Cross-account access or revoked login → another owner's Continue fails, own list excludes foreign campaigns, logout/expired cookies rejected; deletion requires the owner and removes saved progress while disconnecting participants | Integration `contracts/http-coop.test.ts`, authentication | Actual HTTP + isolated persistence; password hashing/I/O dominates |
| B-WIRE | Duplicate/stale/reused request or invalid hello acts → same request cannot apply twice, stale/reused ID and bad token/content refused | Integration `contracts/publication.test.ts`, envelope; representative real WS in `http-coop.test.ts` | SessionHost service boundary for combinations; one real transport connection |
| B-COMMIT | Unsaved progress looks successful → delayed user/AI candidate remains unpublished, user failure permits same-request retry, failed AI save retires without candidate snapshot | Integration `contracts/publication.test.ts` | Real host with controlled external durability, not a save-call spy; milliseconds |
| B-STORAGE | Approved state lost/overwritten → winner survives actual file close/reopen, stale CAS and wrong owner cannot replace it | Integration `contracts/storage.test.ts`; process persistence in `restart.test.ts` | Actual disk required; no repeated field-level save table |
| B-COOP | Connection change loses/duplicates control → guest disconnect gives host control, reconnect returns it with unchanged gameplay revision/hash and changed control revision | Integration `contracts/http-coop.test.ts`, real WS | Real sockets + server-derived presence; subsecond-to-seconds |
| B-RESUME | Continue races writer or corrupt save destroys live play → in-flight commit is awaited, latest checkpoint restored in new resume-lobby, old writer retired, corrupt preflight preserves row/live host; deletion drains writes, serializes against Continue, supports empty/corrupt saves and storage-failure retry; SIGTERM/SIGKILL restart permits Resume and next input | Integration `contracts/resume.test.ts`, `restart.test.ts` | Service ordering + real file/process; seconds |
| U-ENTRY | Pending/error/expiry/late auth blocks destination → pending prevents duplicate submit, error can retry, expired auth returns to intended Continue, late response preserves draft/focus; named delete confirmation supports cancel/Escape, pending lock, failure retry and empty-list feedback | Interaction `entry.spec.ts` | Actual entry/controller with controlled HTTP; seconds |
| U-PREPARE | Preview/gesture equips or uncommitted change appears saved → compare/cancel/drag/long press inert; explicit confirmation waits for ACK + applied snapshot in both orders; rejection enables retry; control loss readonly; disconnect resends same request and confirms only after server result; focus retained; unified sheet routes rewards, shows deck sources, groups skills, keeps lobby readonly, and rejects stale inventory previews | Interaction `preparation.spec.ts` | Actual UI/client and backend ordering; seconds |
| U-BATTLE | Hover/cancel/stale authority issues wrong action → Step cancel inert, End Turn needs facing, control change clears target menu, Pass/Use Reaction sends displayed choice | Interaction `battle.spec.ts`, `feedback.spec.ts` | Actual DOM/Pixi input, no private controller mutation; seconds |
| U-BOARD | Transform picks wrong tile or gesture acts → real zoom/pan/resize on 45-degree board still selects Tile 1,1; pinch release cannot answer End Turn, next deliberate touch can | Interaction `battle.spec.ts` | Actual canvas hit testing with independently reviewed pixel targets; seconds |
| U-FEEDBACK | Old targeting/growth/busy controls mislead → resync clears stale direction; termination returns to entry; focused growth confirmation enables departure; failure/complete replaces combat controls | Interaction `feedback.spec.ts` | Actual screen/controller updates; seconds |
| J-START | Product bootstrap/auth/preparation/action disconnected → register, create, choose party, enter battle, Step is confirmed in log | Journey `start-continue.spec.ts`, J-START | Built app/server + production content + file DB; seconds |
| J-PROGRESS | Win cannot progress → valid near-victory checkpoint, actual Strike, reward, required growth, confirmed equipment removal in the unified sheet, next encounter reflects that preparation | Journey `progress-coop.spec.ts`, J-PROGRESS | Only precondition prepared via public commands and validated save; measured transition never bypassed; seconds |
| J-CONTINUE | Disk recovery inaccessible via UI → approved Step, SIGKILL/restart, new browser login/list/Continue/Resume, End Turn confirmed | Journey `start-continue.spec.ts`, J-CONTINUE | Real restart plus fresh user entry, no repeated save-field assertions; seconds |
| J-COOP | Two actual clients cannot play across leave/return → join/claim, common battle, guest turn, host fallback, guest return, guest action confirmed in both logs | Journey `progress-coop.spec.ts`, J-COOP | Two browser contexts + real server; bounded first guest turn, no full campaign replay; seconds |

The four Journeys execute lower-level rules but assert only continued play across the connection. Domain owns detailed arithmetic, settlement, permission and save fields; higher layers do not repeat their tables. Asset/content references remain in `check`, not per-content-row behavioral cases. Full PF2e semantics, exhaustive cards/characters/viewport combinations and unsupported save migrations are not claimed.

## Detection evidence

Temporary mutations were applied separately, each targeted owner executed, then original source bytes restored. No mutation switch or framework remains in production.

| Contract violation | Owner failure observed | Process result |
| --- | --- | --- |
| Assign user candidate state before durable commit | B-COMMIT delayed user save observed an adventure while expecting the previous null checkpoint | exit 1, 2.12 s |
| Apply victory EXP twice (`amount * 2`) | G-ADVENTURE expected 200, received 400 | exit 1, 2.05 s |
| Remove pinch-release tap suppression | U-BOARD facing prompt became server-action pending on gesture release | exit 1, 13.49 s |

These are detection checks, not full-suite passes. Focused filter output may label unselected cases skipped; the committed suites contain no skipped cases or retry allowance. Normal source is restored before the final full gate. Execution/discovery evidence and measured cost are recorded in [TESTING](TESTING.md).

## #59 interaction additions

| Risk | Player contract | Assertion owner |
| --- | --- | --- |
| G-FACING | Final in-place Step preserves facing, ends once and replays deterministically; earlier Step leaves the turn open | Domain `combat-contracts.test.ts` |
| U-END-TURN | Cancel does not issue a command; spent turns need no discard confirmation | Interaction `battle.spec.ts` |
| U-INSPECT | Touch detail modes for hand/Ring cannot issue gameplay commands | Interaction `battle.spec.ts` |
| U-TARGET | Invalid board target preserves the selected card and accepts a corrected target | Interaction `battle.spec.ts` |
| U-REWARD | Reading is inert; explicit acquisition stays pending until ACK + snapshot; rejection permits retry | Interaction `feedback.spec.ts` |
| U-REACTION | Non-owner sees waiting reason and can inspect without decision buttons | Interaction `feedback.spec.ts` |
| U-STARTUP | Renderer failure exposes a visible retry | Interaction `feedback.spec.ts` |

U-FEEDBACK also owns terminal exit/reload and displayed derived growth effects. J-PROGRESS follows explicit reward acquisition without repeating the inspection assertions.

## Combat sheet and Recall Knowledge

| Risk | Owner | Evidence |
| --- | --- | --- |
| G-KNOWLEDGE: wrong skill/DC, repeat cost, lost party knowledge | Domain | `knowledge.test.ts`, `saves.test.ts`: command, replay and save/Resume |
| U-SHEET: duplicate panels, stale sheet, input leaks, blocked Reaction | Interaction | `combat-sheet.spec.ts`: full-screen bounds, selection/close, live snapshot, owned Reaction |
| U-KNOWLEDGE: inspection executes an action or client unlocks before server state | Interaction | `combat-sheet.spec.ts`: Ring inspect/execute, ACK before snapshot, locked/unlocked entry |

Existing U-BOARD owns changed board hit testing, pan/zoom/resize and touch direction. Existing Journey owns full service navigation; no repeated journey is added for sheet assertions.

## Derived conditions and sheet feedback

| Risk | Owner | Evidence |
| --- | --- | --- |
| G-CONDITION: parent removed but effects persist, repeated Off-guard penalties, preview/execution divergence | Domain | `condition-effects.test.ts`: parent effects, strongest circumstance penalty, movement refusal, attack preview and command/replay |
| U-EFFECTS: misleading condition hierarchy or stale colored numbers | Interaction | `combat-sheet.spec.ts`: derived children, decrease/increase/neutral snapshots, tap explanation, no gameplay command |
| U-HUD-EFFECTS: compact summary diverges from sheet or reveals locked enemy saves | Interaction | `combat-sheet.spec.ts`: empty condition row, three saves, live penalty snapshot, read-only chip/stat explanations, enemy disclosure gate |

## #63 persistent Player/Companion foundation

| Risk | Player loss → expected result | Assertion owner |
| --- | --- | --- |
| G-IDENTITY | Creation trusts client stats or mutates another character → Host-only validated Human preset, one protagonist/starter, cosmetic gender, independent same-template members and current growth/Loadout in next Combat | Domain `creation.test.ts`, seed 63 |
| G-IDENTITY-SAVE | Continue loses identity or admits corrupt roles → initial and grown Player/Companion round-trip, spent HP retained, illegal union/preset/Build/history/slot/name/appearance refused at restore and live ingress, Save 3 preserved and rejected | Domain `creation.test.ts` |
| G-IDENTITY-WIRE | Malformed identity reaches rendering → snapshot union/role/shape rejection before application | Domain `creation.test.ts`, protocol validator |
| B-CREATION | Unsaved creation appears complete or retry duplicates starter → delay/failure retains empty checkpoint, same request retry commits once; actual file close/reopen + owned Continue retains protagonist, summary and next legal command | Integration `contracts/creation.test.ts`, seed 63, request `create-once-63` / `file-create-63` |

Creation UI/visual interaction belongs to #64, recruitment atomicity to #65, preparation Co-op to #66, and Tutorial J-START/J-CONTINUE conversion to #67. Contract and version table: [M12-1 member foundation](m12-1-member-foundation.md).

## M12-2 Character Creation

| Risk | Player contract | Owner / evidence |
|---|---|---|
| U-CREATE | Preview cannot award a character; name/gender survive Class changes, auth expiry and rejected save; a late old image cannot replace the current choice; one confirmation waits for both ACK and snapshot; chosen identity reaches preparation and combat | Interaction `creation.spec.ts`, seed 60, request/revision annotations |
| B-CREATION-NAME | A valid 40-codepoint name fails at the HTTP campaign-title boundary or is truncated in the save → full name and derived title survive creation and saved summaries; the campaign's 60-codepoint limit remains enforced | Integration `contracts/http-coop.test.ts`, seed 60 |
| G-IDENTITY | All nine production Human starters keep stats, Collection and deck independent of gender | Domain `creation.test.ts` production matrix |
| A-CREATION | Missing/duplicate/miswired gender/Class variant or missing runtime image fails validation; source-cell edge contact is reported for user art review | production policy, assets build/check, `creation-visual-contract.ts` |

Bounded first-encounter solo playtest: `npx tsx tools/playtest/creation-readiness.ts`. This reports actual outcomes without treating the greedy policy as a balance oracle. See `m12-2-character-creation.md`.

## M12-3 Companion Recruitment

| Risk | Player contract | Owner / evidence |
| --- | --- | --- |
| G-RECRUIT (G-ADVENTURE/G-LOADOUT/G-GROWTH) | Mandatory reward appends a unique NPC and only its owned starter; preserves current protagonist kit/growth and inventory; duplicate/full/invalid choices leave everything untouched; authored EXP is not retroactive; next encounter uses expanded party | Domain `recruitment.test.ts`, seed 65 |
| G-RECRUIT-SAVE (G-SAVE) | Pending and settled recruitment survive restore with current kit; wrong NPC/source/origin/duplicate/missing recruit/slot mapping is rejected; old Save 4 remains untouched | Domain `recruitment.test.ts` |
| B-RECRUIT (B-COMMIT) | No NPC/slot/starter/event is visible before durable commit; failed storage preserves pending reward; same-envelope retry commits once and survives real SQLite reopen | Integration `contracts/recruitment.test.ts`, seed 65, request `recruit-once-65` |
| U-RECRUIT | NPC standee/role/kit and read-only detail precede explicit confirmation; retry preserves selection; both ACK/snapshot orders gate completion; recruited member opens shared editable sheet; Continue does not automatically publish a Guest invitation | Interaction `recruitment.spec.ts`, 1024×768 |

The staged recruitment Tutorial and `--recruitment` playtest exercise actual authored Aerin recruitment. #67 owns the default-start cutover and the production J-PROGRESS conversion. See [M12-3](m12-3-companion-recruitment.md).


## M12-4 preparation Co-op (#66)

| Risk | Player contract | Lowest owning verification |
| --- | --- | --- |
| G-COOP / G-AUTHORITY | Existing companion allowlist only; unique claims; connected unselected Guest gates departure; offline unclaimed admission cannot block forever; preparation/Combat/Resume phase matrix, including valid saved reward/complete/failed refusal and unchanged Host Resume; solo cannot bypass growth/Loadout; restore clears delegation and preserves gameplay | Domain `coop-preparation.test.ts`, `authority.test.ts` |
| B-COOP / B-WIRE | Real HTTP reservations and simultaneous claims; latest-state resync; late attach refusal; claimed Combat reconnect; revoked credential refusal; serialized allow/join, attach/departure, Loadout/departure and solo/reconnect; failed or delayed solo commit cannot evict | Integration `contracts/coop-preparation.test.ts`, `contracts/http-coop.test.ts` |
| U-COOP / U-PREPARE | Host explicit share; no panel before recruitment or in restored reward/results; secret-free invitation; inert Guest detail and explicit ACK+snapshot claim/retry; waiting Guest explanation; solo confirm/cancel/failure; Resume gate; open Loadout becomes read-only on control loss | Interaction `coop-preparation.spec.ts`, `preparation.spec.ts` |

J-COOP uses a production recruitment-complete checkpoint and the explicit preparation allowance/selection UI. J-PROGRESS owns the actual 1-2-to-recruitment connection; neither duplicates the authority matrix in a browser.

## 독립 씬과 미네르바 환영

| Risk | Player contract | Lowest owning verification |
| --- | --- | --- |
| D-SCENE | 캐릭터 데이터 없이 재생; 오래된 페이지 입력과 반복 완료는 무효; skip/cancel 종료 한 번; 오디오 장애에도 대화 가능; 잘못된 표정 참조 검출 | Domain `scene.test.ts` |
| U-SCENE | 환영 표정/대사·전체 화면 클릭/터치/Enter/Space·건너뛰기·Escape, 키 반복/더블클릭/드래그/멀티터치/pointercancel 방지와 독립 터치 탭; 생성 입력 포커스; 매번 새 시도에 표시; 대화만으로 생성 요청 없음; Guest에는 미표시 | Interaction `scene.spec.ts`, seed 60; U-CREATE `creation.spec.ts`가 재인증/저장 실패 후 draft와 대화 생략을 소유; U-ENTRY `entry.spec.ts`가 인증 목적지와 Continue를 소유 |
| J-START | 실제 회원가입 → 미네르바 환영 → 생성 → 첫 전투 행동 연결 | Journey `start-continue.spec.ts`; 개별 입력/표정 조합은 반복하지 않음 |

아트 크기·알파·16종 좌표·대사 참조는 `tools/assets/check-scene-assets.ts`가 `check`에서 검사한다. 제작 산출물과 순서는 [미네르바 씬](minerva-scene-dialogue.md)에 있다.

### First practice opening (#67)

| Risk | Contract | Owner |
| --- | --- | --- |
| G-OPENING | 모든 생성 클래스와 모집 동료는 무기 공격 1장 + 준비 카드 1장; 준비 용량 유지; 연속 치명타에도 보호 전투 HP ≥ 1; 비보호 피해 정상; replay와 저장 복구에 보호 유지·변조 거부 | Domain `tutorial-opening.test.ts`, `saves.test.ts` |
| U-SCENE first battle | 보호 첫 전투 전장 위에 반투명 5페이지 안내, 배경 조작으로 입력 전달 없음, 완료/skip 전 요청 없음, 취소 시 포커스 복귀, 중복 요청 차단, 오류 재시도 시 생략, 세션 종료 시 오래된 완료 차단 | Interaction `scene.spec.ts`, seed 60 |
| J-START opening | 생성 전 환영 → 생성/저장 → 첫 전투 안내 → 실제 연습전 행동; 진행 전투 Resume에는 안내 없음 | Journey `start-continue.spec.ts` |

### 상태 대응 훈련 (#68)

| Risk | Contract | Owner |
| --- | --- | --- |
| G-PRONE | 전체 production preset·성별·seed opening, 실제 Prone·이동 제한·Stand 1 action, 정상 initiative 복귀, replay/save 변조 거부·Resume, Aerin 모집 | Domain `prone-training.test.ts` |
| B-PRONE | 서버 Trip commit 후 gate, Resume/중복 완료 멱등성 | Integration `contracts/prone-training.test.ts` |
| U-PRONE | authoritative snapshot 후 안내, 완료/skip/Escape, 오류 재시도·재연결, ACK+snapshot, 실제 Ring Stand intent 한 번 | Interaction `prone-training.spec.ts` |
| J-PROGRESS | 첫 승리·성장 → 1-2 Prone·실제 Ring Stand → 승리·Aerin 합류 | Journey `progress-coop.spec.ts` |

### 협공 훈련 (#69)

| Risk | Contract | Owner |
| --- | --- | --- |
| G-FLANK | 2인·기존 안드로이드, 전체 생성 클래스의 복수 이동 해법, 최초 비협공·이동 후 기존 resolver/AC·관계 해제, 기본/카드/주문 피해 무효·비용/RNG 유지, Rear/Prone만으로 우회 불가, 아군 둘 HP 1, 일반 전투 영향 없음, 모집·인원·원거리 장비 admission, save/replay | Domain `flanking-training.test.ts`; 일반 geometry/stacking은 기존 G-CONDITION/G-FACING 소유 |
| U-FLANK | 실제 모집 파티와 출발 전 안내, 안내만으로 행동 요청 없음, Host/Guest의 실제 보드 이동과 화면에 보이는 Flanking/아군/AC, stale preview 제거, Ranger 장비 해제 후 출발 | Interaction `flanking-training.spec.ts`, 1024×768 |
| J-PROGRESS | 1-2 승리 → Aerin 모집 → 준비 → 1-3 안내·이동·협공 Preview·실제 공격·승리 → Spear Line 준비 | Journey `progress-coop.spec.ts`; J-COOP는 같은 1-3의 기존 조작권 연결 |
