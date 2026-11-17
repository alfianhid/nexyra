import type { NexyraApi } from "./client";
import { httpApi } from "./http";
import { mockApi } from "./mock";

// One line flips the app between the fixtures and the real engine.
export const api: NexyraApi = httpApi;
// Kept exported so a test or a fixture-only screen can still reach the adapter.
export { mockApi };
export { ApiError } from "./client";
export type { NexyraApi } from "./client";
