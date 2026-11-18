import ladderJson from "./templates/fit-positive.ladder.json" with { type: "json" };
import arJson from "./templates/fit-positive-result.ar.json" with { type: "json" };
import enJson from "./templates/fit-positive-result.en.json" with { type: "json" };
import hiJson from "./templates/fit-positive-result.hi.json" with { type: "json" };
import tlJson from "./templates/fit-positive-result.tl.json" with { type: "json" };
import urJson from "./templates/fit-positive-result.ur.json" with { type: "json" };

// TICKET-10: the outreach message is fixed text with variables, written ahead of time and
// stored as data. Nothing here generates wording at send time: `render` only substitutes
// the variables below into a template a person wrote. A language whose template is only
// a slot (no text) is never sent; the English text goes out instead and says so.

export const VARIABLES = ["name", "date", "place", "phone", "link", "callback_date"] as const;
export type Variable = (typeof VARIABLES)[number];

export const TEXT_KEYS = [
  "sms",
  "page_title",
  "greeting",
  "result_heading",
  "result",
  "next_step_heading",
  "next_step",
  "urgency_heading",
  "urgency",
  "contact_heading",
  "contact",
  "acknowledge",
  "callback",
  "acknowledged",
  "callback_requested",
  "language_label",
  "draft_notice",
] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

export type ReviewStatus = "written" | "written_not_reviewed" | "draft_slot";

export type MessageTemplate = {
  template_id: string;
  language: string;
  language_name: string;
  dir: "ltr" | "rtl";
  date_locale: string;
  review_status: ReviewStatus;
  review_note: string;
  source: string;
  text: Record<TextKey, string> | null;
};

export type LadderParameter = { hours: number; label: string; source: string };

export type LadderParameterKey =
  | "staff_call_after_hours"
  | "staff_call_due_hours"
  | "callback_due_hours"
  | "navigator_after_hours"
  | "navigator_due_hours";

export type LadderTemplate = {
  id: string;
  pathway_id: string;
  message_template: string;
  applies_to_stage: string;
  acknowledge_event: string;
  default_language: string;
  languages: string[];
  clinic: { place: Record<string, string>; phone: string; source: string };
  parameters: Record<LadderParameterKey, LadderParameter>;
  escalate_to_navigator_on_barrier: boolean;
  notes: string;
};

export class OutreachTemplateError extends Error {
  constructor(problems: string[]) {
    super(`Outreach templates are invalid:\n- ${problems.join("\n- ")}`);
    this.name = "OutreachTemplateError";
  }
}

const PLACEHOLDER = /\{([a-z_]+)\}/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

