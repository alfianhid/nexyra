import type { ChatMessage } from "./prompt.js";

// OpenAI-compatible Chat Completions over plain fetch. The provider is chosen by env
// alone (LLM_BASE_URL, LLM_API_KEY, NEXYRA_MODEL): DeepSeek, Meta's Model API at
// https://api.meta.ai/v1, or any other server speaking the same protocol. No
// provider-specific structured-output feature is used; the prompt asks for JSON and
// parseModelJson() reads it defensively.

export const DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export const DEFAULT_TIMEOUT_MS = 30_000;

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Null when no model can be called. Callers then fall back to the cache, and without a
// cache to needs_human_reading.
export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY?.trim();
  const baseUrl = env.LLM_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  const timeout = Number(env.LLM_TIMEOUT_MS);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model: env.NEXYRA_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

// Error messages never carry the key or the provider's response body.
export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

async function postOnce(
  config: LlmConfig,
  messages: ChatMessage[],
  fetchImpl: FetchLike,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ model: config.model, messages, temperature: 0 }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LlmError(`Model call timed out after ${config.timeoutMs} ms`, true);
      }
      throw new LlmError(`Model endpoint unreachable: ${(error as Error).message}`, true);
    }

    if (!response.ok) {
      throw new LlmError(
        `Model endpoint answered HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LlmError("Model endpoint answered with something other than JSON", true);
    }
    const content = contentOf(body);
    if (!content) throw new LlmError("Model answer had no message content", true);
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// choices[0].message.content is a string in the OpenAI shape; some servers send an array
// of { type: "text", text } parts instead.
function contentOf(body: unknown): string | null {
  const choices = (body as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (typeof part === "string" ? part : (part as { text?: unknown })?.text))
      .filter((part): part is string => typeof part === "string")
      .join("");
    return text.length > 0 ? text : null;
  }
  return null;
}

// Pulls one JSON object out of a model reply: bare JSON, a ```json fence, or an object
// with prose around it. Reasoning models' <think> blocks are dropped first, because they
// may contain braces of their own.
export function parseModelJson(content: string): Record<string, unknown> | null {
  const text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const candidates: string[] = [text];
  for (const match of text.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
    if (match[1]) candidates.push(match[1].trim());
  }
  for (const candidate of candidates) {
    const parsed = tryObject(candidate);
    if (parsed) return parsed;
  }

  // Balanced-brace scan from each "{", honouring strings, so prose before or after the
  // object (or a stray brace in the prose) does not break the parse.
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    const end = matchingBrace(text, start);
    if (end < 0) continue;
    const parsed = tryObject(text.slice(start, end + 1));
    if (parsed) return parsed;
  }
  return null;
}

function tryObject(candidate: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(candidate);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export type ModelReply = { parsed: Record<string, unknown>; raw: string; attempts: number };

// One call plus one retry. Retried: timeouts, network errors, 429 and 5xx, and a reply
// that holds no readable JSON. Not retried: other 4xx (a wrong key will not get better).
export async function requestJson(
  config: LlmConfig,
  messages: ChatMessage[],
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): Promise<ModelReply> {
  let lastError: LlmError = new LlmError("Model was not called", false);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const raw = await postOnce(config, messages, fetchImpl);
      const parsed = parseModelJson(raw);
      if (parsed) return { parsed, raw, attempts: attempt };
      lastError = new LlmError("Model answer held no readable JSON object", true);
    } catch (error) {
      lastError = error instanceof LlmError ? error : new LlmError(String(error), false);
    }
    if (!lastError.retryable) break;
  }
  throw lastError;
}
