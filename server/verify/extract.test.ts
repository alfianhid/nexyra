import { describe, expect, it } from "vitest";
import { extractReport, memoryCache } from "./extract.js";
import { answerJson, completion, fakeModel, type Answer } from "./fakeModel.js";
import type { ExtractionField } from "./fields.js";
import { llmConfigFromEnv, parseModelJson, type LlmConfig } from "./llm.js";
import { decideProposal } from "./proposal.js";
import { locateQuote } from "./quotes.js";

// TICKET-13 done-when, against a fake model. The reports below are written for these
// tests only; the labelled set in data/test-reports/ is never read here.

const LLM: LlmConfig = {
  baseUrl: "https://llm.test/v1",
  apiKey: "test-key-not-real",
  model: "test/model-1",
  timeoutMs: 2_000,
};

const NORMAL =
  "COLONOSCOPY REPORT\nBowel preparation was good.\nThe caecum was reached and the terminal ileum intubated.\n" +
  "Findings: no polyps or other abnormality seen.  No biopsies were taken.\n" +
  "Recommendation: return to routine screening in 10 years.";

const INCOMPLETE =
  "Bowel preparation was poor, with solid stool throughout. The scope could not pass the " +
  "splenic flexure and the caecum was not reached. Repeat colonoscopy is advised.";

const AWAITING =
  "Preparation was adequate. Complete examination to the caecum. A 7 mm sigmoid polyp was " +
  "removed by snare polypectomy and sent to histology. Histology is awaited.";

const POLYP =
  "Preparation was adequate. Complete examination to the caecum. A 7 mm sigmoid polyp was " +
  "removed by snare polypectomy. Histology: tubular adenoma with low-grade dysplasia. " +
  "Surveillance colonoscopy in 3 years.";

const NORMAL_ANSWER: Answer = {
  complete_exam: ["yes", "The caecum was reached and the terminal ileum intubated."],
  adequate_prep: ["yes", "Bowel preparation was good."],
  tissue_taken: ["no", "No biopsies were taken."],
  pathology_available: ["unknown", null],
  outcome_category: ["normal", "no polyps or other abnormality seen."],
  next_step: ["stated", "return to routine screening in 10 years."],
};

function field(key: string, value: string): ExtractionField {
  return {
    key: key as ExtractionField["key"],
    value,
    quote: value === "unknown" ? null : "quoted text",
    quote_offset: [0, 0],
    source: "test",
    read_at: "2026-11-18T00:00:00.000Z",
    validated: value !== "unknown",
  };
}

function fields(values: Record<string, string>): ExtractionField[] {
  return Object.entries(values).map(([key, value]) => field(key, value));
}

const CLEAN = {
  complete_exam: "yes",
  adequate_prep: "yes",
  tissue_taken: "no",
  pathology_available: "unknown",
  outcome_category: "normal",
  next_step: "stated",
};