// Checked at import, like the pathway template: a broken file stops the server at start
// rather than sending a message with a hole in it.
export function validateTemplates(
  ladder: LadderTemplate,
  templates: readonly MessageTemplate[],
): void {
  const problems: string[] = [];
  const byLanguage = new Map(templates.map((t) => [t.language, t]));

  for (const key of Object.keys(ladder.parameters) as LadderParameterKey[]) {
    const parameter = ladder.parameters[key];
    if (typeof parameter.hours !== "number" || parameter.hours <= 0) {
      problems.push(`ladder.parameters.${key}.hours must be a positive number`);
    }
    if (typeof parameter.source !== "string" || parameter.source.length === 0) {
      problems.push(`ladder.parameters.${key} needs a source`);
    }
  }

  const fallback = byLanguage.get(ladder.default_language);
  if (!fallback || fallback.text === null) {
    problems.push(`the default language "${ladder.default_language}" must have written text`);
  }
  if (!ladder.clinic.place[ladder.default_language]) {
    problems.push(`clinic.place needs the default language "${ladder.default_language}"`);
  }

  for (const code of ladder.languages) {
    const template = byLanguage.get(code);
    if (!template) {
      problems.push(`no template file for language "${code}"`);
      continue;
    }
    if (template.template_id !== ladder.message_template) {
      problems.push(`${code}: template_id must be "${ladder.message_template}"`);
    }
    if (template.dir !== "ltr" && template.dir !== "rtl") problems.push(`${code}: dir must be ltr or rtl`);
    if (template.text === null) {
      if (template.review_status !== "draft_slot") {
        problems.push(`${code}: a template without text must be a draft_slot`);
      }
      continue;
    }
    for (const key of TEXT_KEYS) {
      const value = template.text[key];
      if (typeof value !== "string" || value.trim().length === 0) {
        problems.push(`${code}: text.${key} is missing`);
        continue;
      }
      for (const name of placeholders(value)) {
        if (!(VARIABLES as readonly string[]).includes(name)) {
          problems.push(`${code}: text.${key} uses an unknown variable {${name}}`);
        }
      }
      // Every written language carries the same variables as the default one, so a
      // translation cannot silently drop the phone number or the date.
      const reference = fallback?.text?.[key];
      if (reference !== undefined) {
        const want = [...new Set(placeholders(reference))].sort().join(",");
        const got = [...new Set(placeholders(value))].sort().join(",");
        if (want !== got) {
          problems.push(`${code}: text.${key} uses {${got}} but ${ladder.default_language} uses {${want}}`);
        }
      }
    }
  }

  if (problems.length > 0) throw new OutreachTemplateError(problems);
}

export const LADDER = ladderJson as unknown as LadderTemplate;

export const TEMPLATES: readonly MessageTemplate[] = [enJson, arJson, urJson, hiJson, tlJson].map(
  (json: unknown) => json as MessageTemplate,
);

validateTemplates(LADDER, TEMPLATES);

export function templateFor(language: string): MessageTemplate | undefined {
  return TEMPLATES.find((t) => t.language === language);
}

export function parameterHours(key: LadderParameterKey): number {
  return LADDER.parameters[key].hours;
}

// The template a message for this language is written in: the language's own when it
// has text, otherwise the default language, flagged as a fallback.
export function writtenTemplateFor(language: string): {
  template: MessageTemplate & { text: Record<TextKey, string> };
  requested: MessageTemplate | undefined;
  fallback: boolean;
} {
  const requested = templateFor(language);
  const own = requested && requested.text !== null ? requested : undefined;
  const chosen = own ?? templateFor(LADDER.default_language);
  if (!chosen || chosen.text === null) {
    throw new OutreachTemplateError([`no written template for "${language}"`]);
  }
  return {
    template: chosen as MessageTemplate & { text: Record<TextKey, string> },
    requested,
    fallback: own === undefined,
  };
}

export function render(text: string, values: Partial<Record<Variable, string>>): string {
  return text.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = values[name as Variable];
    if (value === undefined) {
      throw new OutreachTemplateError([`variable {${name}} has no value`]);
    }
    return value;
  });
}

export function renderAll(
  template: MessageTemplate & { text: Record<TextKey, string> },
  values: Partial<Record<Variable, string>>,
): Record<TextKey, string> {
  const out = {} as Record<TextKey, string>;
  for (const key of TEXT_KEYS) {
    // Only the keys whose variables are known can be rendered; the confirmation that
    // names a callback date is rendered once the date exists.
    const needs = placeholders(template.text[key]);
    out[key] = needs.every((name) => values[name as Variable] !== undefined)
      ? render(template.text[key], values)
      : template.text[key];
  }
  return out;
}

// Patient-facing dates are written in the patient's own time zone (Abu Dhabi), in the
// template's locale, as a day and a month: no clock time, nothing to misread.
export function patientDate(iso: string, locale: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Dubai",
    day: "numeric",
    month: "long",
  }).format(at);
}

export function clinicPlace(language: string): string {
  return LADDER.clinic.place[language] ?? LADDER.clinic.place[LADDER.default_language] ?? "";
}

export function patientPath(token: string): string {
  return `/p/${token}`;
}
