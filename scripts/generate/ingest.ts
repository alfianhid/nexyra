import type { Actor } from "../../server/actor.js";
import { getClock, setClock } from "../../server/clock.js";
import type { Db } from "../../server/db.js";
import { applyEvent, confirmCaseClosure, createCase, type WriteActor } from "../../server/events.js";
import { EXT, type DiagnosticReport, type Patient, type Resource } from "./fhir.js";
import type { GeneratedCase, WorkflowEvent } from "./generate.js";

// Generated cases enter the system the way real ones would: FHIR resources are read,
// turned into pathway events, and handed to the engine (`createCase`, `applyEvent`,
// `confirmCaseClosure`). Nothing here writes a case or event row, so every transition is
// checked by the engine's own rules. The one table written directly is `documents`, which
// is where the engine looks for closure evidence (a DiagnosticReport becomes a document).

export type CohortActors = {
  coordinators: Actor[];
  physician: Actor;
  system: WriteActor;
};

export async function loadCohortActors(db: Db): Promise<CohortActors> {
  const rows = await db
    .prepare("SELECT id, role, display_name FROM actors ORDER BY id")
    .all<{ id: string; role: string; display_name: string }>();
  const as = (row: { id: string; role: string; display_name: string }): Actor => ({
    actor_id: row.id,
    role: row.role as Actor["role"],
    display_name: row.display_name,
  });
  const coordinators = rows.filter((r) => r.role === "coordination_staff").map(as);
  const physician = rows.filter((r) => r.role === "responsible_physician").map(as)[0];
  if (coordinators.length === 0 || !physician) {
    throw new Error(
      "The database has no coordination staff or no responsible physician. Run `npm run demo:reset` first.",
    );
  }
  const system = rows.find((r) => r.role === "system");
  return {
    coordinators,
    physician,
    system: {
      actor_id: system?.id ?? "act_system",
      role: "system",
      display_name: system?.display_name ?? "system",
    },
  };
}

type Call =
  | { at: string; rank: number; kind: "create"; patient: { name: string; age: number; language: string }; payload: Record<string, unknown> }
  | { at: string; rank: number; kind: "event"; type: string; actor: WriteActor; payload: Record<string, unknown> }
  | { at: string; rank: number; kind: "closure"; actor: WriteActor; outcome: string }
  | { at: string; rank: number; kind: "document"; id: string; docKind: string; title: string; text: string };

function ageAt(birthDate: string, on: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [oy, om, od] = on.split("-").map(Number) as [number, number, number];
  return oy - by - (om < bm || (om === bm && od < bd) ? 1 : 0);
}

function extension(resource: { extension: { url: string; valueDateTime?: string; valueString?: string }[] }, url: string) {
  return resource.extension.find((e) => e.url === url);
}

const OUTCOME_REASON: Record<string, string> = {
  rejected: "Receiving provider rejected the referral",
  patient_changed_provider: "Patient changed provider, referral withdrawn",
};

