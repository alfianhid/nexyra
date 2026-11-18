# Deck content (final text, slide by slide)

For the mandatory template `docs/[PUB] Future Health Digital Innovation Challenge _ Submission Template.pptx` (16 slides, order and titles unchanged; see [`template-map.md`](template-map.md)). Text is in English and written to fit a slide box: a short heading line, then bullets of one line each where possible. Each slide answers its own question in its own words, because the deck may be read by software before a person sees it. Terms follow the challenge and judging criteria: health impact and clinical relevance, responsible AI, scalability, technical depth, working solution and demo, commercial and path to pilot.

Rules for whoever builds the deck:

- Keep every figure exactly as written. Do not add claims about patient outcomes.
- Screenshots are in `docs/shots/` and all named below exist (captured 18 Nov against the latest build). Do not use `closure.png`, `detail.png`, `worklist.png`, `outreach.png`, `programme.png` or `notfound.png`: they are stale.
- The prototype link is https://nexyra-health.vercel.app. Only the demo video link is still `[PENDING — TICKET-21]`. It stays until the real link exists. Replace it in the deck; never leave a bracket in the final PDF.

---

## Slide 1. Team name, team size, problem statement

**Team Name:** Nexyra
**Team Size:** 2
**Problem Statement:**

After a positive screening result, nobody is clearly responsible for the next step. In Abu Dhabi, only 30.5% of people with a positive FIT or gFOBT had the follow-up colonoscopy (2015 to 2016 data; 12% were never told their positive result). Malaffi e-Referral tracks referral documents, not who owns the screening result or what happens when nobody acts. Challenge 05: closing the screening-to-care loop.

Screenshot: none.

---

## Slide 2. Team members*

Table, one row per member: S.No, Name, Country, Role, Organization, Age confirmation.

| S.No | Name | Country | Role | Organization |
|---|---|---|---|---|
| 1 | Alfian Hidayatullah | Indonesia | Team leader. Data & Tech Executive | WPP Media |
| 2 | Fajar Aji Pamungkas | Indonesia | Team member. Business Intelligence & Data Engineer | Combiphar (a pharmaceutical company) |

Age confirmation: Alfian is 26 and Fajar is 27. Both are over 18.

Note under the table: no clinician is on the team.

Screenshot: none.

---

## Slide 3. Team Capability Summary* (maximum 1,000 characters)

Re-count before pasting (limit 1,000).

> Alfian Hidayatullah (team leader) is a Data & Tech Executive at WPP Media. Fajar Aji Pamungkas is a Business Intelligence & Data Engineer at Combiphar, a pharmaceutical company. Both work with data and software. The two of us built the whole prototype during the challenge: case engine, HL7 v2 and FHIR ingest, report extraction, programme view, tests and deployment. No clinician is on the team. The pathway, deadlines, closure rules, test labels and patient wording have not been reviewed by a clinician; that review comes before any pilot. We also did not check the Arabic wording with a native speaker.

Screenshot: none.

---

## Slide 4. Architecture or workflow diagram*

Heading: **One case engine above Malaffi data. Pathways are configuration. AI proposes; a physician closes.**

Diagram (draw it; the text below is the same content for software readers):

1. Inputs: positive FIT result (HL7 v2 ORU or FHIR), referral messages (HL7 v2 REF), FHIR Appointment, Procedure and DiagnosticReport. Anything that does not match a case goes to an unstitched queue and is never dropped.
2. Case engine (Express, one Vercel function; Turso/libSQL): pathway file (FIT built, mammography as configuration), one owner per stage, deadline per stage, escalation by role, unowned triggers, append-only audit trail.
3. Outreach ladder: automated message (English or Arabic) then staff call then navigator. Patient page, no login.
4. Consultation monitoring on top of e-Referral: owner, deadline and escalation for a question between providers. Not a messaging channel.
5. Report extraction: a model returns six fields with a quote each; code checks every quote is in the report; plain rules turn the fields into a proposal (reopen, wait for pathology, needs human reading, propose closure).
6. Closure: valid outcome, attached evidence and the responsible physician's confirmation. The system role and AI can never close a case.
7. Programme view: exceptions, funnel, 31-day referral-to-colonoscopy limit, delay reasons, escalations per role per day, scenario panel (labelled assumption).

Built: everything above, on synthetic data. Designed, not built: probabilistic identity matching, Malaffi connection, SMS gateway, login.
Hosted: https://nexyra-health.vercel.app (Vercel; API and Turso database in Mumbai; daily reset). Stack: React and Vite, Express, Turso, any OpenAI-compatible model endpoint (DeepSeek default; Meta Muse Spark via the Meta Model API possible). 317 automated tests in 26 files.

