// The slice of FHIR R4 the generator writes and the ingest step reads. Only the fields we
// use are typed; nothing here claims to be a conformant profile.

export const SYNTHETIC_TAG = {
  system: "https://nexyra.example/fhir/CodeSystem/data-origin",
  code: "SYNTHETIC",
  display: "Synthetic data, not a real patient",
};

export const EXT = {
  referralKind: "https://nexyra.example/fhir/StructureDefinition/referral-kind",
  acceptedAt: "https://nexyra.example/fhir/StructureDefinition/referral-accepted-at",
  rejectedAt: "https://nexyra.example/fhir/StructureDefinition/referral-rejected-at",
  rejectionReason: "https://nexyra.example/fhir/StructureDefinition/referral-rejection-reason",
} as const;

export type Coding = { system?: string; code?: string; display?: string };
export type CodeableConcept = { coding?: Coding[]; text?: string };
export type Reference = { reference?: string; display?: string };
export type Extension = { url: string; valueDateTime?: string; valueString?: string };

type Base = { id: string; meta: { tag: Coding[] } };

export type Patient = Base & {
  resourceType: "Patient";
  identifier: { system: string; value: string }[];
  name: { text: string; family: string; given: string[] }[];
  birthDate: string;
  communication: { language: CodeableConcept; preferred: boolean }[];
};

export type Observation = Base & {
  resourceType: "Observation";
  status: "final";
  code: CodeableConcept;
  subject: Reference;
  effectiveDateTime: string;
  issued: string;
  valueCodeableConcept: CodeableConcept;
  interpretation: CodeableConcept[];
};

export type ServiceRequest = Base & {
  resourceType: "ServiceRequest";
  status: "active" | "completed" | "revoked";
  intent: "order";
  code: CodeableConcept;
  subject: Reference;
  authoredOn: string;
  requester: Reference;
  performer: Reference[];
  extension: Extension[];
};

export type Appointment = Base & {
  resourceType: "Appointment";
  status: "booked" | "fulfilled" | "noshow";
  created: string;
  start: string;
  basedOn: Reference[];
  participant: { actor: Reference; status: "accepted" }[];
};

export type Procedure = Base & {
  resourceType: "Procedure";
  status: "completed";
  code: CodeableConcept;
  subject: Reference;
  performedDateTime: string;
  performer: { actor: Reference }[];
  outcome: CodeableConcept;
};

export type DiagnosticReport = Base & {
  resourceType: "DiagnosticReport";
  status: "final";
  category: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  issued: string;
  performer: Reference[];
  conclusion: string;
  conclusionCode: CodeableConcept[];
};

export type Resource =
  | Patient
  | Observation
  | ServiceRequest
  | Appointment
  | Procedure
  | DiagnosticReport;

export type Bundle = {
  resourceType: "Bundle";
  type: "collection";
  id: string;
  meta: { tag: Coding[] };
  entry: { resource: Resource }[];
};

export const CODE_SYSTEM = "https://nexyra.example/fhir/CodeSystem/synthetic-codes";
