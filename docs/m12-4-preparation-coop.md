# M12-4 — Preparation Co-op (#66)

The persistent party stays owned by the Host's Campaign. The Host explicitly shares existing companion member IDs during preparation; guests reserve an admission via the session key and explicitly claim one shared companion. Aerin remains the existing Fighter chosen for #65; no content, equipment rules or art were regenerated.

## Live authority

`SessionCoreState.coopAllowedMemberIds` starts empty and is never saved or hashed. Claims remain one Guest per companion and one companion per Guest. Slot 1 and non-companion/foreign/duplicate IDs are rejected. Unshared, unclaimed or disconnected companions are controlled by the Host. Valid claims persist across encounters.

`session/coop.ts` owns the shared preparation, capacity, claim and departure rules. Active or restored ready/between-encounters without Combat are safe boundaries. A resume-lobby holding an unfinished saved Combat is also allowed. Reward/complete/failed deny admission/designation/selection in both active and resume-lobby; active Combat and pre-creation lobby also deny them. Resume may contain saved Combat; only live delegation changes before Resume, without rebuilding actors, equipment or Combat. Existing claimed credentials may reconnect after departure; new HTTP admissions may not.

HTTP admission reserves one allowed companion's capacity, up to two Guests. The existing SessionHost queue serializes admission, attach/detach, designation, selection, Loadout and departure. Claims do not identify a particular HTTP reservation in advance; every accepted Guest can choose one remaining target. Offline valid claims reserve their companion until explicit reclaim.

Normal departure/Resume checks every connected Guest has a valid claim. It does not wait for all shared companions to be claimed. Offline unclaimed admissions are removed at successful departure, and their credentials become invalid; late attach cannot become a spectator. Conflicting or stale requests receive rejection plus a fresh snapshot.

## Explicit reclaim and solo

`set-coop-allowed` accepts `revokeGuests` only as explicit confirmation. Removing a claimed target removes that Guest's seat and claim; reducing capacity removes excess unclaimed admissions deterministically. Affected Guests leave this live session and can use a new admission if another target is open. No hidden spectator remains.

`proceed-solo` first constructs and validates a complete departure/Resume candidate with live delegation cleared. Gameplay refusal leaves the original session intact. SessionHost awaits its durability boundary before publishing the candidate, invalidating removed credentials, deleting journals or closing sockets with terminal `COOP_ENDED` (4006). Persistence failure remains retryable with the same request ID. Revoked credentials cannot reconnect or send queued gameplay. Duplicate successful requests return their original result without applying again.

Growth and Loadout blockers still apply. The separate “Co-op 종료 · 조작권 회수” action explicitly stays in preparation so the Host can finish a disconnected companion's growth or kit before departure. This is not an active-Combat kick mechanism.

## UI

`CoopPreparationUi` is shared by active preparation and Resume. It is shown only at an allowed Co-op boundary with an existing companion; initial Solo retains normal Host departure without the delegation panel. It shows the protagonist as Host-only and companions with current name, existing standee, level, role, equipment, claimant and connection state. Information opens the existing read-only character sheet. Host sharing does not create a claim. Invitation/copy exposes only the session ID when admission capacity is available, never reconnect credentials.

Guests inspect, select a draft and explicitly confirm. Pending state waits for both ACK and applied snapshot; rejection retains a retryable selection and displays the reason. There is no extra Ready button. Connected unselected Guests disable normal departure/Resume with a waiting-name explanation. Solo and occupied-target reclaim have explicit confirmation/cancel. The existing editable character sheet consumes current effective control and invalidates stale comparisons when control changes.

Protocol is 13 and SessionCoreState is 5. Save 5, Adventure 6, Combat 6 and content identity remain unchanged. See the version table in `m12-1-member-foundation.md`.

## Verification ownership

- Domain: live-only hash/save boundary, valid IDs/capacity, phase/authority matrix, connected Guest departure gate, offline admission cleanup, unchanged refusal, growth/Loadout solo blockers, exact saved Combat Resume.
- Integration: real HTTP/WS admission/claim contention, fresh rejection snapshots, disconnect/reconnect, late attach, credential revocation, queue races, delayed/failed solo commit and same-request retry/deduplication.
- Interaction: explicit Host sharing/invitation, inert Guest detail, both ACK/snapshot orders and retry, departure/Resume waiting reason, solo confirmation/cancel/failure, stale Host Loadout control.
- Existing J-COOP follows the new preparation controls with its authored party precondition. #67 owns the actual new Chapter/recruitment journey and production cutover.

The initial #66 implementation local gate passed on 2026-09-21 with `CI=true npm run check && CI=true npm run test:all`:

| Layer | Result |
| --- | --- |
| Content/assets/TypeScript/ESLint/build | Passed |
| Domain | 118 passed |
| Integration | 23 passed |
| Interaction | 53 passed |
| Journey | 4 passed |
| Total behavioral cases | 198 passed |

Focused UI verification initially found a Loadout failure duplicated into the Co-op status. Error ownership was narrowed and the failed scenario passed before the complete final gate. No timeout or retry was increased. The deliberate renderer-initialization failure test passed; the existing bundle-size warning remained non-fatal.

The 1024×768 Host screenshot was inspected: normal encounter preparation/departure remains above the explicit companion panel, with current standees/kit, Host-only protagonist and Co-op controls. Physical iPad and remote GitHub CI were not verified. Only this verification record changed after the final gate; `git diff --check` was run afterward.


## Integration review correction (#62 comment 5756666604)

The [review](https://github.com/darkbard81/CardGuild/issues/62#issuecomment-5756666604) correctly identified that the original Resume predicate admitted reward/complete/failed, contrary to #62 section 3. All three cases were reproduced as failing Domain tests using public result transitions, save validation and `createResumedSessionCoreState()`, before changing the predicate.

The common predicate now permits Resume delegation only during preparation or unfinished saved Combat. Host designation, HTTP admission, Guest selection and the shared UI consume this rule. Normal Host Resume still opens the saved reward/result unchanged. The nonblocking Solo UX suggestion was also applied by hiding only the Co-op panel until a companion exists; server-side normal/explicit Solo departure remains available.

Regression ownership: Domain covers valid restored reward/complete/failed refusal plus unchanged Resume, unfinished/finished Combat boundaries and Solo departure. Interaction covers absent controls and normal departure before recruitment, plus reward/result screen return without Guest selection. No save/wire/content version changes are needed for this permission correction.

Correction verification passed: `CI=true npm run check && CI=true npm run test:all` — Domain **123**, Integration **23**, Interaction **57**, Journey **4**; **207 total**, no failures. The three regression cases failed against the original predicate and passed after correction. Only documentation changed after the complete final gate. This correction did not rerun remote CI or physical-device checks; the user's previously completed device validation is not being introduced as a new prerequisite.