Screenshots: `docs/shots/case2-2-case-unowned.png` (unowned case with its task and clock), `docs/shots/case3-8-closed.png` (closure confirmed by the physician with quotes). The diagram is drawn from `docs/architecture.md`.

---

## Slide 5. Target users and intended outcome*

Heading: **For the people who own a positive result, and the programme that must see where cases stall.**

Users:
- Coordination staff: work the cases they own, with deadlines, outreach tasks and the unowned queue.
- Navigator: gets the patients who did not respond to the message or the staff call.
- Responsible physician: reads the latest report and its quotes, then confirms closure, reopens the case, or rejects the AI proposal with a reason. Dr. Fulana (receiving physician) and Nur H. (navigator) act through their own forms on the case page.
- Program manager: sees exceptions, the funnel, the 31-day limit and alert load per role.
- Patient: receives the result in English or Arabic and one next step.

Intended outcome (a design aim, not a result): every positive result has one named owner, a deadline and a record; a case with no owner is visible; a case is closed only on evidence and a physician's decision. Health impact and clinical relevance would be shown in a pilot by follow-up completion and time to colonoscopy. We do not claim that Nexyra improves patient outcomes.

Challenge fit: closes the loop between a screening result and care without a risk model.

Screenshots: `docs/shots/case1-1-ladder.png` (outreach ladder for a silent patient), `docs/shots/patient-ar.png` (patient page in Arabic).

---

## Slide 6. How will success be measured?*

Heading: **Two kinds of measure: the mechanism now, programme outcomes in a pilot.**

Measured now, on synthetic data:
- Closure verification (run 18 Nov 2026, `muse-spark-1.3`, prompt `extract-v1`, 24 labelled synthetic reports): wrong closures first, 0 of 14 reports that must not be closed were proposed for closure (14 of 14 held back). Of 10 reports that may be closed, 4 of 10 were proposed and 6 of 10 were held back for a human (false alarms, mostly bowel preparation written as a score only). Field agreement: complete exam 24 of 24, pathology available 24 of 24, next step 23 of 24, tissue taken 20 of 24, outcome category 16 of 24, adequate preparation 15 of 24. 1 citation rejected by the quote check. 0 prompt changes after seeing results. Synthetic, team-written, 24 is small, labels not checked by a clinician. Source: `docs/evaluation-results.md`.
- Behaviour of the engine: 317 automated tests in 26 files, including the whole demo replayed through the API. The live model path is verified end to end with real calls (the 18 Nov evaluation); the tests use a fake model.

Proposed for a pilot, to be agreed with the programme and clinicians:
- Share of positive results with a named owner within a set time.
- Share of cases with a colonoscopy within 31 days of referral, the HAAD standard for over 90% of people (cited in Almansoori et al., BMC Cancer 2021).
- Time unowned cases wait for a new owner.
- Colonoscopy follow-up after a positive FIT, against the 30.5% baseline (2015 to 2016).
- Alerts per role per day, so alert fatigue is seen early.
- Share of AI proposals the physician rejects. The prototype already counts this (`ai_divergence`: rejections plus closures confirmed against the last reading), on synthetic data.

Drop-off rates in the synthetic cohort are inputs, not findings.

Screenshot: `docs/shots/programme-2-delays.png` (referral-to-colonoscopy bands, delay reasons counted once per barrier, physician against the AI reading). Optional: `docs/shots/programme-1-top.png`.

---

## Slide 7. Evidence supporting the approach*

Heading: **Outreach drove follow-up in the trials; risk prediction did not change the navigation effect.**

- Atlas et al., JAMA 2023: follow-up completed in 22.9% with usual care, 22.7% with an EHR reminder, 31.0% with reminder plus letter and phone outreach, 31.4% with outreach plus a navigator. Outreach drove the effect, not navigation. One trial, one health system.
- Kaiser Permanente Northwest, 2021: navigation 76% against 65% usual care. The prediction model had a C-statistic of 0.65. No evidence that effects differed by risk group.
- PRECISE, 2025 (from summaries, not full text): 55.1% with navigation against 42.1% without. Risk prediction did not change the navigation effect.
- Abu Dhabi: Almansoori A, Alzaabi M, Alketbi L. Colorectal Cancer screening in ambulatory healthcare service clinics in Abu Dhabi, United Arab Emirates in 2015–2016. BMC Cancer. 2021;21:897. doi:10.1186/s12885-021-08623-9. Of people screened with FIT or gFOBT, 13.5% were positive; 30.5% (436) of those had the follow-up colonoscopy and 933 did not; 12% were never told their positive result. The paper cites the HAAD Standard for Colorectal Cancer Screening (2014): colonoscopy within 31 days of referral after a positive FIT, for over 90% of people.
- DoH Circular 144/2026: all referral transactions go to Malaffi as HL7 REF messages by 31 August 2026; e-Referral is for referral management, status tracking and referrer-receiver communication.
- What follows for the design: an outreach ladder that starts early, escalation to people, no risk model. We do not claim that risk-targeted navigation works.
- Prior testing: 317 automated tests. Evaluation of report reading, 18 Nov 2026: 0 of 14 must-not-close reports proposed for closure; 4 of 10 closable reports proposed, 6 of 10 held back for a human (24 synthetic reports, labels not checked by a clinician).

