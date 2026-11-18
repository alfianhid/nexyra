# Frontend handoff

State of the visual layer on 17 Nov 2026, before backend work starts.

## What runs

```
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run preview  # http://localhost:4173
```

Vite + React 18 + TypeScript, no UI library. Router is `react-router-dom` v6. Styles are one file
(`src/styles.css`) with tokens mirrored in `DESIGN.md`.

## Screens

| Route | File | Ticket | Purpose |
|---|---|---|---|
| `/cases` | `src/pages/Worklist.tsx` | TICKET-09 | The register: one cell per case, deadline distance on the cell floor, five filters |
| `/cases?filter=unowned` | `src/components/UnownedList.tsx` | TICKET-08 | The "Unowned" filter on the register renders `GET /api/unowned`: hours without owner, trigger and reason, provider now, assign-owner task; each row opens the case |
| `/cases/:ref` | `src/pages/CaseDetail.tsx` | TICKET-09 | Stage strip, cited evidence with offsets, append-only audit trail |
| `/cases/:ref` (sections) | `src/components/Handoff.tsx` | TICKET-08, TICKET-11 | Ownership state and provider; hand-over forms (assign owner, patient moved provider, request consultation, answer as the receiving physician); referrals, ownership gaps and consultations tables |
| `/ingest/unstitched` | `src/pages/Unstitched.tsx` | TICKET-08 | Read-only FHIR "not yet stitched" queue (`GET /api/ingest/unstitched`), queued / stitched / all; nav link for coordinator and program manager |
| `/cases/:ref/outreach` | `src/pages/Outreach.tsx` | TICKET-10 | Attempt ladder and the log form with its error state |
| `/cases/:ref/closure` | `src/pages/Closure.tsx` | TICKET-15 | Proposal, evidence, confirm/return, role gate |
| `/programme` | `src/pages/Programme.tsx` | TICKET-16 | Stage bars (unowned = signal blue share), exception list with reasons |
| `/p/:token` | `src/pages/Patient.tsx` | TICKET-10 | Patient page from the message link, outside the staff shell: result, next step, urgency, phone, two answers, language switch, Arabic right-to-left |
| anything else | `src/pages/NotFound.tsx` | — | 404 with routes back into the product |

## State that is deliberately fake

- `src/data.ts` holds twelve synthetic cases and the programme summary. All of it is demonstration
  material and labelled as synthetic in the footer and on the programme table.
- The role switcher in the top bar (`coordinator` / `physician` / `program_manager`) stands in for the
  actor header `X-Nexyra-Actor` described in `docs/api.md`.
- Filters, the outreach log, and the closure decision all mutate local component state only. Nothing
  persists across a reload; there is no demo reset yet (TICKET-17).

## What backend work must preserve

1. **Available actions come from the engine.** `Confirm closure` is currently gated on the local role
   switch. Replace that with the `available_actions` array from the case payload; the disabled state
   and its explanatory sentence stay.
2. **Evidence keeps its provenance.** Every extracted value renders source file, character offset and
   read time. If extraction returns different fields, extend `Evidence` rather than dropping the block.
3. **State is not a colour.** A late case prints a negative number and the word `escalated`; an unowned
   case prints `no owner`. Keep both when the data becomes real.
4. **The deadline number is computed.** `dueFigure()` in `Worklist.tsx` maps `hoursLeft` to hours under
   48 and days above. With real timers, keep that mapping so the grid reads the same.
5. **Closure never happens automatically.** No copy or layout change may imply the engine closes cases.

## Verification already done

- Build clean, TypeScript strict, no unused locals.
- Six screens captured at 1440×900 and 390×844; see `docs/shots/` for the desktop set and
  `.impeccable/review/` for both viewports.
- Impeccable's design detector over `src/`: `[]` (no findings).
- Contrast, focus rings, disabled states, empty state, and error states checked by reading the render.

Four direction comps exist at `.impeccable/mocks/decision/` (see [`comps.md`](comps.md)); the built
screens are the code-led realisation of the chosen world, and the matching comp is the critique
reference for any later review.

Not done: no independent finish-reviewer pass (the agent is not installed in this environment), and no
automated accessibility test (axe or similar) has been run.

## Unowned cases, hand-over and consultations (TICKET-08, TICKET-11), 18 Nov

**Acting as Dr. Fulana.** The receiving physician (`act_006`, Hospital B) has no seat in the role
picker, which keeps its three roles. The answer form appears when the physician view's
`available_actions` contains `answer_consultation` and a consultation is open. It sends the
**addressee's own actor header** (the open consultation's `to_actor_id`, looked up in the roster),
so the audit line reads "Dr. Fulana", not "Dr. Fulan". This is the same pattern the outreach screen
uses for the navigator's call (`Outreach.tsx`). The form's heading says whose name it records under,
and an accent rule on its left edge marks it. Since 18 Nov the server checks it too: only the
addressee (`to_actor_id`) may answer; any other physician gets `403`.

