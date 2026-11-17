import type {
  Actor,
  CaseDetailResponse,
  CaseFilter,
  CaseListResponse,
  MutationResult,
  OutreachInput,
  ProgramSummary,
  Role,
  Verification,
} from "./types";

// The error envelope from docs/api.md: { "error": { "code", "message" } }, with a
// details bag only where the contract shows one (currently closure_conditions_unmet).
export class ApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

export interface NexyraApi {
  listCases(role: Role, filter?: CaseFilter): Promise<CaseListResponse>;
  getCase(caseId: string, role: Role): Promise<CaseDetailResponse>;
  getVerification(caseId: string, role: Role): Promise<Verification>;
  getProgramme(role: Role): Promise<ProgramSummary>;
  confirmClosure(caseId: string, actor: Actor): Promise<CaseDetailResponse>;
  reopenCase(caseId: string, actor: Actor): Promise<CaseDetailResponse>;
  logOutreach(caseId: string, input: OutreachInput, actor: Actor): Promise<MutationResult>;
}