describe("quote validation", () => {
  it("computes offsets from the text and treats whitespace runs as one space", () => {
    const quote = "no polyps or other abnormality seen. No biopsies were taken.";
    const offset = locateQuote(NORMAL, quote);
    expect(offset).not.toBeNull();
    // The report has two spaces between the sentences; the quote has one.
    expect(NORMAL.slice(...(offset as [number, number]))).toBe(
      "no polyps or other abnormality seen.  No biopsies were taken.",
    );
  });

  it("matches across a line break", () => {
    const offset = locateQuote(NORMAL, "was good. The caecum was reached");
    expect(NORMAL.slice(...(offset as [number, number]))).toBe("was good.\nThe caecum was reached");
  });

  it("does not forgive case, punctuation or spelling", () => {
    expect(locateQuote(NORMAL, "bowel preparation was good.")).toBeNull();
    expect(locateQuote(NORMAL, "The cecum was reached")).toBeNull();
  });

  it("refuses a quote too short to be evidence", () => {
    expect(locateQuote(NORMAL, "good")).toBeNull();
  });

  it("a citation absent from the text forces the field to unknown", async () => {
    const model = fakeModel(() =>
      completion(
        answerJson({
          ...NORMAL_ANSWER,
          // Plausible, but the report never says it.
          complete_exam: ["yes", "Caecal intubation was confirmed by photo documentation."],
        }),
      ),
    );
    const result = await extractReport(NORMAL, { llm: LLM, fetch: model });

    const exam = result.fields.find((f) => f.key === "complete_exam");
    expect(exam).toMatchObject({ value: "unknown", quote: null, quote_offset: [0, 0], validated: false });
    expect(result.rejections).toEqual([
      expect.objectContaining({ key: "complete_exam", reason: "quote_not_in_report" }),
    ]);
    // The one invented quote is enough to withhold a closure proposal.
    expect(result.proposal).toBe("needs_human_reading");
  });

  it("a positive value with no quote is forced to unknown", async () => {
    const model = fakeModel(() =>
      completion(answerJson({ ...NORMAL_ANSWER, adequate_prep: ["yes", null] })),
    );
    const result = await extractReport(NORMAL, { llm: LLM, fetch: model });
    expect(result.fields.find((f) => f.key === "adequate_prep")).toMatchObject({
      value: "unknown",
      validated: false,
    });
    expect(result.proposal).toBe("needs_human_reading");
  });

  it("a value outside the vocabulary is forced to unknown", async () => {
    const model = fakeModel(() =>
      completion(answerJson({ ...NORMAL_ANSWER, outcome_category: ["benign", "no polyps or other abnormality seen."] })),
    );
    const result = await extractReport(NORMAL, { llm: LLM, fetch: model });
    expect(result.fields.find((f) => f.key === "outcome_category")?.value).toBe("unknown");
  });

  it("ignores offsets the model sends and returns the report's own characters", async () => {
    const raw = JSON.parse(answerJson(NORMAL_ANSWER)) as Record<string, Record<string, unknown>>;
    for (const entry of Object.values(raw)) entry.quote_offset = [1, 2];
    const model = fakeModel(() => completion(JSON.stringify(raw)));
    const result = await extractReport(NORMAL, { llm: LLM, fetch: model, source: "normal.txt" });

    for (const f of result.fields.filter((x) => x.validated)) {
      expect(NORMAL.slice(...f.quote_offset)).toBe(f.quote);
      expect(f.quote_offset).not.toEqual([1, 2]);
      expect(f.source).toBe("normal.txt");
    }
    expect(result.fields.map((f) => f.key)).toEqual([
      "complete_exam",
      "adequate_prep",
      "tissue_taken",
      "pathology_available",
      "outcome_category",
      "next_step",
    ]);
  });
});

