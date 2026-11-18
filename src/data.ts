// Mirrors server/pathways/fit-colonoscopy.json for the fixture adapter only; the live
// app renders the stage list the server sends.
export type StageId =
  | "result_received"
  | "patient_notified"
  | "referral_sent"
  | "referral_accepted"
  | "colonoscopy_booked"
  | "procedure_completed"
  | "pathology_ordered"
  | "pathology_received"
  | "closure_proposed"
  | "closure_confirmed"
  | "closed";

export const stages: { id: StageId; label: string; short: string }[] = [
  { id: "result_received", label: "Result received", short: "Result" },
  { id: "patient_notified", label: "Patient notified", short: "Notified" },
  { id: "referral_sent", label: "Referral sent", short: "Referral" },
  { id: "referral_accepted", label: "Referral accepted", short: "Accepted" },
  { id: "colonoscopy_booked", label: "Colonoscopy booked", short: "Booked" },
  { id: "procedure_completed", label: "Colonoscopy done", short: "Done" },
  { id: "pathology_ordered", label: "Pathology ordered", short: "Ordered" },
  { id: "pathology_received", label: "Pathology received", short: "Received" },
  { id: "closure_proposed", label: "Closure proposed", short: "Proposed" },
  { id: "closure_confirmed", label: "Closure confirmed", short: "Confirmed" },
  { id: "closed", label: "Closed", short: "Closed" },
];

export type Outcome =
  | "returned_to_routine_screening"
  | "surveillance_scheduled"
  | "oncology_accepted_therapy_started";

export const outcomeLabels: Record<Outcome, string> = {
  returned_to_routine_screening: "Returned to routine screening",
  surveillance_scheduled: "Surveillance scheduled",
  oncology_accepted_therapy_started: "Oncology accepted, therapy started",
};

export type CaseState = "late" | "due" | "normal" | "closed";

export type Evidence = {
  field: string;
  value: string;
  quote: string;
  offset: number;
  source: string;
  readAt: string;
};

export type CaseEvent = {
  at: string;
  actor: string;
  what: string;
  audit: string;
};

export type Case = {
  ref: string;
  patient: string;
  initials: string;
  age: number;
  stage: StageId;
  owner: string | null;
  dueLabel: string;
  hoursLeft: number | null;
  state: CaseState;
  citations: number;
  outcome?: Outcome;
  evidence: Evidence[];
  events: CaseEvent[];
  attempts: OutreachAttempt[];
};

export type OutreachAttempt = {
  n: number;
  at: string;
  channel: "call" | "sms" | "letter";
  result: string;
  minutes: number;
};

