import type { FetchLike } from "./llm.js";

// Test double for an OpenAI-compatible endpoint. Never used outside tests; it lives
// beside the module so both test files build answers the same way.

export type Answer = Record<string, [value: string, quote: string | null]>;

export function answerJson(answer: Answer): string {
  const body: Record<string, { value: string; quote: string | null }> = {};
  for (const [key, [value, quote]] of Object.entries(answer)) body[key] = { value, quote };
  return JSON.stringify(body);
}

export function completion(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content } }] }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export type FakeModel = FetchLike & {
  calls: { url: string; init: RequestInit }[];
};

// Each call takes the next reply; the last one repeats.
export function fakeModel(...replies: (() => Response | Promise<Response>)[]): FakeModel {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (!reply) throw new Error("fakeModel has no reply");
    return reply();
  }) as FakeModel;
  fn.calls = calls;
  return fn;
}
