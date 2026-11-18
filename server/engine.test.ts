import { describe, expect, it } from "vitest";
import {
  ROLES,
  availableActions,
  canPerform,
  closureConditions,
  confirmClosure,
  isOpen,
  ownerAfter,
  transitionFor,
  type Action,
  type EngineCase,
  type Role,
} from "./engine";

// TICKET-05 done-when is the shape of this file: a walk to `closed`, skipped stages
// rejected, each closure condition refused on its own, and role refusals named.

function at(stage: string, patch: Partial<EngineCase> = {}): EngineCase {
  return {
    stage,
    status: stage === "closed" ? "closed" : "open",
    owner_actor_id: "act_001",
    final_outcome: null,
    documents: [],
    physician_confirmed: false,
    ...patch,
  };
}

const closureReady = (): EngineCase =>
  at("closure_proposed", {
    final_outcome: "returned_to_routine_screening",
    documents: [{ kind: "colonoscopy" }],
  });

describe("pathway transitions", () => {
  it("runs a case from result_received to closed through a valid sequence", () => {
    // The template's stage list (TICKET-04): the referral hand-off and the procedure
    // itself now sit between the result and pathology.
    const sequence = [
      "patient_notified",
      "referral_sent",
      "referral_accepted",
      "colonoscopy_booked",
      "colonoscopy_performed",
      "pathology_ordered",
      "pathology_received",
      "closure_proposed",
      "closure_confirmed",
      "case_closed",
    ];

    let stage = "result_received";
    for (const type of sequence) {
      const result = transitionFor(stage, type, "responsible_physician");
      expect(result.ok, `${type} from ${stage}`).toBe(true);
      if (result.ok) stage = result.to;
    }

    expect(stage).toBe("closed");
  });

  it.each([
    ["patient_notified", "result_received"],
    ["referral_sent", "patient_notified"],
    ["referral_accepted", "referral_sent"],
    ["colonoscopy_booked", "referral_accepted"],
    ["colonoscopy_performed", "colonoscopy_booked"],
    ["pathology_ordered", "procedure_completed"],
    ["pathology_received", "pathology_ordered"],
    ["closure_proposed", "pathology_received"],
    ["closure_confirmed", "closure_proposed"],
    ["case_closed", "closure_confirmed"],
    ["procedure_incomplete", "procedure_completed"],
    ["procedure_incomplete", "pathology_ordered"],
    ["procedure_incomplete", "pathology_received"],
    ["procedure_incomplete", "closure_proposed"],
    ["referral_rejected", "referral_sent"],
    ["reopened", "closure_confirmed"],
    ["reopened", "closed"],
  ])("allows %s from %s", (type, from) => {
    expect(transitionFor(from, type, "coordination_staff").ok).toBe(true);
  });

  it.each([
    ["pathology_received", "result_received"],
    ["pathology_ordered", "result_received"],
    ["case_closed", "result_received"],
    ["closure_confirmed", "pathology_received"],
    ["colonoscopy_booked", "pathology_received"],
    ["case_closed", "closed"],
    ["unknown_event", "result_received"],
    // Legal in the old seven-stage list, skipped stages in the template's list.
    ["colonoscopy_booked", "result_received"],
    ["referral_rejected", "result_received"],
    ["colonoscopy_booked", "patient_notified"],
    ["procedure_incomplete", "colonoscopy_booked"],
  ])("rejects %s from %s (no skipped stages, no unknown events)", (type, from) => {
    const result = transitionFor(from, type, "coordination_staff");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid_transition");
  });

  it("keeps an owner on every forward transition", () => {
    const forward = [
      "patient_notified",
      "referral_sent",
      "referral_accepted",
      "colonoscopy_booked",
      "colonoscopy_performed",
      "pathology_ordered",
      "pathology_received",
      "closure_proposed",
    ];
    let stage = "result_received";

    for (const type of forward) {
      const result = transitionFor(stage, type, "coordination_staff");
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const owner = ownerAfter(at(stage), type, null);
      expect(owner).not.toBeNull();
      stage = result.to;
    }
  });

  it("reopens an incomplete colonoscopy and assigns an owner", () => {
    const incomplete = at("pathology_received", { owner_actor_id: null });
    const result = transitionFor("pathology_received", "procedure_incomplete", "responsible_physician");

    expect(result.ok).toBe(true);
    // TICKET-05: an incomplete examination returns the case to referral_sent (the old
    // seven-stage list had no referral stage, so it went back to result_received).
    if (result.ok) expect(result.to).toBe("referral_sent");
    expect(ownerAfter(incomplete, "procedure_incomplete", "act_003")).toBe("act_003");
  });

  it("only the rejected referral produces the explicit unowned state", () => {
    expect(ownerAfter(at("result_received"), "referral_rejected", "act_001")).toBeNull();
    expect(isOpen(at("result_received"))).toBe(true);
  });

  it("refuses a system-role transition into closure", () => {
    const result = transitionFor("closure_proposed", "closure_confirmed", "system");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("role_not_permitted");
  });
});

