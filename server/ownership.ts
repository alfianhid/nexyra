import { hoursBetween } from "./clock.js";
import { nextState, type CaseState, type RecordedEvent } from "./engine.js";

// TICKET-08: the "time from trigger to owned again" metric, as a fold over the timeline.
// applyEvent keeps `ownership_gaps` up to date one event at a time; the seed uses this
// fold to write the same rows for its fixed histories, so both read the owner the same
// way the engine does (nextState).

export type OwnershipGap = {
  trigger_index: number;
  trigger_type: string;
  reason: string;
  previous_owner_actor_id: string | null;
  unowned_at: string;
  owner_index: number | null;
  owner_event_type: string | null;
  owner_actor_id: string | null;
  owned_at: string | null;
  hours_to_owner: number | null;
};

export function gapReason(payload: Record<string, unknown>): string {
  if (typeof payload.reason === "string" && payload.reason.length > 0) return payload.reason;
  if (typeof payload.summary === "string") return payload.summary;
  return "";
}

export function roundHours(hours: number): number {
  return Math.round(hours * 10) / 10;
}

export function ownershipGaps(events: readonly RecordedEvent[]): OwnershipGap[] {
  const gaps: OwnershipGap[] = [];
  let state: CaseState | null = null;

  events.forEach((event, index) => {
    const before = state;
    state = nextState(state, event);
    if (!before || !state) return;

    const open = gaps.find((gap) => gap.owned_at === null);
    if (before.owner_actor_id !== null && state.owner_actor_id === null) {
      gaps.push({
        trigger_index: index,
        trigger_type: event.type,
        reason: gapReason(event.payload),
        previous_owner_actor_id: before.owner_actor_id,
        unowned_at: event.occurred_at,
        owner_index: null,
        owner_event_type: null,
        owner_actor_id: null,
        owned_at: null,
        hours_to_owner: null,
      });
    } else if (before.owner_actor_id === null && state.owner_actor_id !== null && open) {
      open.owner_index = index;
      open.owner_event_type = event.type;
      open.owner_actor_id = state.owner_actor_id;
      open.owned_at = event.occurred_at;
      open.hours_to_owner = roundHours(hoursBetween(open.unowned_at, event.occurred_at));
    }
  });

  return gaps;
}
