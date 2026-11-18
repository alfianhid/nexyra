import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../api";
import { getPatientPage, respondAsPatient } from "../api/outreach";
import type { PatientPage as PatientPageData } from "../api/types";
import { useAsync } from "../hooks/useAsync";

// TICKET-10: the page the link in the automated message opens. No login and no staff
// shell: the token in the URL is the only key, and the page offers two answers. All text
// comes from the server's fixed templates; this file adds no wording of its own except the
// bilingual error line for a link that does not work.

// Latin names and phone numbers inside Arabic text are isolated so the bidirectional
// algorithm cannot reorder "+971 2 000 0000" or move the full stop after a name.
// The phone number becomes a tap-to-call link where the template mentions it.
function isolate(text: string, name: string, phone: string): ReactNode {
  const parts = [name, phone].filter((f) => f.length > 0);
  if (parts.length === 0) return text;
  const escaped = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pieces = text.split(new RegExp(`(${escaped.join("|")})`, "g"));
  return pieces.map((piece, index) =>
    piece === phone ? (
      <a key={index} className="patient-tel" href={`tel:${phone.replace(/\s+/g, "")}`} dir="ltr">
        {piece}
      </a>
    ) : piece === name ? (
      <bdi key={index} dir="ltr">
        {piece}
      </bdi>
    ) : (
      <Fragment key={index}>{piece}</Fragment>
    ),
  );
}

export function PatientView({
  page,
  patientName,
  busy,
  error,
  onLanguage,
  onRespond,
}: {
  page: PatientPageData;
  patientName: string;
  busy: boolean;
  error: string;
  onLanguage: (code: string) => void;
  onRespond: (response: "understood" | "request_call") => void;
}) {
  const t = page.content;

  return (
    <div className="patient" dir={page.dir} lang={page.content_language}>
      <div className="patient-wrap">
        <header className="patient-head">
          <span className="patient-brand" dir="ltr" lang="en">
            <img src="/brand/favicon.svg" alt="" width={20} height={20} aria-hidden="true" />
            <span>
              Nexyra
              <small>screening follow-up · demo</small>
            </span>
          </span>
          <nav className="patient-lang" aria-label={t.language_label}>
            {page.languages.map((language) => (
              <button
                key={language.code}
                type="button"
                lang={language.code}
                dir={language.dir}
                aria-pressed={language.code === page.language}
                onClick={() => onLanguage(language.code)}
              >
                <bdi>{language.name}</bdi>
                {language.review_status === "draft_slot" && (
                  <small lang="en" dir="ltr">
                    {language.code.toUpperCase()} draft
                  </small>
                )}
              </button>
            ))}
          </nav>
        </header>

        {page.fallback_notice && (
          <p className="notice patient-note" role="note">
            {page.fallback_notice}
          </p>
        )}

        <h1>{t.page_title}</h1>
        <p className="patient-greet">{isolate(t.greeting, patientName, page.phone)}</p>

        <section className="patient-block">
          <h2>{t.result_heading}</h2>
          <p>{t.result}</p>
        </section>
        <section className="patient-block">
          <h2>{t.next_step_heading}</h2>
          <p>{t.next_step}</p>
        </section>
        <section className="patient-block">
          <h2>{t.urgency_heading}</h2>
          <p>{t.urgency}</p>
        </section>
        <section className="patient-block">
          <h2>{t.contact_heading}</h2>
          <p>{isolate(t.contact, patientName, page.phone)}</p>
        </section>

        {page.response ? (
          <p className="notice patient-note" role="status">
            {page.response_text}
          </p>
        ) : (
          <div className="patient-actions">
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() => onRespond("understood")}
            >
              {t.acknowledge}
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => onRespond("request_call")}>
              {t.callback}
            </button>
          </div>
        )}
        {error && (
          <p className="notice alarm patient-note" role="alert" lang="en" dir="ltr">
            {error}
          </p>
        )}

        <footer className="patient-foot" lang="en" dir="ltr">
          Prototype with synthetic data. Messages come from fixed templates; nothing is written
          by AI. {page.review_note}
        </footer>
      </div>
    </div>
  );
}

export default function PatientPage() {
  const { token = "" } = useParams();
  const [language, setLanguage] = useState<string | undefined>(undefined);
  const page = useAsync(() => getPatientPage(token, language), [token, language]);
  const [answered, setAnswered] = useState<PatientPageData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const data = answered ?? page.data;

  useEffect(() => {
    if (data) document.title = data.content.page_title;
  }, [data]);

  if (page.error && !data) {
    const invalid = page.error instanceof ApiError && page.error.code === "not_found";
    return (
      <div className="patient">
        <div className="patient-wrap">
          <p className="notice alarm patient-note" role="alert">
            <span lang="en">
              {invalid ? "This link is not valid. Please call the clinic." : page.error.message}
            </span>
            <br />
            <span lang="ar" dir="rtl">
              {invalid ? "هذا الرابط غير صالح. يرجى الاتصال بالعيادة." : ""}
            </span>
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="patient">
        <div className="patient-wrap">
          <p className="notice patient-note">…</p>
        </div>
      </div>
    );
  }

  async function respond(response: "understood" | "request_call") {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      setAnswered(await respondAsPatient(token, response, data.language));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Your answer could not be sent. Please call the clinic.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientView
      page={data}
      patientName={data.patient_name}
      busy={busy}
      error={error}
      onLanguage={(code) => {
        setAnswered(null);
        setLanguage(code);
      }}
      onRespond={respond}
    />
  );
}
