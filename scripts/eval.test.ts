import { describe, expect, it } from "vitest";
import { compare, renderResults, type EvalResult, type Label } from "./evalCompare.js";

const label = (id: string, over: Partial<Label>): Label => ({
  id,
  complete_exam: "yes",
  adequate_prep: "yes",
  tissue_taken: "no",
  pathology_available: "not_applicable",
  outcome_category: "normal",
  stated_next_step: "routine screening",
  may_propose_closure: "yes",
  ...over,
});

const result = (proposal: string, v: Record<string, string>, rejections = 0): EvalResult => ({
  origin: "model",
  proposal,
  fields: Object.entries(v).map(([key, value]) => ({ key, value })),
  rejections: Array.from({ length: rejections }, () => ({})),
});

const normal = {
  complete_exam: "yes",
  adequate_prep: "yes",
  tissue_taken: "no",
  pathology_available: "unknown",
  outcome_category: "normal",
  next_step: "stated",
};

describe("eval comparison", () => {
  const labels = [
    label("r01", {}),
    label("r02", { complete_exam: "no", may_propose_closure: "no", outcome_category: "not_stated" }),
    label("r03", { complete_exam: "no", may_propose_closure: "no", outcome_category: "not_stated" }),
    label("r04", {}),
  ];
  const results: Record<string, EvalResult> = {
    r01: result("propose_closure", normal, 1),
    // dangerous: the exam was incomplete but the module proposed closure
    r02: result("propose_closure", { ...normal, outcome_category: "unknown" }),
    r03: result("reopen", { ...normal, complete_exam: "no", outcome_category: "not_stated" }),
    r04: { origin: "unavailable", proposal: "needs_human_reading", fields: [], rejections: [] },
  };
  const cmp = compare(labels, results);

  it("counts closure outcomes and keeps unavailable apart", () => {
    expect(cmp.unavailable).toEqual(["r04"]);
    expect(cmp.read).toBe(3);
    expect(cmp.mustNotClose).toEqual({ total: 2, heldBack: ["r03"], slippedThrough: ["r02"] });
    expect(cmp.mayClose).toEqual({ total: 1, proposed: ["r01"], heldBack: [] });
    expect(cmp.rejectedCitations).toBe(1);
  });

  it("counts per-field agreement with the label mapping", () => {
    expect(cmp.perField.complete_exam).toEqual({ agree: 2, of: 3 });
    // not_applicable accepts "unknown"; not_stated accepts "unknown" and "not_stated"
    expect(cmp.perField.pathology_available).toEqual({ agree: 3, of: 3 });
    expect(cmp.perField.outcome_category).toEqual({ agree: 3, of: 3 });
    expect(cmp.wrong.map((w) => w.id)).toEqual(["r02"]);
    expect(cmp.wrong[0]?.mismatches.map((m) => m.field)).toEqual(["complete_exam", "closure"]);
  });

  it("lists the dangerous error before everything else", () => {
    const text = renderResults(cmp, {
      date: "2026-11-18",
      model: "m",
      promptVersion: "v",
      checkedBy: null,
      checkedAt: null,
      promptChangesAfterResults: 0,
    });
    expect(text.startsWith("## DANGEROUS ERROR")).toBe(true);
    expect(text.indexOf("r02")).toBeLessThan(text.indexOf("# Closure verification evaluation"));
    expect(text).toContain("1 of 2");
    expect(text).toContain("not yet been checked by a clinician");
  });
});
