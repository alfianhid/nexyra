# Template map

Source: `docs/[PUB] Future Health Digital Innovation Challenge _ Submission Template.pptx`, read from `ppt/slides/slide*.xml` on 18 Nov 2026. It has 16 slides. The slide order in `ppt/presentation.xml` matches the file numbers. An asterisk after a title means the template marks the item as required. Prompt text is verbatim.

Rules from the ticket: keep slide order, titles and layout. Do not delete slides. If a section does not apply, write a short explanation. Key information must be in text, not only in images.

Status key: **ready** = material exists in the repository. **partial** = some material, gaps named. **no material** = the team has nothing yet.

| # | Slide title | Prompt text (verbatim) | Answered by | Status |
|---|---|---|---|---|
| 1 | (no title; three labels) | `Team Name:` / `Team Size:` / `Problem Statement:` | Team name: Itmam / Nexyra, to confirm with the team. Problem statement: brief section 1 and the form's Solution summary in `docs/form-answers.md`. Team size: ask the team. | partial |
| 2 | Team members* | `[Name, country, role, organization, age confirmation]`. Table columns: S.No, Name, Country, Role, Organization, Age confirmation, rows 1 to 5. | Not in the repository. Each member must supply their own details and age confirmation. | **no material** |
| 3 | Team Capability Summary* | `Maximum 1,000 characters` | Brief section 10 (no clinician on the team; external reviewer credited as permitted) and `docs/limitations.md`. Skills and experience of members must come from the members. | partial |
| 4 | Architecture or workflow diagram* | (title only) | Brief section 3 (case flow) and `docs/architecture.md` (being written by another agent). The current code has seven stages, not the brief's ten. Draw what exists, mark the rest planned. | partial |
| 5 | Target users and intended outcome* | (title only) | `PRODUCT.md` (users and roles), brief sections 1 to 2. Intended outcome must be worded as a design aim, never as a proven result. | ready |
| 6 | How will success be measured?* | (title only) | Brief section 8 (closure verification on labelled reports) and `docs/responsible-ai.md`. Pilot measures are not defined anywhere: for a pilot, candidates are time-to-owner, share of cases with an owner, share of stages closed within deadline. These are proposals and need a team decision. `[EVAL RESULTS PENDING — TICKET-14]` | partial |
| 7 | Evidence supporting the approach* | `Citations, studies, benchmarks, or prior testing.` | `docs/evidence.md`. Prior testing: the test suite and `[EVAL RESULTS PENDING — TICKET-14]`. | ready, except the 30.5% citation and eval results |
| 8 | Data sources and legal right to use them* | `List source, type, owner, sensitivity, permissions, and whether personal data is used.` | `docs/data-sources.md` | ready |
| 9 | Risks and safeguards* | `Privacy; security; bias; explainability; misuse; human oversight; failure modes.` | `docs/responsible-ai.md`, `docs/limitations.md`. Security and privacy: only partly covered; no security review exists. | partial |
| 10 | Hardware requirements | `Required if wearable, sensor, connected device, or other hardware is there. Include sourcing and safety.` | Not applicable. Write one line: software only, no hardware. | ready |
| 11 | (title is the prompt) | `If the application requires login authentication, please provide valid access credentials` / `or enable a "Continue as Guest" option with all necessary features and functionalities accessible to guest users.` | The app has no login. The role is picked from a menu, which works as guest access. State this, and give the prototype URL (TICKET-21). | partial, needs the deployed URL |
| 12 | Path to pilot and scale* | `Stakeholders, integration, regulatory needs, timeline assumptions, and sustainability.` | Brief section 9, `docs/dependencies.md`. Timeline assumptions and sustainability (who pays, who runs it) are not written anywhere. | partial |
| 13 | Pre-existing IP and third-party materials* | `Identify ownership, licenses, open-source components, and restrictions.` | `docs/dependencies.md` lists components; a licence list from `package-lock.json` is not produced yet. Ownership statement for the code and for the literature figures needs a team decision. | partial |
| 14 | Conflict of interest declaration* | `Disclose relationships with organizers, partners, or judges.` | Each member's answers, collected for `docs/form-answers.md`. Must match the form. | **no material** |
| 15 | Additional Slide | (no prompt) | Optional. Candidates: screenshots of the real prototype, demo case walk-through, the Malaffi positioning. | n/a |
| 16 | (no text) | (no text) | Contains no text in the file. Open the slide in PowerPoint to see whether it is a closing or image slide. | check by eye |

## Slides the team cannot fill from the repository

- Slide 2 (team members): personal details only the members have.
- Slide 14 (conflict of interest): answers only the members have.
- Slide 3 (capability summary): needs each member's background in at most 1,000 characters.
- Slide 6 (success measures): needs a decision on pilot metrics.
- Slide 12 (timeline, sustainability): not written.
- Slide 13 (licences, ownership): licence list not generated.

## Items that wait on other tickets

- Evaluation numbers: `[EVAL RESULTS PENDING — TICKET-14]` (slides 6, 7, 9).
- Clinical review status: `[CLINICAL REVIEW PENDING — TICKET-19]` (slides 3, 9, 12).
- Screenshots and prototype link: TICKET-21 (slides 4, 11, 15).

## Content the ticket says must appear, and where it fits

| Content | Slide |
|---|---|
| The problem, with numbers and sources | 1, 7 |
| What Nexyra does and for whom | 5 |
| Mapping to the six challenge requirements | 5 or 15. The exact requirement wording is still unverified in the brief (requirements 1, 2 and 5 are marked as needing wording). |
| Architecture and the role of AI | 4, 9 |
| What was built and what is only designed | 4, 15 |
| Evaluation results with denominators | 6, 7 |
| Assumptions, dependencies, limitations | 9, 12, 15 |
| AI and data governance | 8, 9 |
| Pilot path and positioning relative to e-Referral | 12 |
| The team and the external reviewer | 2, 3 |