**What drives each form.** Assign owner: `assign_owner`. Request consultation: `request_consultation`.
Answer: `answer_consultation` plus an open consultation. Patient moved provider: `record_provider_move`
(18 Nov; its roles are the template's for `patient_moved_provider`; `canRecordMove` in `src/handoff.ts`).
The server still rejects any other caller. The move's provider select has no default, so a move is
never one click on the first provider in the list.

**Names and dates come from the server (18 Nov).** `src/api/actors.ts` reads `GET /api/actors` once
(`useRoster()`) for the owner picker, the receiving-physician picker and the names printed for ids; only
the role picker's three seats stay a client mapping. Every timestamp a screen prints is a server label
(`occurred_label`, `due_label`, `unowned_since_label`, `sent_label`, `requested_label`, `read_label`,
...): no screen prints an ISO string or formats a date. `formatStamp` in `src/handoff.ts` is kept (and
tested) but no screen uses it. The screens never compute hours: "Unowned 20h" (`ownership.unowned_label`
on the case, `unowned_label` on the list), `hours_to_owner` and `hours_to_answer` are the server's.

**Case 2 click path** (seed state after `npm run demo:reset`):

1. Coordinator, register, **Unowned** filter: CX-1002, "Unowned 20h", referral rejected by hospital B, task with R. Haddad. Click the row.
2. Case page, Hand-over, **Patient moved provider**: Clinic B, **Record move**. The notice now says the patient moved and the task is with S. Al Ali.
3. Acting as **Physician**: type the question in **Request consultation** (Hospital B and Dr. Fulana are preselected from the referral), **Send consultation request**.
4. Optional: **+1 day** in the clock, so the answer reads 24 h.
5. **Answer as Dr. Fulana · Hospital B**: Referral accepted, new owner S. Al Ali (preselected from the assign-owner task), **Record answer as Dr. Fulana**. The notice reads "Owned by S. Al Ali, 44h after …", stage strip at Accepted, and the case has left the unowned list.

After each write, the page scrolls back to the Ownership heading. `node tools/case2-walk.mjs . 1500`
walks these steps in Edge with a 1.5 s pause per action and 25 ms per typed character, and writes
`docs/shots/case2-*.png` at 1280×800. It takes about 21 s that way and 1.5 s without pauses. It also
posts one unmatched FHIR `Procedure` for the unstitched screenshot, so reset again afterwards.

## Demo walk fixes, 18 Nov

**Record next step** (`src/components/NextStep.tsx`, case page). One generic control instead of a
button per event: a select of the case's `next_steps` (the events this role may record now, from the
template, listed by `nextSteps` in `server/engine.ts`), plus an outcome select when the step proposes
closure (`needs_outcome`) and an owner select for a hand-over (`needs_owner`), and an optional note that
becomes the audit line. It posts to `POST /events`. On an unowned case the hand-over forms come first,
on an owned case this control does.

**Closure review** (`src/pages/Closure.tsx`). The proposal box shows the reading of the *latest report*
(`GET /verification`); when that report has not been read it says *Latest report not read yet* and the
primary button is **Read the latest report** (`POST /verification`; a cached reading needs no model).
Otherwise the button is **Read the report again**. The Decision row has **Confirm closure**, **Reopen
case** (`POST /reopen`: at closure review the engine records the incomplete examination with the
reading's reasons) and **Reject proposal** (`POST /proposal/reject`, reason of 5+ characters), each gated
by `available_actions`; the old local-only "Return to engine" is gone. After a decision the box prints
the server's actor and `occurred_label` (no hard-coded name or time) and offers **Open the case**. A
case with no closure waiting (`case.awaiting_closure` false) says so instead of showing the controls.

**Pathway on screen.** Register cells and the unowned list print `pathway_label`; the case and closure
headers print `case.pathway.short_label`. The **Outreach ladder** link shows only when
`case.has_outreach` (FIT cases); a typed outreach URL for an MM case shows a notice, not an error.

**Register counts.** The figure reads "Open cases in this register" with the scope in words; the
counts are the role's whole register and ignore the filter (`GET /api/cases`).

**The role survives a refresh** (`sessionStorage`, per tab, wrapped in try/catch), because the demo
refreshes after each inbound FHIR step.

**Walk.** `node tools/demo-walk.mjs . 1500` clicks the whole live script (case 3 with the repeat
colonoscopy, case 2, case 1, programme; inbound steps through `npm run demo:step`) in Edge and writes
`docs/shots/case3-*`, `case2-*`, `case1-*`, `patient-ar.png`, `programme-*` at 1280×800 (56 s of
clicks at that pace). `--video` walks the video's path only (33 s); `--no-shots` times without writing.
Reset before and after: it writes to the demo database.

## Role sweep, 18 Nov

The screen offers a role only what the server lets it do. The rules the nav and pages use live in
`src/api/permissions.ts`: `canReadProgramme(role)` mirrors `PROGRAMME_READ_ROLES` in
`server/programme.ts` (responsible physician, program manager), and `src/api/permissions.test.ts`
fails if the two lists drift apart. Coordination staff get no **Programme** nav item and no
**Programme view** link on the 404 page. A typed `/programme`, or switching to Coordinator while on
it, shows a plain notice with **Switch to Program manager** and **Back to Cases**, and sends no
request (it used to show the server's 403 in a red box).

Other fixes from the same sweep (every route × the three roles, plus a role switch on each page):

- **Consultation form** offers only providers with a physician who can answer
  (`consultableProviders` in `src/handoff.ts`, same rule as the server's `answer_roles`). On CX-1003
  it used to start on Endoscopy Unit E, and sending gave `Provider "prov_endo_e" has nobody who can
  answer a consultation.` A note now says which provider was left out and why.
- **Closure review**: the red *No citation on this proposal* box shows only while a closure is waiting
  on a pathway the engine reads. A mammography case (no AI reading) gets a plain note instead, and
  **Confirm closure** no longer needs citations there; the server still checks the evidence.
- **Outreach** on an MM case asks for the ladder only when the case has one, so the typed URL shows
  its notice without a 404 request behind it.
- **404 page**: the example case is CX-1001 (CX-0417 exists only in the old fixtures).

Expected, not errors: `/cases/<unknown ref>` answers 404 (the page says *Case not found*), and
`/p/<bad token>` shows the patient-facing *This link is not valid* notice.