export const cases: Case[] = [
  {
    ref: "CX-0409",
    patient: "M. Rahman",
    initials: "MR",
    age: 61,
    stage: "colonoscopy_booked",
    owner: "S. Al Ali",
    dueLabel: "17 Nov 14:00",
    hoursLeft: -3,
    state: "late",
    citations: 0,
    evidence: [],
    events: [
      { at: "15 Nov 09:12", actor: "system", what: "Case created from FIT result 4412/26", audit: "#0912" },
      { at: "15 Nov 11:40", actor: "S. Al Ali", what: "Colonoscopy booked, Al Zahra Hospital", audit: "#0931" },
      { at: "17 Nov 11:00", actor: "system", what: "Deadline passed, escalated to program manager", audit: "#1102" },
    ],
    attempts: [
      { n: 1, at: "16 Nov 09:05", channel: "call", result: "No answer", minutes: 2 },
      { n: 2, at: "16 Nov 15:20", channel: "sms", result: "Delivered, replied asking for date change", minutes: 1 },
    ],
  },
  {
    ref: "CX-0417",
    patient: "A. Al Mansoori",
    initials: "AM",
    age: 58,
    stage: "pathology_received",
    owner: "R. Haddad",
    dueLabel: "18 Nov 09:00",
    hoursLeft: 21,
    state: "due",
    citations: 3,
    evidence: [
      {
        field: "Primary finding",
        value: "Adenocarcinoma, sigmoid colon",
        quote: "Invasive adenocarcinoma, moderately differentiated, sigmoid colon, pT2 pN0.",
        offset: 412,
        source: "pathology-report-16-11.pdf",
        readAt: "17 Nov 09:41",
      },
      {
        field: "Secondary finding",
        value: "2 tubular adenomas",
        quote: "Two tubular adenomas identified in the ascending colon, 6 mm and 9 mm.",
        offset: 968,
        source: "pathology-report-16-11.pdf",
        readAt: "17 Nov 09:41",
      },
      {
        field: "Recommended interval",
        value: "3 years",
        quote: "Recommend surveillance colonoscopy in 3 years if no further intervention.",
        offset: 1440,
        source: "pathology-report-16-11.pdf",
        readAt: "17 Nov 09:41",
      },
    ],
    events: [
      { at: "12 Nov 08:30", actor: "system", what: "Case created from FIT result 4390/26", audit: "#0871" },
      { at: "13 Nov 14:02", actor: "R. Haddad", what: "Colonoscopy booked, 16 Nov", audit: "#0904" },
      { at: "16 Nov 17:55", actor: "system", what: "Pathology result received", audit: "#1042" },
      { at: "17 Nov 09:41", actor: "system", what: "3 findings extracted with citations", audit: "#1055" },
    ],
    attempts: [
      { n: 1, at: "13 Nov 10:15", channel: "call", result: "Appointment agreed", minutes: 4 },
    ],
  },
  {
    ref: "CX-0460",
    patient: "K. Nasser",
    initials: "KN",
    age: 57,
    stage: "result_received",
    owner: null,
    dueLabel: "18 Nov 12:00",
    hoursLeft: 24,
    state: "due",
    citations: 0,
    evidence: [],
    events: [
      { at: "16 Nov 10:20", actor: "system", what: "Case created from lab result, no coordinator matched", audit: "#1011" },
      { at: "17 Nov 10:20", actor: "system", what: "Unowned for 24h, escalated", audit: "#1101" },
    ],
    attempts: [],
  },
  {
    ref: "CX-0431",
    patient: "F. Ibrahim",
    initials: "FI",
    age: 54,
    stage: "result_received",
    owner: null,
    dueLabel: "19 Nov 11:00",
    hoursLeft: 47,
    state: "due",
    citations: 0,
    evidence: [],
    events: [{ at: "17 Nov 07:00", actor: "system", what: "Case created from lab result, no coordinator matched", audit: "#1090" }],
    attempts: [],
  },
  {
    ref: "CX-0444",
    patient: "N. Karim",
    initials: "NK",
    age: 66,
    stage: "pathology_ordered",
    owner: "R. Haddad",
    dueLabel: "20 Nov 16:00",
    hoursLeft: 76,
    state: "normal",
    citations: 0,
    evidence: [],
    events: [
      { at: "14 Nov 09:00", actor: "system", what: "Case created from FIT result 4401/26", audit: "#0944" },
      { at: "17 Nov 11:10", actor: "R. Haddad", what: "Pathology ordered, specimen collected", audit: "#1109" },
    ],
    attempts: [],
  },
  {
    ref: "CX-0398",
    patient: "J. Thomas",
    initials: "JT",
    age: 72,
    stage: "closure_confirmed",
    owner: "S. Al Ali",
    dueLabel: "21 Nov 08:00",
    hoursLeft: 92,
    state: "normal",
    citations: 1,
    outcome: "surveillance_scheduled",
    evidence: [
      {
        field: "Recommended interval",
        value: "3 years",
        quote: "Recommend surveillance colonoscopy in 3 years.",
        offset: 1440,
        source: "pathology-report-09-11.pdf",
        readAt: "14 Nov 10:02",
      },
    ],
    events: [
      { at: "09 Nov 08:00", actor: "system", what: "Case created from FIT result 4302/26", audit: "#0810" },
      { at: "14 Nov 10:02", actor: "system", what: "Closure proposed with 1 citation", audit: "#0899" },
      { at: "15 Nov 09:30", actor: "Dr. Fulan", what: "Closure confirmed, surveillance scheduled", audit: "#0901" },
    ],
    attempts: [],
  },
  {
    ref: "CX-0452",
    patient: "H. Saleh",
    initials: "HS",
    age: 49,
    stage: "closure_proposed",
    owner: "Dr. Fulan",
    dueLabel: "17 Nov 10:00",
    hoursLeft: -2,
    state: "due",
    citations: 2,
    evidence: [
      {
        field: "Primary finding",
        value: "No malignancy",
        quote: "Sections show no evidence of malignancy. Hyperplastic polyp, descending colon.",
        offset: 288,
        source: "pathology-report-15-11.pdf",
        readAt: "16 Nov 08:10",
      },
      {
        field: "Proposed outcome",
        value: "Returned to routine screening",
        quote: "Return to routine screening interval; no surveillance indicated.",
        offset: 1301,
        source: "pathology-report-15-11.pdf",
        readAt: "16 Nov 08:10",
      },
    ],
    events: [
      { at: "11 Nov 09:00", actor: "system", what: "Case created from FIT result 4381/26", audit: "#0864" },
      { at: "16 Nov 08:10", actor: "system", what: "Closure proposed: returned_to_routine_screening", audit: "#1010" },
      { at: "17 Nov 10:00", actor: "system", what: "Clinician deadline passed", audit: "#1100" },
    ],
    attempts: [],
  },
  {
    ref: "CX-0451",
    patient: "P. George",
    initials: "PG",
    age: 64,
    stage: "closure_proposed",
    owner: "Dr. Fulan",
    dueLabel: "18 Nov 10:00",
    hoursLeft: 22,
    state: "due",
    citations: 1,
    evidence: [
      {
        field: "Primary finding",
        value: "Tubular adenoma, low grade",
        quote: "Tubular adenoma with low-grade dysplasia, 12 mm, completely excised.",
        offset: 356,
        source: "pathology-report-16-11.pdf",
        readAt: "17 Nov 07:20",
      },
    ],
    events: [
      { at: "12 Nov 09:00", actor: "system", what: "Case created from FIT result 4395/26", audit: "#0877" },
      { at: "17 Nov 07:20", actor: "system", what: "Closure proposed: returned_to_routine_screening", audit: "#1071" },
    ],
    attempts: [],
  },
  {
    ref: "CX-0465",
    patient: "S. Al Nuaimi",
    initials: "SN",
    age: 55,
    stage: "pathology_ordered",
    owner: "S. Al Ali",
    dueLabel: "19 Nov 15:00",
    hoursLeft: 51,
    state: "normal",
    citations: 0,
    evidence: [],
    events: [{ at: "16 Nov 09:00", actor: "system", what: "Specimen in transit to lab", audit: "#1024" }],
    attempts: [],
  },
  {
    ref: "CX-0470",
    patient: "R. Menon",
    initials: "RM",
    age: 68,
    stage: "pathology_ordered",
    owner: "R. Haddad",
    dueLabel: "20 Nov 11:00",
    hoursLeft: 71,
    state: "normal",
    citations: 0,
    evidence: [],
    events: [
      { at: "15 Nov 11:00", actor: "system", what: "Pathology ordered", audit: "#0955" },
      { at: "17 Nov 11:00", actor: "system", what: "No accession event in 40h, marked stale", audit: "#1107" },
    ],
    attempts: [],
  },
  {
    ref: "CX-0472",
    patient: "T. Al Hashimi",
    initials: "TH",
    age: 60,
    stage: "result_received",
    owner: null,
    dueLabel: "20 Nov 09:00",
    hoursLeft: 69,
    state: "normal",
    citations: 0,
    evidence: [],
    events: [{ at: "17 Nov 10:40", actor: "system", what: "Case created from lab result, no coordinator matched", audit: "#1102" }],
    attempts: [],
  },
  {
    ref: "CX-0388",
    patient: "L. Fernandes",
    initials: "LF",
    age: 63,
    stage: "closed",
    owner: "Dr. Fulan",
    dueLabel: "—",
    hoursLeft: null,
    state: "closed",
    citations: 0,
    outcome: "returned_to_routine_screening",
    evidence: [],
    events: [{ at: "16 Nov 14:12", actor: "Dr. Fulan", what: "Closure confirmed", audit: "#1180" }],
    attempts: [],
  },
];

