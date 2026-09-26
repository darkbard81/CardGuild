import { assertSessionInvariants } from "../session/authority";
import { validateGameplayShape } from "./gameplay-schema";
import type { ServerSnapshot } from "./v15-types";

/** Reject malformed persistent identity before any UI consumes a server snapshot. */
export function validateSnapshotState(snapshot: ServerSnapshot): boolean {
  try {
    const state = snapshot.state;
    assertSessionInvariants(state);
    if (snapshot.revision !== state.revision) return false;
    return validateGameplayShape(state);
  } catch { return false; }
}
