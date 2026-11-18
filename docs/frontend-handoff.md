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
and an accent rule on its left edge marks it. The server does not check that the answering physician
is the addressee (any responsible physician may answer), so this is a presentation choice, not a
permission.

**What drives each form.** Assign owner: `assign_owner`. Request consultation: `request_consultation`.
Answer: `answer_consultation` plus an open consultation. Patient moved provider: the engine sends no
action for it (its action list stops at the eight in `server/vocabulary.ts`). The template gives
`patient_moved_provider` the same roles as `log_outreach` (coordination staff, navigator), so the form
is shown when the case is open and `log_outreach` is available (`canRecordMove` in `src/handoff.ts`).
The server still rejects any other caller.

**Client copies, kept small.** `src/api/actors.ts` holds a `roster` of the seed's six human actors
with their provider, because the API has no actor list and ownership gaps and consultations name
actors by id only. It feeds the owner picker, the receiving-physician picker and the names printed
for ids. `formatStamp` reprints a server ISO stamp as "16 Nov 15:40" in the stamp's own offset.
It does no date arithmetic, and the screens never compute hours: "Unowned 20h", `hours_to_owner` and
`hours_to_answer` are the server's.

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
