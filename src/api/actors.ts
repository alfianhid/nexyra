import { useEffect, useState } from "react";
import type { Role as ShellRole } from "../components/Shell";
import { request } from "./http";
import type { Actor, ActorListEntry } from "./types";

// The three actors the role picker may become. The ids are the ones server/seed.ts
// writes into the actors table; a header naming an actor that does not exist is
// refused with 403 role_not_permitted. This mapping stays on the client: it is what the
// picker means, not a copy of the server's list.
export const actors: Record<ShellRole, Actor> = {
  coordinator: { actor_id: "act_001", role: "coordination_staff", display_name: "R. Haddad" },
  physician: { actor_id: "act_003", role: "responsible_physician", display_name: "Dr. Fulan" },
  program_manager: { actor_id: "act_004", role: "program_manager", display_name: "A. Al Suwaidi" },
};

export function actorFor(role: ShellRole): Actor {
  return actors[role];
}

// TICKET-08 / TICKET-11: everyone the server knows, with the provider each works at, from
// GET /api/actors. Names printed for ids, the owner picker and the consultation addressee
// read this list; the server validates every id it receives against its own table.
export type RosterActor = Actor & { provider_id: string | null };

function toRoster(list: ActorListEntry[]): RosterActor[] {
  return list.map((a) => ({
    actor_id: a.actor_id,
    role: a.role,
    display_name: a.display_name,
    provider_id: a.provider?.provider_id ?? null,
  }));
}

let loaded: Promise<RosterActor[]> | null = null;

export function loadRoster(): Promise<RosterActor[]> {
  if (!loaded) {
    loaded = request<{ actors: ActorListEntry[] }>("/actors").then((r) => toRoster(r.actors));
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

// The roster once it has been read; an empty list until then (pickers render empty and
// names fall back to the ids the payload carries).
export function useRoster(): RosterActor[] {
  const [list, setList] = useState<RosterActor[]>([]);
  useEffect(() => {
    let live = true;
    loadRoster()
      .then((r) => {
        if (live) setList(r);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return list;
}

export function rosterActor(list: RosterActor[], actorId: string | null | undefined): RosterActor | undefined {
  return actorId ? list.find((a) => a.actor_id === actorId) : undefined;
}

// A name for an id the payload carries; the id itself when the roster does not know it.
export function actorName(list: RosterActor[], actorId: string | null | undefined): string {
  if (!actorId) return "nobody";
  return rosterActor(list, actorId)?.display_name ?? actorId;
}
