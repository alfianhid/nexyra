# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript for the mockup. The submission stack named in `tickets/README.md` is TypeScript on Node.js, React, and SQLite; the mockup starts as the front end of that stack, and the API is TICKET-02's concern.

## Users

Primary user: coordination staff (the brief also calls the role navigator) at a screening programme. They work a list of open cases all day, chase results that have not arrived, trigger patient outreach, and hand closure to a clinician.

Other roles the interface must serve in the same product:

- Responsible physician — receives closure proposals and confirms or rejects them.
- Program manager — watches programme-level throughput, deadlines, and unowned cases.

The mockup shows all three roles; it is not a single-role prototype.

## Product Purpose

Nexyra is a case engine for positive screening results. Every case is owned, timed, and evidenced from the first lab result until a clinician confirms closure, with an audit trail that proves it.

Success: no positive screening result sits unowned, every case carries a deadline and an owner, and closure is always a clinician's decision supported by cited evidence.

## Positioning

The product is not a messaging channel and not a prediction model. Its mechanism is the case itself: a state machine driven by incoming results, with timers that escalate, events stitched into one patient history, and AI that only extracts and proposes — never closes. Nexyra builds on Malaffi referral data (DoH Circular 144/2026) rather than competing with it.

## Operating Context

- Demo pathway, pinned by the team: positive FIT → colonoscopy → pathology → follow-up. Other pathways are added as templates, not as code.
- The programme runs on hospital time; the demo runs on a demo clock that can be advanced.
- Cases arrive as referrals and lab results (HL7 v2 is the documented ingest path, covered in docs rather than built if time runs out).
- Evaluated in a hackathon judged by Future Health × Hack2skill, DoH Abu Dhabi and M42: a 5 MB deck from a mandatory template, a demo video under three minutes, a prototype link, a 2,000-character summary, a 1,500-character build summary, and a conflict-of-interest declaration. Deadline 21 Nov 2026 02:59 UTC+7.
- Working materials are the tickets in `tickets/` and the brief `brief-c05-nexyra.html`.

## Capabilities and Constraints

Confirmed capability areas, each with its own ticket:

- Case state machine with closure rules; closure always confirmed by a clinician.
- Timers, demo clock, and escalation; unowned cases are a first-class state.
- Worklist, case detail, and a closure confirmation screen with extracted evidence and citations.
- Patient outreach ladder; inter-clinician consultation monitoring.
- Report extraction with citations, and a closure-verification evaluation measured against a human-labelled test set.
- Program view and a FIT-pathway template held as configuration.

Constraints:

- All data is synthetic. No real patient data may appear anywhere.
- No drop-off risk prediction model is built.
- The interface is English for now; Arabic (RTL) is a draft-only item in TICKET-10 and is deliberately out of scope for this mockup.
- The stack is chosen for the project's needs. SQLite replaced PostgreSQL on 17 Nov to cut technical complexity.
- Unrecoverable values in the brief (problem statistics, evaluation numbers, exact challenge wording) are marked with `⚑`; they must not be invented in UI copy.

## Brand Commitments

Name: Nexyra (renamed from Itmam on 16 Nov 2026). No logo, palette, or typeface has been committed, and the brief explicitly disclaims authorship of a visual identity.

## Evidence on Hand

- `brief-c05-nexyra.html` — product brief, rebuilt from ticket references; carries `⚑` fill-marks where values are lost.
- `docs/api.md` — actor header, role permission table, engine-supplied `available_actions`.
- `docs/review-slots.md` — clinical review and label-check schedule.
- `docs/ideas/build-readiness.md` — readiness audit.
- `tickets/TICKET-09.md`, `TICKET-10.md`, `TICKET-15.md`, `TICKET-16.md` — the screens in scope.

Absent, and not to be fabricated: real programme statistics, real evaluation scores, testimonials, hospital logos, and any clinical outcome numbers.

## Product Principles

1. The case is the unit of work; every screen answers "who owns this, and what is due".
2. Evidence before assertion — extracted values carry their source quote and offset.
3. The machine proposes; the clinician decides. No interface may imply automatic closure.
4. Escalation is visible, not buried: a missed deadline should be impossible to miss in a list.
5. Synthetic data is labelled as synthetic wherever it appears.

## Accessibility & Inclusion

No product-specific standard confirmed beyond ordinary web expectations. The interface is read in a hospital office under ordinary indoor light, often by staff scanning a long list rather than reading prose.