describe("available actions per role and stage", () => {
  it.each<[Role, string, Action, boolean]>([
    ["coordination_staff", "result_received", "advance_case", true],
    ["navigator", "pathology_received", "advance_case", true],
    ["coordination_staff", "closure_proposed", "advance_case", false],
    ["responsible_physician", "result_received", "advance_case", false],
    ["responsible_physician", "closure_proposed", "confirm_closure", true],
    ["responsible_physician", "closure_proposed", "reject_proposal", true],
    ["coordination_staff", "closure_proposed", "confirm_closure", false],
    ["navigator", "closure_proposed", "confirm_closure", false],
    ["program_manager", "closure_proposed", "confirm_closure", false],
    ["program_manager", "result_received", "advance_case", false],
    ["coordination_staff", "closed", "reopen_case", false],
    ["responsible_physician", "closed", "reopen_case", true],
  ])("%s at %s: %s = %s", (role, stage, action, allowed) => {
    expect(canPerform(at(stage), role, action)).toBe(allowed);
  });

  it("gives the program manager no case action at any stage", () => {
    for (const stage of ["result_received", "closure_proposed", "closed"]) {
      expect(availableActions(at(stage), "program_manager")).toEqual([]);
    }
  });

  it("offers owner assignment only while the case is unowned", () => {
    expect(canPerform(at("result_received"), "navigator", "assign_owner")).toBe(false);
    expect(
      canPerform(at("result_received", { owner_actor_id: null }), "navigator", "assign_owner"),
    ).toBe(true);
  });

  it("derives every role's action list from the same function", () => {
    // canPerform must never disagree with the payload's available_actions.
    for (const role of ROLES) {
      const actions = availableActions(closureReady(), role);
      for (const action of ["confirm_closure", "reopen_case", "advance_case"] as Action[]) {
        expect(canPerform(closureReady(), role, action)).toBe(actions.includes(action));
      }
    }
  });
});

describe("closure rules", () => {
  it("allows the responsible physician when all three conditions hold", () => {
    const result = confirmClosure(closureReady(), "responsible_physician");
    expect(result.allowed).toBe(true);
  });

  it("rejects closure when the final outcome is missing", () => {
    const result = confirmClosure(
      at("closure_proposed", { documents: [{ kind: "colonoscopy" }] }),
      "responsible_physician",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("closure_conditions_unmet");
      expect(result.details).toEqual({
        final_outcome: false,
        evidence_attached: true,
        physician_confirmation: true,
      });
    }
  });

  it("rejects closure when no evidence is attached", () => {
    const result = confirmClosure(
      at("closure_proposed", { final_outcome: "surveillance_scheduled" }),
      "responsible_physician",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe("closure_conditions_unmet");
      expect(result.details?.evidence_attached).toBe(false);
    }
  });

  it("rejects closure when the acting role is not the responsible physician", () => {
    for (const role of ["coordination_staff", "navigator", "program_manager"] as Role[]) {
      const result = confirmClosure(closureReady(), role);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.code).toBe("role_not_permitted");
    }
  });

  it("never lets the system role close a case, even with every condition met", () => {
    const result = confirmClosure(closureReady(), "system");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.code).toBe("role_not_permitted");
  });

  it("treats an outcome outside the closed vocabulary as not recorded", () => {
    const conditions = closureConditions(
      closureReady(),
      "responsible_physician",
    );
    expect(conditions.final_outcome).toBe(true);

    const unknown = closureConditions(
      at("closure_proposed", {
        final_outcome: "discharged",
        documents: [{ kind: "pathology" }],
      }),
      "responsible_physician",
    );
    expect(unknown.final_outcome).toBe(false);
  });
});