export const programme = {
  open: 142,
  unowned: 14,
  pastDeadline: 2,
  awaitingClinician: 5,
  dueToday: 4,
  closedThisWeek: 38,
  byStage: [
    { stage: "Result received", open: 34, unowned: 14 },
    { stage: "Colonoscopy", open: 41, unowned: 0 },
    { stage: "Pathology", open: 39, unowned: 0 },
    { stage: "Closure proposed", open: 22, unowned: 0 },
    { stage: "Closure confirmed", open: 6, unowned: 0 },
  ],
  exceptions: [
    { ref: "CX-0460", reason: "Unowned 26h", owner: "—", due: "18 Nov 12:00" },
    { ref: "CX-0409", reason: "Deadline missed 3h", owner: "S. Al Ali", due: "17 Nov 14:00" },
    { ref: "CX-0470", reason: "No accession event 40h", owner: "R. Haddad", due: "20 Nov 11:00" },
    { ref: "CX-0452", reason: "Clinician decision 2h overdue", owner: "Dr. Fulan", due: "17 Nov 10:00" },
  ],
};

export function stageIndex(stage: StageId): number {
  return stages.findIndex((s) => s.id === stage);
}

export function getCase(ref: string): Case | undefined {
  return cases.find((c) => c.ref === ref);
}
