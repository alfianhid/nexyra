import { describe, expect, it } from "vitest";
import { actorName, rosterActor, type RosterActor } from "./api/actors";
import type { Action, CaseDetailResponse, Consultation } from "./api/types";
import {
  answerBody,
  answerProblem,
  canRecordMove,
  consultableProviders,
  defaultOwnerId,
  formatStamp,
  openConsultation,
  ownerCandidates,
  physiciansAt,
} from "./handoff";

// TICKET-08 / TICKET-11 screen helpers. The rules live on the server; these check that the
// screen reprints, defaults and shapes requests the way docs/api.md describes.

function consultation(status: string, id = "k_1"): Consultation {
  return {
    consultation_id: id,
    question: "Can you accept the referral?",
    requested_by_actor_id: "act_003",
    to_provider: { provider_id: "prov_hospital_b", name: "Hospital B" },
    to_actor_id: "act_006",
    referral_id: "REF-4377-1",
    requested_at: "2026-11-17T11:42:00+07:00",
    requested_label: "17 Nov 11:42",
    due_at: "2026-11-19T11:42:00+07:00",
    due_label: "19 Nov 11:42",
    task_id: "t_1",
    status,
    outcome: null,
    answer_note: null,
    answered_by_actor_id: null,
    answered_at: null,
    answered_label: null,
    hours_to_answer: null,
  };
}

// The shape GET /api/actors gives the screens (the seed's six people).
const ROSTER: RosterActor[] = [
  { actor_id: "act_001", role: "coordination_staff", display_name: "R. Haddad", provider_id: "prov_clinic_a" },
  { actor_id: "act_002", role: "navigator", display_name: "Nur H.", provider_id: "prov_clinic_b" },
  { actor_id: "act_003", role: "responsible_physician", display_name: "Dr. Fulan", provider_id: "prov_clinic_b" },
  { actor_id: "act_004", role: "program_manager", display_name: "A. Al Suwaidi", provider_id: null },
  { actor_id: "act_005", role: "coordination_staff", display_name: "S. Al Ali", provider_id: "prov_clinic_b" },
  { actor_id: "act_006", role: "responsible_physician", display_name: "Dr. Fulana", provider_id: "prov_hospital_b" },
];

function detail(status: string, actions: Action[]) {
  return { case: { status } as CaseDetailResponse["case"], available_actions: actions };
}

describe("formatStamp", () => {
  it("reprints the stamp's own wall-clock time without shifting zones", () => {
    expect(formatStamp("2026-11-16T15:40:00+07:00")).toBe("16 Nov 15:40");
    expect(formatStamp("2026-01-02T00:05:00Z")).toBe("2 Jan 00:05");
  });

  it("prints a dash for nothing and the text itself for anything it cannot read", () => {
    expect(formatStamp(null)).toBe("—");
    expect(formatStamp("")).toBe("—");
    expect(formatStamp("tomorrow")).toBe("tomorrow");
  });
});

describe("answerBody", () => {
  it("sends the new owner only on an unowned case", () => {
    expect(answerBody("accepted", { ownerActorId: "act_005", unowned: true })).toEqual({
      outcome: "accepted",
      owner_actor_id: "act_005",
    });
    expect(answerBody("accepted", { ownerActorId: "act_005", unowned: false })).toEqual({
      outcome: "accepted",
    });
  });

  it("names the redirect provider only on a redirect, and drops an empty note", () => {
    expect(
      answerBody("redirected", { redirectProviderId: "prov_endo_e", note: "  ", unowned: false }),
    ).toEqual({ outcome: "redirected", redirect_to_provider_id: "prov_endo_e" });
    expect(
      answerBody("more_data_requested", { redirectProviderId: "prov_endo_e", note: " Need history ", unowned: false }),
    ).toEqual({ outcome: "more_data_requested", note: "Need history" });
  });
});

describe("answerProblem", () => {
  it("asks for what the outcome needs before anything is sent", () => {
    expect(answerProblem("redirected", { unowned: false })).toMatch(/provider/);
    expect(answerProblem("accepted", { unowned: true })).toMatch(/no owner/);
    expect(answerProblem("accepted", { unowned: true, ownerActorId: "act_005" })).toBeNull();
    expect(answerProblem("more_data_requested", { unowned: false })).toBeNull();
  });
});

describe("defaults", () => {
  it("starts the owner picker on whoever holds the open assign-owner task", () => {
    const tasks = [
      { task_id: "t_old", kind: "assign_owner", owner: { actor_id: "act_001", role: "coordination_staff" as const, display_name: "R. Haddad" }, due_at: "", due_label: "", status: "done" },
      { task_id: "t_new", kind: "assign_owner", owner: { actor_id: "act_005", role: "coordination_staff" as const, display_name: "S. Al Ali" }, due_at: "", due_label: "", status: "open" },
    ];
    expect(defaultOwnerId({ tasks })).toBe("act_005");
    expect(defaultOwnerId({ tasks: [] })).toBeUndefined();
  });

  it("finds the open consultation", () => {
    expect(openConsultation([consultation("answered", "k_a"), consultation("open", "k_b")])?.consultation_id).toBe("k_b");
    expect(openConsultation([consultation("answered")])).toBeUndefined();
  });

  it("offers Dr. Fulana as the physician at hospital B, and never the program manager as owner", () => {
    expect(physiciansAt("prov_hospital_b", ROSTER).map((a) => a.display_name)).toEqual(["Dr. Fulana"]);
    expect(ownerCandidates(ROSTER).some((a) => a.role === "program_manager")).toBe(false);
    expect(ownerCandidates(ROSTER)).toHaveLength(ROSTER.length - 1);
    expect(rosterActor(ROSTER, "act_006")?.role).toBe("responsible_physician");
    expect(actorName(ROSTER, "act_404")).toBe("act_404");
    expect(actorName(ROSTER, null)).toBe("nobody");
  });
});

describe("canRecordMove", () => {
  it("follows the server's record_provider_move action on an open case", () => {
    expect(canRecordMove(detail("open", ["record_provider_move", "assign_owner"]))).toBe(true);
    expect(canRecordMove(detail("open", ["log_outreach", "assign_owner", "request_consultation"]))).toBe(false);
    expect(canRecordMove(detail("closed", ["record_provider_move"]))).toBe(false);
  });
});

describe("consultableProviders", () => {
  const providers = [
    { provider_id: "prov_clinic_a", name: "Clinic A" },
    { provider_id: "prov_clinic_b", name: "Clinic B" },
    { provider_id: "prov_endo_e", name: "Endoscopy Unit E" },
    { provider_id: "prov_hospital_b", name: "Hospital B" },
  ];

  it("offers only providers with a physician who can answer", () => {
    // The server refuses the others: Provider "prov_endo_e" has nobody who can answer a consultation.
    expect(consultableProviders(providers, ROSTER).map((p) => p.provider_id)).toEqual([
      "prov_clinic_b",
      "prov_hospital_b",
    ]);
  });

  it("keeps every provider until the roster has loaded", () => {
    expect(consultableProviders(providers, [])).toHaveLength(providers.length);
  });
});
