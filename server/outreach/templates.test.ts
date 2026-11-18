import { describe, expect, it } from "vitest";
import {
  LADDER,
  TEMPLATES,
  render,
  validateTemplates,
  writtenTemplateFor,
  type MessageTemplate,
} from "./templates.js";

// TICKET-10: messages are fixed templates with variables. These tests hold the template
// files to that: every written language carries the same variables, no unknown variable
// slips in, the draft slots carry no text, and every step deadline names its source.

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("TICKET-10: outreach templates", () => {
  it("ship English and Arabic written, Urdu, Hindi and Tagalog as draft slots", () => {
    const status = Object.fromEntries(TEMPLATES.map((t) => [t.language, t.review_status]));
    expect(status).toEqual({
      en: "written",
      ar: "written_not_reviewed",
      ur: "draft_slot",
      hi: "draft_slot",
      tl: "draft_slot",
    });
    for (const code of ["ur", "hi", "tl"]) {
      const slot = TEMPLATES.find((t) => t.language === code);
      expect(slot?.text).toBeNull();
      expect(slot?.review_note).toMatch(/^draft, not reviewed by a native speaker/);
    }
    expect(TEMPLATES.find((t) => t.language === "ar")?.dir).toBe("rtl");
    expect(TEMPLATES.find((t) => t.language === "ar")?.review_note).toMatch(/not yet reviewed by a native speaker/i);
  });

  it("mark every step deadline as unsourced, needing clinical review", () => {
    for (const parameter of Object.values(LADDER.parameters)) {
      expect(parameter.source).toBe("unsourced, needs clinical review");
    }
    expect(LADDER.notes).toMatch(/Atlas/);
  });

  it("refuse a translation that drops a variable or invents one", () => {
    const templates = clone(TEMPLATES) as MessageTemplate[];
    const ar = templates.find((t) => t.language === "ar");
    if (!ar?.text) throw new Error("no Arabic text");
    ar.text.contact = "اتصل بنا"; // the phone number and the place are gone
    ar.text.sms = `${ar.text.sms} {diagnosis}`;
    expect(() => validateTemplates(LADDER, templates)).toThrow(/text\.contact uses/);
    expect(() => validateTemplates(LADDER, templates)).toThrow(/unknown variable \{diagnosis\}/);
  });

  it("refuse a step deadline without a source", () => {
    const ladder = clone(LADDER);
    ladder.parameters.staff_call_after_hours.source = "";
    expect(() => validateTemplates(ladder, TEMPLATES)).toThrow(/needs a source/);
  });

  it("render only by substituting variables, and refuse a missing one", () => {
    expect(render("Dear {name}, call {phone}.", { name: "A", phone: "1" })).toBe("Dear A, call 1.");
    expect(() => render("Dear {name}", {})).toThrow(/has no value/);
  });

  it("fall back to English for a draft slot and say so", () => {
    const urdu = writtenTemplateFor("ur");
    expect(urdu.fallback).toBe(true);
    expect(urdu.template.language).toBe("en");
    expect(writtenTemplateFor("ar").fallback).toBe(false);
  });
});