Screenshot: none (text slide).

---

## Slide 8. Data sources and legal right to use them*

Heading: **Synthetic data only. No personal data.**

| Source | Type | Owner | Sensitivity | Permissions | Personal data |
|---|---|---|---|---|---|
| Six demo cases and actors | Invented | The team | None | Own work | No |
| 1,000-case synthetic cohort (seeded generator) | Generated | The team | None | Own work | No |
| 24 labelled test reports | Invented, written with AI help | The team | None | Own work | No |
| HL7 v2 and FHIR example messages | Invented | The team | None | Own work | No |
| Patient message templates (English, Arabic) | Written by the team | The team | None | Own work | No |
| Literature (Atlas, Kaiser NW, PRECISE, BMC Cancer) | Published | Authors | Public | Cited, not copied | No |
| DoH Circular 144/2026 | Official circular | DoH | Public | Cited by number and gist, not reproduced | No |

Only synthetic data is ever sent to a model, because a provider's free-credit terms may allow content to be used for product improvement. Nothing from any team member's workplace was used.

Screenshot: none.

---

## Slide 9. Risks and safeguards*

Heading: **Responsible AI: AI reads and proposes, a physician decides, and every claim is checkable.**

- Human oversight: AI never closes a case. The system role is blocked in code and in tests. Only the responsible physician's confirmation closes one, with a valid outcome and attached evidence. Proposals are labelled as AI proposals. The physician can reopen the case or reject a proposal with a reason (`proposal_rejected` never moves the case), and the programme view counts physician-AI divergence.
- Explainability: every extracted answer carries a quote. Code checks that the quote is in the report; if not, the field becomes unknown. Rules in code, not the model, turn the fields into a proposal. Cancer never yields a closure proposal.
- Failure modes: a doubt ends as "needs human reading"; a case staying open is the safe direction of error. No model key gives no model call. A model can still quote correctly and choose the wrong value, so the physician reads the quote.
- Bias: no risk score and no patient features beyond age and language in invented cases. Real-data bias, including Arabic reports, is untested.
- Privacy and security: no personal data. No login, security review or privacy assessment yet; a pilot needs them first.
- Misuse: a user can confirm closure wrongly; the audit trail records who did. Consultation answers are enforced to the addressed physician (server 403 otherwise). The role is still self-declared: no login.
- Demo readings: the two readings stored for case 3 are stored demo readings, not model output. The first has a model label that was not a verified live call; the second is hand-written (`hand-written demo reading (no model call)`). The live model path was verified with real calls in the 18 Nov evaluation; these stored readings are not output of those calls.
- Patient wording: Arabic not reviewed by a native speaker; Urdu, Hindi and Tagalog are empty drafts; English and Arabic not reviewed by a clinician.
- Evaluation: run 18 Nov 2026 on 24 synthetic reports; 0 of 14 must-not-close reports proposed for closure, 4 of 10 closable reports proposed, 6 of 10 held back; labels not checked by a clinician. Clinical review: no clinician is on the team, and the pathway, deadlines, closure rules, test labels and patient wording have not been reviewed by one. That comes before any pilot.

Screenshots: `docs/shots/case3-2-closure-reopen.png` (AI proposal, not a decision: reopen, with quotes), `docs/shots/case3-3-reopened.png` (case reopened by the physician, reasons recorded).

---

## Slide 10. Hardware requirements

Heading: **Not applicable. Software only.**

Nexyra uses no wearable, sensor, connected device or other hardware. It runs in a web browser and as a server function.

Screenshot: none.

---

## Slide 11. Access for reviewers (login or guest)

Heading: **No login needed. Open the link and pick a role.**

- Prototype link: https://nexyra-health.vercel.app (public)
- Demo video (under 3 minutes): `[PENDING — TICKET-21]`
- The app has no login. A role picker with three seats (coordinator, physician, program manager) gives guest access to every feature; the receiving physician and the navigator act through their own forms on the case page. All data is synthetic.
- The hosted demo resets itself every day, so a reviewer always starts at day 0. The demo clock is moved from the screen header.
- Suggested first minute: pick Physician, open case CX-1003, Closure review; then pick Program manager, open Programme.

Screenshot: `docs/shots/case3-1-register.png` (the register as the physician sees it).

---

## Slide 12. Path to pilot and scale*

Heading: **From a synthetic demonstration to a supervised pilot on one screening pathway.**

