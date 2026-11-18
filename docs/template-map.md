# Template map

Source: `docs/[PUB] Future Health Digital Innovation Challenge _ Submission Template.pptx`, read from `ppt/slides/slide*.xml` on 18 Nov 2026. It has 16 slides. The slide order in `ppt/presentation.xml` matches the file numbers. An asterisk after a title means the template marks the item as required. Prompt text is verbatim.

Rules from the ticket: keep slide order, titles and layout. Do not delete slides. If a section does not apply, write a short explanation. Key information must be in text, not only in images. The final text for every slide is in [`deck-content.md`](deck-content.md).

Status key: **ready** = the text is written from material in the repository. **partial** = written, with named gaps. **team** = only the team can supply it.

| # | Slide title | Prompt text (verbatim) | Source documents | Status |
|---|---|---|---|---|
| 1 | (no title; three labels) | `Team Name:` / `Team Size:` / `Problem Statement:` | Problem: `form-answers.md` (summary), `evidence.md`. Team Nexyra, size 2. | ready |
| 2 | Team members* | `[Name, country, role, organization, age confirmation]`. Table columns: S.No, Name, Country, Role, Organization, Age confirmation, rows 1 to 5. | Two members, listed in `deck-content.md`. | ready |
| 3 | Team Capability Summary* | `Maximum 1,000 characters` | `limitations.md` (no clinician on the team). Skills of the two members. | ready |
| 4 | Architecture or workflow diagram* | (title only) | `architecture.md`, `README.md` ("What is in the build"), screenshots in `docs/shots/` | ready |
| 5 | Target users and intended outcome* | (title only) | `PRODUCT.md`, `evidence.md`, `docs/demo-script.md` | ready |
| 6 | How will success be measured?* | (title only) | `responsible-ai.md` (evaluation), `assumptions.md`. Pilot measures are proposals. Evaluation of 18 Nov: 0 of 14 must-not-close reports proposed for closure; 4 of 10 closable proposed, 6 of 10 held back (synthetic, 24 reports). | ready |
| 7 | Evidence supporting the approach* | `Citations, studies, benchmarks, or prior testing.` | `evidence.md`; prior testing: 317 automated tests. Full citation of the 30.5% figure is in `evidence.md`. | ready |
| 8 | Data sources and legal right to use them* | `List source, type, owner, sensitivity, permissions, and whether personal data is used.` | `data-sources.md` | ready |
| 9 | Risks and safeguards* | `Privacy; security; bias; explainability; misuse; human oversight; failure modes.` | `responsible-ai.md`, `limitations.md`. No security review exists. | partial |
| 10 | Hardware requirements | `Required if wearable, sensor, connected device, or other hardware is there. Include sourcing and safety.` | Not applicable: software only. | ready |
| 11 | (title is the prompt) | `If the application requires login authentication, please provide valid access credentials` / `or enable a "Continue as Guest" option with all necessary features and functionalities accessible to guest users.` | The app has no login; the role picker acts as guest access. URL from TICKET-21. | partial, needs URL |
| 12 | Path to pilot and scale* | `Stakeholders, integration, regulatory needs, timeline assumptions, and sustainability.` | `dependencies.md`, `architecture.md` (several pathways, ingest), `limitations.md`. Timeline and sustainability are proposals (see `dependencies.md`). | ready |
| 13 | Pre-existing IP and third-party materials* | `Identify ownership, licenses, open-source components, and restrictions.` | `dependencies.md`. `third-party-licences.md` (100 shipped packages). Ownership: the two members. | ready |
| 14 | Conflict of interest declaration* | `Disclose relationships with organizers, partners, or judges.` | Both members answered no to all five questions; recorded in `form-answers.md`. Must match the form. | ready |
| 15 | Additional Slide | (no prompt) | Use: the two-pathway demonstration, the screenshots, assumptions and limitations in one place. | ready |
| 16 | (no text) | (no text) | Contains no text in the file. Open the slide in PowerPoint to see whether it is a closing or image slide. | check by eye |

## Slides filled from the team's answers

- Slide 1: team name Nexyra, size 2.
- Slide 2: the two members' details.
- Slide 3: the two members' skills (1,000 characters at most).
- Slide 6: pilot measures are proposals.
- Slide 12: timeline and sustainability are proposals.
- Slide 13: ownership and the licence list.
- Slide 14: both members answered no to all five questions.

## Items that wait on other tickets

- Evaluation numbers (slides 6, 7, 9): run on 18 Nov 2026 with `muse-spark-1.3`, prompt `extract-v1`, 24 synthetic reports. Dangerous error first: 0 of 14 must-not-close reports proposed for closure (14 of 14 held back). 4 of 10 closable reports proposed, 6 of 10 held back (false alarms). Fields: 24 of 24 complete exam and pathology available, 23 of 24 next step, 20 of 24 tissue taken, 16 of 24 outcome category, 15 of 24 adequate preparation. 1 citation rejected. Source: `docs/evaluation-results.md`.
- Clinical review status: not done, no clinician on the team; comes before any pilot (slides 3, 9, 12).
- Deployment URL: https://nexyra-health.vercel.app (slides 4, 11, 15). Video link: `[PENDING — TICKET-21]`.
- Screenshots `case1-*`, `case3-*`, `programme-*`, `patient-ar.png`: being captured (see `deck-content.md`).

## Content the ticket says must appear, and where it fits

| Content | Slide |
|---|---|
| The problem, with numbers and sources | 1, 7 |
| What Nexyra does and for whom | 5 |
| Mapping to the challenge requirements | 5, 15 (the exact requirement wording is still unverified in the brief) |
| Architecture and the role of AI | 4, 9 |
| What was built and what is only designed | 4, 15 |
| Evaluation results with denominators | 6, 7 |
| Assumptions, dependencies, limitations | 9, 12, 15 |
| AI and data governance | 8, 9 |
| Pilot path and positioning relative to e-Referral | 12 |
| The team | 2, 3 |