describe("proposal rules (every branch)", () => {
  it("incomplete exam → reopen", () => {
    expect(decideProposal(fields({ ...CLEAN, complete_exam: "no" })).proposal).toBe("reopen");
  });

  it("inadequate prep → reopen", () => {
    expect(decideProposal(fields({ ...CLEAN, adequate_prep: "no" })).proposal).toBe("reopen");
  });

  it("both → reopen naming both, and reopen wins over unknown fields", () => {
    const decision = decideProposal(
      fields({ complete_exam: "no", adequate_prep: "no", tissue_taken: "unknown", outcome_category: "unknown" }),
    );
    expect(decision).toEqual({
      proposal: "reopen",
      proposal_reason: "Incomplete exam and inadequate prep",
      proposed_outcome: null,
    });
  });

  it("tissue taken, pathology not available → wait_for_pathology", () => {
    const decision = decideProposal(
      fields({ ...CLEAN, tissue_taken: "yes", pathology_available: "no", outcome_category: "polyp" }),
    );
    expect(decision.proposal).toBe("wait_for_pathology");
  });

  it("any key field unknown → needs_human_reading", () => {
    for (const key of ["complete_exam", "adequate_prep", "tissue_taken", "outcome_category"]) {
      expect(decideProposal(fields({ ...CLEAN, [key]: "unknown" })).proposal).toBe("needs_human_reading");
    }
  });

  it("outcome not stated → needs_human_reading", () => {
    expect(decideProposal(fields({ ...CLEAN, outcome_category: "not_stated" })).proposal).toBe(
      "needs_human_reading",
    );
  });

  it("tissue taken and pathology unknown → needs_human_reading", () => {
    const decision = decideProposal(
      fields({ ...CLEAN, tissue_taken: "yes", pathology_available: "unknown", outcome_category: "polyp" }),
    );
    expect(decision.proposal).toBe("needs_human_reading");
  });

  it("a missing field counts as unknown", () => {
    expect(decideProposal([]).proposal).toBe("needs_human_reading");
  });

  it("cancer → needs_human_reading, never propose_closure", () => {
    const decision = decideProposal(
      fields({ ...CLEAN, tissue_taken: "yes", pathology_available: "yes", outcome_category: "cancer" }),
    );
    expect(decision.proposal).toBe("needs_human_reading");
    expect(decision.proposed_outcome).toBeNull();
    expect(decision.proposal_reason).toMatch(/oncology/);
  });

  it("polyp with no tissue taken → needs_human_reading", () => {
    expect(decideProposal(fields({ ...CLEAN, outcome_category: "polyp" })).proposal).toBe(
      "needs_human_reading",
    );
  });

  it("normal → propose_closure, returned to routine screening", () => {
    expect(decideProposal(fields(CLEAN))).toMatchObject({
      proposal: "propose_closure",
      proposed_outcome: "returned_to_routine_screening",
    });
  });

  it("polyp with pathology → propose_closure, surveillance scheduled", () => {
    expect(
      decideProposal(
        fields({ ...CLEAN, tissue_taken: "yes", pathology_available: "yes", outcome_category: "polyp" }),
      ),
    ).toMatchObject({ proposal: "propose_closure", proposed_outcome: "surveillance_scheduled" });
  });

  it("the same rules run end to end on model answers", async () => {
    const cases: [string, Answer, string][] = [
      [
        INCOMPLETE,
        {
          complete_exam: ["no", "the caecum was not reached."],
          adequate_prep: ["no", "Bowel preparation was poor"],
          tissue_taken: ["unknown", null],
          pathology_available: ["unknown", null],
          outcome_category: ["not_stated", null],
          next_step: ["stated", "Repeat colonoscopy is advised."],
        },
        "reopen",
      ],
      [
        AWAITING,
        {
          complete_exam: ["yes", "Complete examination to the caecum."],
          adequate_prep: ["yes", "Preparation was adequate."],
          tissue_taken: ["yes", "removed by snare polypectomy and sent to histology."],
          pathology_available: ["no", "Histology is awaited."],
          outcome_category: ["polyp", "A 7 mm sigmoid polyp was removed"],
          next_step: ["not_stated", null],
        },
        "wait_for_pathology",
      ],
      [
        POLYP,
        {
          complete_exam: ["yes", "Complete examination to the caecum."],
          adequate_prep: ["yes", "Preparation was adequate."],
          tissue_taken: ["yes", "removed by snare polypectomy."],
          pathology_available: ["yes", "Histology: tubular adenoma with low-grade dysplasia."],
          outcome_category: ["polyp", "Histology: tubular adenoma with low-grade dysplasia."],
          next_step: ["stated", "Surveillance colonoscopy in 3 years."],
        },
        "propose_closure",
      ],
      [NORMAL, NORMAL_ANSWER, "propose_closure"],
    ];

    for (const [text, answer, expected] of cases) {
      const result = await extractReport(text, {
        llm: LLM,
        fetch: fakeModel(() => completion(answerJson(answer))),
      });
      expect(result.rejections).toEqual([]);
      expect(result.proposal).toBe(expected);
    }
  });
});

describe("no key, no cache", () => {
  it("returns needs_human_reading, never propose_closure, and calls nothing", async () => {
    const model = fakeModel(() => completion(answerJson(NORMAL_ANSWER)));
    const result = await extractReport(NORMAL, { llm: null, fetch: model });
    expect(result.proposal).toBe("needs_human_reading");
    expect(result.origin).toBe("unavailable");
    expect(result.fields).toEqual([]);
    expect(model.calls).toHaveLength(0);
  });

  it("reads the key from the environment and treats an empty one as absent", async () => {
    expect(llmConfigFromEnv({ LLM_BASE_URL: "https://api.meta.ai/v1", LLM_API_KEY: "" })).toBeNull();
    expect(llmConfigFromEnv({ LLM_BASE_URL: "", LLM_API_KEY: "k" })).toBeNull();

    const saved = { ...process.env };
    try {
      delete process.env.LLM_API_KEY;
      delete process.env.LLM_BASE_URL;
      const model = fakeModel(() => completion(answerJson(NORMAL_ANSWER)));
      const result = await extractReport(NORMAL, { fetch: model });
      expect(result.proposal).toBe("needs_human_reading");
      expect(model.calls).toHaveLength(0);
    } finally {
      process.env = saved;
    }
  });

  it("swaps provider by env alone", () => {
    expect(
      llmConfigFromEnv({
        LLM_BASE_URL: "https://api.meta.ai/v1/",
        LLM_API_KEY: "k",
        NEXYRA_MODEL: "muse-spark-1.0",
      }),
    ).toEqual({ baseUrl: "https://api.meta.ai/v1", apiKey: "k", model: "muse-spark-1.0", timeoutMs: 30_000 });
    expect(llmConfigFromEnv({ LLM_BASE_URL: "https://x.test", LLM_API_KEY: "k" })?.model).toBe(
      "deepseek/deepseek-v4.1-flash-1017",
    );
  });
});