// Reads one generated case's resources and workflow facts into an ordered list of engine
// calls. Pure: no database access, so it can be tested on its own.
export function bundleToCalls(generated: GeneratedCase, actors: CohortActors): Call[] {
  const owner = actors.coordinators[generated.coordinatorSlot % actors.coordinators.length] as Actor;
  const physician = actors.physician;
  const system = actors.system;
  const calls: Call[] = [];
  const resources = generated.bundle.entry.map((e) => e.resource);
  const byType = <T extends Resource["resourceType"]>(type: T) =>
    resources.filter((r): r is Extract<Resource, { resourceType: T }> => r.resourceType === type);

  const patient = byType("Patient")[0] as Patient;
  const fit = byType("Observation")[0];
  if (!patient || !fit) throw new Error(`Case ${generated.caseId}: bundle has no Patient or FIT Observation.`);

  calls.push({
    at: fit.issued,
    rank: 0,
    kind: "create",
    patient: {
      name: patient.name[0]?.text ?? "",
      age: ageAt(patient.birthDate, fit.effectiveDateTime.slice(0, 10)),
      language: patient.communication[0]?.language.coding?.[0]?.code ?? "en",
    },
    payload: { summary: `Case created from synthetic FIT result ${patient.identifier[0]?.value ?? ""}` },
  });

  for (const sr of byType("ServiceRequest")) {
    const provider = sr.performer[0]?.display ?? "receiving provider";
    if (sr.code.coding?.[0]?.code === "pathology-order") {
      calls.push({
        at: sr.authoredOn,
        rank: 0,
        kind: "event",
        type: "pathology_ordered",
        actor: physician,
        payload: { summary: "Pathology ordered" },
      });
      continue;
    }
    const kind = extension(sr, EXT.referralKind)?.valueString;
    if (kind !== "repeat-after-incomplete") {
      calls.push({
        at: sr.authoredOn,
        rank: 0,
        kind: "event",
        type: "referral_sent",
        actor: owner,
        payload: { summary: `Referral sent to ${provider}` },
      });
    }
    const rejectedAt = extension(sr, EXT.rejectedAt)?.valueDateTime;
    if (rejectedAt) {
      const reason = extension(sr, EXT.rejectionReason)?.valueString ?? "rejected";
      calls.push({
        at: rejectedAt,
        rank: 0,
        kind: "event",
        type: "referral_rejected",
        actor: system,
        payload: { reason, summary: OUTCOME_REASON[reason] ?? "Referral rejected" },
      });
    }
    const acceptedAt = extension(sr, EXT.acceptedAt)?.valueDateTime;
    if (acceptedAt) {
      calls.push({
        at: acceptedAt,
        rank: 0,
        kind: "event",
        type: "referral_accepted",
        actor: system,
        payload: { summary: `${provider} accepted the referral` },
      });
    }
  }

  for (const appointment of byType("Appointment")) {
    calls.push({
      at: appointment.created,
      rank: 0,
      kind: "event",
      type: "colonoscopy_booked",
      actor: owner,
      payload: { summary: `Colonoscopy booked for ${appointment.start.slice(0, 10)}`, appointment_start: appointment.start },
    });
  }

  for (const procedure of byType("Procedure")) {
    calls.push({
      at: procedure.performedDateTime,
      rank: 0,
      kind: "event",
      type: "colonoscopy_performed",
      actor: system,
      payload: { summary: "Colonoscopy recorded as completed", outcome_text: procedure.outcome.text },
    });
  }

  for (const report of byType("DiagnosticReport") as DiagnosticReport[]) {
    const code = report.category[0]?.coding?.[0]?.code ?? "";
    // A document goes in after the event at the same instant, never before it.
    calls.push({
      at: report.issued,
      rank: 1,
      kind: "document",
      id: `d_${report.id}`,
      docKind: code,
      title: report.code.text ?? "Report",
      text: report.conclusion,
    });
    if (code === "pathology") {
      calls.push({
        at: report.issued,
        rank: 0,
        kind: "event",
        type: "pathology_received",
        actor: system,
        payload: { summary: "Pathology result received" },
      });
    }
  }

  const person = (by: WorkflowEvent["by"]): Actor => (by === "physician" ? physician : owner);
  for (const w of generated.workflow) {
    if (w.type === "closure_confirmed") {
      calls.push({ at: w.at, rank: 0, kind: "closure", actor: physician, outcome: w.outcome ?? "" });
      continue;
    }
    const actor = person(w.by);
    const payload: Record<string, unknown> = { summary: w.summary };
    if (w.assignTo) payload.owner_actor_id = person(w.assignTo).actor_id;
    if (w.outcome) payload.outcome = w.outcome;
    calls.push({ at: w.at, rank: 0, kind: "event", type: w.type, actor, payload });
  }

  return calls
    .map((call, order) => ({ call, order }))
    .sort(
      (a, b) =>
        Date.parse(a.call.at) - Date.parse(b.call.at) || a.call.rank - b.call.rank || a.order - b.order,
    )
    .map(({ call }) => call);
}

export type IngestResult = { created: number; skipped: number; events: number };

// Feeds the cohort to the engine. The engine stamps events with the demo clock, so the
// clock is set to each event's own time before the call and put back at the end.
export async function ingestCohort(
  db: Db,
  cohort: readonly GeneratedCase[],
  options: { onProgress?: (done: number, total: number) => void } = {},
): Promise<IngestResult> {
  const actors = await loadCohortActors(db);
  const original = await getClock(db);
  let created = 0;
  let skipped = 0;
  let events = 0;

  try {
    for (const [index, generated] of cohort.entries()) {
      if (!generated.caseId.startsWith("SY-")) {
        throw new Error(`Refusing to write case ${generated.caseId}: cohort ids start with SY-.`);
      }
      const existing = await db.prepare("SELECT id FROM cases WHERE id = ?").get(generated.caseId);
      if (existing) {
        skipped += 1;
        continue;
      }
      const owner = actors.coordinators[generated.coordinatorSlot % actors.coordinators.length] as Actor;

      for (const call of bundleToCalls(generated, actors)) {
        await setClock(db, call.at, original.day);
        switch (call.kind) {
          case "create":
            await createCase(db, {
              caseId: generated.caseId,
              patient: call.patient,
              actor: actors.system,
              ownerActorId: owner.actor_id,
              payload: call.payload,
            });
            events += 1;
            break;
          case "event":
            await applyEvent(db, {
              caseId: generated.caseId,
              type: call.type,
              actor: call.actor,
              payload: call.payload,
            });
            events += 1;
            break;
          case "closure":
            await confirmCaseClosure(db, {
              caseId: generated.caseId,
              actor: call.actor,
              finalOutcome: call.outcome,
            });
            events += 1;
            break;
          case "document":
            await db
              .prepare(
                "INSERT OR IGNORE INTO documents (id, case_id, kind, title, text) VALUES (?, ?, ?, ?, ?)",
              )
              .run(call.id, generated.caseId, call.docKind, call.title, call.text);
            break;
        }
      }
      created += 1;
      options.onProgress?.(index + 1, cohort.length);
    }
  } finally {
    await setClock(db, original.now, original.day);
  }
  return { created, skipped, events };
}
