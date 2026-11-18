import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PatientPage } from "../api/types";
import { PatientView } from "./Patient";

// TICKET-10 done-when: "The Arabic patient page renders right-to-left correctly". The
// server test checks the payload says rtl; this one checks the markup the page renders
// from it, with a payload shaped like GET /api/patient/{token}.

const arabic: PatientPage = {
  patient_name: "Y. Al Hammadi",
  language: "ar",
  language_name: "العربية",
  content_language: "ar",
  dir: "rtl",
  fallback: false,
  fallback_notice: null,
  review_status: "written_not_reviewed",
  review_note: "Not yet reviewed by a native speaker.",
  languages: [
    { code: "en", name: "English", dir: "ltr", review_status: "written", label: null },
    { code: "ar", name: "العربية", dir: "rtl", review_status: "written_not_reviewed", label: "not yet reviewed by a native speaker" },
    { code: "ur", name: "اردو", dir: "rtl", review_status: "draft_slot", label: "draft, not reviewed by a native speaker" },
  ],
  content: {
    sms: "…",
    page_title: "نتيجة فحص القولون",
    greeting: "عزيزي/عزيزتي Y. Al Hammadi،",
    result_heading: "نتيجتك",
    result: "وجد فحص البراز (FIT) كمية صغيرة من الدم.",
    next_step_heading: "الخطوة التالية",
    next_step: "الخطوة التالية هي تنظير القولون.",
    urgency_heading: "متى",
    urgency: "من فضلك لا تنتظر.",
    contact_heading: "للاستفسار",
    contact: "اتصل على +971 2 000 0000. عيادة الفحص التجريبية، أبوظبي.",
    acknowledge: "فهمت وسأحضر",
    callback: "أريد اتصالاً هاتفياً",
    acknowledged: "شكراً لك.",
    callback_requested: "شكراً لك.",
    language_label: "اللغة",
    draft_notice: "…",
  },
  response: null,
  response_text: null,
  phone: "+971 2 000 0000",
};

function render(page: PatientPage): string {
  return renderToStaticMarkup(
    <PatientView
      page={page}
      patientName={page.patient_name}
      busy={false}
      error=""
      onLanguage={() => {}}
      onRespond={() => {}}
    />,
  );
}

describe("TICKET-10: patient page markup", () => {
  it("TICKET-10: the Arabic patient page renders right-to-left with lang=ar", () => {
    const html = render(arabic);
    expect(html.startsWith('<div class="patient" dir="rtl" lang="ar">')).toBe(true);
    expect(html).toContain("فهمت وسأحضر");
    expect(html).toContain("أريد اتصالاً هاتفياً");
    // The Latin name and the phone number are isolated left-to-right inside the Arabic.
    expect(html).toContain('<bdi dir="ltr">Y. Al Hammadi</bdi>');
    expect(html).toContain('href="tel:+97120000000" dir="ltr">+971 2 000 0000</a>');
    // The language switch marks the current language and the draft slot.
    expect(html).toMatch(/lang="ar" dir="rtl" aria-pressed="true"/);
    expect(html).toContain('<small lang="en" dir="ltr">UR draft</small>');
  });

  it("lays an English fallback out left-to-right even when Urdu was chosen", () => {
    const html = render({ ...arabic, language: "ur", content_language: "en", dir: "ltr", fallback: true, fallback_notice: "Draft slot." });
    expect(html.startsWith('<div class="patient" dir="ltr" lang="en">')).toBe(true);
    expect(html).toContain("Draft slot.");
  });

  it("replaces the two buttons with the confirmation once the patient has answered", () => {
    const html = render({ ...arabic, response: "understood", response_text: "شكراً لك." });
    expect(html).not.toContain("فهمت وسأحضر");
    expect(html).toContain('role="status"');
  });
});