describe("cache", () => {
  it("re-running on the same report hits the cache: the model is called once", async () => {
    const cache = memoryCache();
    const model = fakeModel(() => completion(answerJson(NORMAL_ANSWER)));

    const first = await extractReport(NORMAL, { llm: LLM, fetch: model, cache });
    const second = await extractReport(NORMAL, { llm: LLM, fetch: model, cache });

    expect(model.calls).toHaveLength(1);
    expect(first.origin).toBe("model");
    expect(second.origin).toBe("cache");
    expect(second.fields).toEqual(first.fields);
    expect(second.proposal).toBe(first.proposal);
    expect(second.proposed_outcome).toBe("returned_to_routine_screening");
    expect(second.text_hash).toBe(first.text_hash);
  });

  it("a cached reading still answers with no key (offline demo)", async () => {
    const cache = memoryCache();
    await extractReport(NORMAL, {
      llm: LLM,
      fetch: fakeModel(() => completion(answerJson(NORMAL_ANSWER))),
      cache,
    });
    const offline = await extractReport(NORMAL, { llm: null, cache });
    expect(offline.origin).toBe("cache");
    expect(offline.proposal).toBe("propose_closure");
  });

  it("an unavailable result is not cached", async () => {
    const cache = memoryCache();
    await extractReport(NORMAL, { llm: null, cache });
    expect(cache.size()).toBe(0);
  });
});

describe("model call", () => {
  it("posts an OpenAI-compatible request with a bearer key and no structured-output flag", async () => {
    const model = fakeModel(() => completion(answerJson(NORMAL_ANSWER)));
    const result = await extractReport(NORMAL, { llm: LLM, fetch: model });

    expect(model.calls).toHaveLength(1);
    const call = model.calls[0]!;
    expect(call.url).toBe("https://llm.test/v1/chat/completions");
    expect((call.init.headers as Record<string, string>).Authorization).toBe("Bearer test-key-not-real");
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(body.model).toBe("test/model-1");
    expect(body).not.toHaveProperty("response_format");
    expect(result.model).toBe("test/model-1");
    expect(result.prompt_version).toBe("extract-v1");
  });

  it("parses JSON inside a code fence with prose and a think block around it", () => {
    const parsed = parseModelJson(
      '<think>maybe {"complete_exam": "no"}</think>Here is the result:\n```json\n{"complete_exam": {"value": "yes", "quote": "a } brace"}}\n```\nDone.',
    );
    expect(parsed).toEqual({ complete_exam: { value: "yes", quote: "a } brace" } });
    expect(parseModelJson('Sure! {"a": {"b": 1}} hope that helps')).toEqual({ a: { b: 1 } });
    expect(parseModelJson("no json here")).toBeNull();
  });

  it("retries once after a server error", async () => {
    const model = fakeModel(
      () => completion("", 503),
      () => completion(answerJson(NORMAL_ANSWER)),
    );
    const result = await extractReport(NORMAL, { llm: LLM, fetch: model });
    expect(model.calls).toHaveLength(2);
    expect(result.origin).toBe("model");
  });

  it("retries once after an unreadable answer, then gives up safely", async () => {
    const model = fakeModel(() => completion("I could not read the report."));
    const result = await extractReport(NORMAL, { llm: LLM, fetch: model });
    expect(model.calls).toHaveLength(2);
    expect(result.proposal).toBe("needs_human_reading");
    expect(result.origin).toBe("unavailable");
  });

  it("does not retry a rejected key, and never echoes it", async () => {
    const model = fakeModel(() => completion("", 401));
    const result = await extractReport(NORMAL, { llm: LLM, fetch: model });
    expect(model.calls).toHaveLength(1);
    expect(result.proposal).toBe("needs_human_reading");
    expect(JSON.stringify(result)).not.toContain(LLM.apiKey);
  });

  it("times out, retries, and ends in needs_human_reading", async () => {
    const hang = fakeModel(
      () => new Promise<Response>(() => undefined),
    );
    // The fake ignores the abort signal, so wrap it to reject the way fetch does.
    const fetchImpl = (url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        hang(url, init).then(resolve, reject);
      });
    const result = await extractReport(NORMAL, { llm: { ...LLM, timeoutMs: 20 }, fetch: fetchImpl });
    expect(hang.calls).toHaveLength(2);
    expect(result.proposal).toBe("needs_human_reading");
    expect(result.error).toMatch(/timed out/);
  });
});