- Stakeholders: Department of Health Abu Dhabi, Malaffi, a screening programme or hospital with a named clinical owner, receiving endoscopy and pathology units. None is engaged yet.
- Integration (scalability, technical depth): Nexyra reads the referral and result messages DoH Circular 144/2026 already requires. HL7 v2 REF and ORU ingest and FHIR stitching exist; the field map must be checked against the Malaffi specification, which we have not seen. Consultation monitoring reads e-Referral status and owns only the deadline and escalation.
- Scale across pathways: a pathway is a JSON file. Mammography runs on the same engine with no engine change; it is a demonstration and has not been clinically reviewed. The engine runs the programme view over 1,000 cases in about 0.2 s locally and loads from a fixed number of database round trips.
- Regulatory and governance needs: DoH approval for a pilot, data protection and security review, an AI policy for clinical data, real authentication and per-user audit, native-speaker and clinical review of patient text, an SMS or WhatsApp gateway.
- Timeline (proposal): month 1 clinical and DoH review, and Malaffi data access; months 2 to 4 read-only pilot at one FIT screening site; months 5 to 7 owners, escalation and outreach live with coordination staff, against the pre-pilot baseline; then more pathways and sites.
- Sustainability (proposal): a per-site subscription paid by the screening programme owner, on UAE-hosted infrastructure. Pricing follows the pilot evidence (cases closed within 31 days, staff time). No price is claimed yet.

Screenshot: `docs/shots/programme-1-top.png`.

---

## Slide 13. Pre-existing IP and third-party materials*

Heading: **All code written during the challenge. Open-source packages under their own licences.**

- Ownership: the code and documents are owned by the two team members. The source is visible on GitHub (github.com/alfianhid/nexyra) for evaluation. No open-source licence is granted yet.
- Open-source components: React 18, Vite 5, React Router 6, Express 4, `@libsql/client`, `hl7v2` (BSD-3-Clause), Vitest 2, TypeScript, tsx. Full licence list: `docs/third-party-licences.md`. It covers 100 shipped packages: MIT 90, ISC 4, BSD-3-Clause 4, Apache-2.0 1, 0BSD 1.
- Services: Vercel (hosting), Turso (database), an OpenAI-compatible model provider (DeepSeek default; Meta Muse Spark via the Meta Model API possible). Provider terms apply; only synthetic data is sent.
- Literature and the DoH circular are cited, not reproduced.
- Restrictions: no real patient data may be loaded; the demo wording is not clinically reviewed and is not for patient care.
- No pre-existing proprietary IP is used.

Screenshot: none.

---

## Slide 14. Conflict of interest declaration*

Heading: **Declaration for every team member.**

Both members answered no to all five questions. This slide and the form say the same.

The five questions: employed or contracted by the Department of Health Abu Dhabi; employed or contracted by Future Health or a challenge collaborator (Microsoft, Inception42, MBZUAI, Hack2skill); a family member or close personal relationship with a judge, organizer or collaborator staff; a financial interest in the organization running or judging the challenge; access to non-public information about the challenge or its judging.

Declaration: None. No member has any of these relationships.

Screenshot: none.

---

## Slide 15. Additional Slide

Heading: **What works today, what is a demonstration, and what is not done.**

Working solution and demo (all synthetic):
- Case 3: a case marked done is reopened because the AI reading quotes "Preparation was inadequate." and "The cecum was not reached." After the repeat colonoscopy and pathology, the closure review reads the latest report (both reports together) and the physician confirms closure. Both readings are stored demo readings, not model output.
- Case 2: a referral is rejected, the case is unowned, the patient moves, a consultation is answered, and an incoming booking is stitched to the case.
- Case 1: a silent patient. Message, staff call task, then navigator; the patient page in Arabic.
- Programme view over 1,000 synthetic cases: exceptions, funnel, 31-day limit, delay reasons, physician-AI divergence.
- Hosted at https://nexyra-health.vercel.app, resets itself every day.

Demonstration only: mammography pathway, not clinically reviewed.

Assumptions: deadlines other than the 31-day limit are team assumptions; drop-off rates are inputs, not findings; the scenario panel applies one trial's effect size and is labelled an assumption.

Not done: clinical review (no clinician on the team, labels not checked by a clinician; comes before any pilot), Malaffi connection, real messaging, login, security review.

Nexyra is not a referral tracker and not a messaging channel, and it builds no risk model.

Screenshots (a row of three): `docs/shots/case3-3-reopened.png`, `docs/shots/case1-1-ladder.png`, `docs/shots/case2-4-consultation.png`. Optional: `docs/shots/case2-7-unstitched.png`, `docs/shots/programme-3-escalations.png`.

---

## Slide 16

The template slide has no text. Check it in PowerPoint; leave it as the template has it.
