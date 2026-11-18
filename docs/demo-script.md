# Demo script (7 minutes, live)

TICKET-17. The long version, for a live presentation if the team is called. The submission video has its own, shorter script: [`video-script.md`](video-script.md).

Order on stage: **case 3, case 2, case 1, programme view.** All people, providers and reports are fictional; every case is synthetic.

Every step below is also a request in [`scripts/demo/steps.ts`](../scripts/demo/steps.ts) (the step id is in the first column), and `server/demo.test.ts` runs the whole list through the API after a reset and checks each result. If the screen for a step is missing or misbehaves, the same step can be sent from a terminal:

```bash
npm run demo:step -- 2.5            # one step, to http://localhost:3001
DEMO_API_URL=https://<deployment> npm run demo:step -- 3.6 3.7
npm run demo:step -- list           # every step with its id
```

Steps marked **inbound** stand for a message from another system (the endoscopy unit's or the laboratory's FHIR resources). There is no button for them on purpose: in production they arrive over the interface. Send them with `demo:step` and say so.

## Before you start

1. `npm run demo:reset` (local) or wait for the nightly reset on the hosted demo; by hand there: `curl -X POST -H "Authorization: Bearer <secret>" https://<deployment>/api/demo/reset`. It takes about 6 s and always gives the same state: day 0 (17 Nov 2026 · 11:42), the three demo cases, the three mammography cases (MM-2001 to MM-2003), the 1,000-case synthetic cohort.
2. `npm run server` and `npm run dev` (local), open the app at `/cases`.
3. Check: acting as Program manager, the worklist shows CX-1001, CX-1002, CX-1003 and MM-2001, MM-2002, MM-2003 only (the cohort is hidden there by default). The header clock reads **17 Nov 2026 · 11:42**.
   The three MM cases are visible in the program manager's register as the second-pathway proof (mammography, `TICKET-18`) and do not escalate during the scripted demo: their first deadlines are 24 Nov 09:00 and 10:00, after the last clock jump (day 6, 23 Nov 11:42).
4. The demo needs no network and no model key: case 3's reading is cached. Turn Wi-Fi off for a local run if you want to prove it.
5. Keep a terminal open in the project folder for the inbound steps.

## Timing

| Part | Clock | Time on stage |
|---|---|---|
| Opening | day 0 | 0:00 to 0:30 |
| Case 3, "done" that is not done | day 0 | 0:30 to 2:30 |
| Case 2, referral rejected, patient moves | day 0 → day 1 | 2:30 to 4:15 |
| Case 1, the silent patient | day 1 → day 3 | 4:15 to 6:00 |
| Programme view | day 3 → day 6 | 6:00 to 7:00 |

Case 3 and case 2 each fit in under a minute if cut to the steps in bold, which is what the video does.

## Opening (0:00 to 0:30)

Screen: **Cases** (worklist), acting as Coordinator.

Say: "After a positive FIT test the patient needs a colonoscopy. In the Abu Dhabi data we have, only 30.5% got one (2015 to 2016, the latest figure we know). The cases are not lost in one place; they fall between people. Nexyra gives every case an owner, a deadline and an audit line. Three cases."

## Case 3: "done" that is not done (0:30 to 2:30, day 0)

| Step | Screen and control | Clock | Say |
|---|---|---|---|
| **3.1** | Acting as **Physician**. Worklist → **CX-1003** (L. Fernandes, 52) → **Closure review**. | day 0 | "Every step was marked complete and the coordinator proposed closing it: returned to routine screening. Before a physician signs, Nexyra reads the colonoscopy report." |
| **3.1** | Same screen: the notice reads *AI proposal, not a decision: reopen*, with two quotes: "Preparation was inadequate." and "The cecum was not reached." | | "Two findings, each with the exact sentence from the report. The model only reads; rules in code turn the findings into a proposal, and a quote that is not in the report is thrown away. This reading is cached, so nothing here needs the network." |
| 3.2 | (optional) the screen's re-read, if it has one; otherwise skip. | | "Reading again costs nothing: same report, same answer, from the cache." |
| **3.3** | Closure review → **Reopen**. **Re-check:** today's closure review has *Confirm closure* and *Return to engine* but no *Reopen*. The control must send the `procedure_incomplete` event (`POST /api/cases/CX-1003/events`), not `POST /reopen`, which the template only allows from a closed case. Fallback: `npm run demo:step -- 3.3`. | | "The physician does not close it. The case goes back to the referral step, with the outcome cleared, and it keeps an owner: Dr. Fulan." |
| 3.4 | Case CX-1003 → **Assign owner** → S. Al Ali. **Re-check** (no control on the case page yet). Fallback: `demo:step -- 3.4`. | | "Handed to the coordinator to rebook." |
| 3.5 | Acting as Coordinator. Case CX-1003 → record **Referral accepted**. **Re-check**. Fallback: `demo:step -- 3.5`. | | "The endoscopy unit takes the repeat." |
| 3.6 | **inbound**: `npm run demo:step -- 3.6` (Appointment from Endoscopy Unit E). Refresh the case. | | "The unit's booking arrives as a FHIR Appointment and is stitched to the case by the referral number and the patient identifier: stage Colonoscopy booked." |
| 3.7 | **inbound**: `demo:step -- 3.7` (Procedure + colonoscopy report). | | "The repeat colonoscopy is done and complete: caecum reached, one 8 mm polyp removed for histology." |
| 3.8 | Acting as Physician. Record **Pathology ordered**. **Re-check**. Fallback: `demo:step -- 3.8`. | | |
| 3.9 | **inbound**: `demo:step -- 3.9` (pathology report). | | "Pathology: tubular adenoma, completely removed, surveillance in three years." |
| 3.10 | Acting as Coordinator. **Propose closure**, outcome *Surveillance scheduled*. **Re-check**. Fallback: `demo:step -- 3.10`. | | |
| **3.11** | Acting as Physician. **Closure review** → outcome *Surveillance scheduled* → **Confirm closure**. Then open the case: stage *Closed*, the timeline shows both colonoscopies, the reopen and the physician's confirmation. | | "Now the physician closes it, with the evidence attached and their name on the audit line. The system can propose; only a physician can close." |

Known issue to fix before rehearsal: at step 3.11 the closure review still shows the **first** report's reading (*reopen*), because the case view shows the case's latest stored reading and the repeat reports have none (no key, and no cached reading for them). Either the repeat reports get a stored reading, or the screen shows the reading of the document being closed on. Until then, say: "The AI reading on screen is the first report's; the physician read the pathology report."

## Case 2: referral rejected, the patient moves (2:30 to 4:15, day 0 → day 1)

The screens for this case (unowned queue, moving a patient, consultations) are being built in parallel. Controls are named by what they will do; **re-check every row once those screens land**, and use `demo:step` until then. The picker also needs S. Al Ali (coordinator at clinic B) and Dr. Fulana (receiving physician at hospital B).

| Step | Screen and control | Clock | Say |
|---|---|---|---|
| **2.1** | Acting as Coordinator. **Unowned** queue: one row, CX-1002 (R. Kumar, 47), *Referral rejected by hospital B: colonoscopy request incomplete*, task with R. Haddad (clinic A). | day 0 | "Hospital B rejected the referral. In most systems the case now belongs to nobody. Here it is on the unowned list, with a task and a deadline for someone at the referring clinic." |
| **2.2** | Case CX-1002 → **Patient moved provider** → Clinic B. | | "The patient has moved to clinic B. The case is still unowned, but the task follows the patient: it is now S. Al Ali's at clinic B." |
| **2.3** | Acting as Physician. Case CX-1002 → **Ask the receiving provider**: "Missing FIT date and history now attached. Can you accept the referral?" | | "Instead of a phone chase, one question to hospital B, with an owner and a 48-hour deadline. In production this travels over Malaffi e-Referral; Nexyra only keeps the owner and the clock." |
| **2.4** | Header → **+1 day**. Clock: **18 Nov 2026 · 11:42**. | day 1 | "A day later." |
| **2.5** | As Dr. Fulana (receiving physician). Consultation → **Accept**, owner S. Al Ali. | | "Hospital B accepts and names the owner. Answered in 24 hours; the case was unowned for 44 hours, and that number goes to the programme view." |
| **2.6** | **inbound**: `demo:step -- 2.6` (Appointment from hospital B). Refresh the case. | | "Their booking is stitched to the case: Colonoscopy booked, owner S. Al Ali, and the unowned list is empty." |

## Case 1: the silent patient (4:15 to 6:00, day 1 → day 3)

| Step | Screen and control | Clock | Say |
|---|---|---|---|
| 1.1 | Acting as Coordinator. Case **CX-1001** (Y. Al Hammadi, 58, Arabic) → **Outreach ladder**. Status *Staff call*; the call task opened when the clock moved in case 2. | day 1 | "An automated message in Arabic went out on 16 Nov with a link to a patient page. No answer in 48 hours, so when the clock moved, the ladder opened a call task for the case's coordinator. Nobody pressed a button for that." |
| 1.2 | Outreach → log a call: *Reached the patient*: No, result "No answer". | | "No answer." |
| 1.3 | Header → **+1 day**. Clock: 19 Nov. Nothing new on the ladder. | day 2 | "The navigator waits 48 hours after the call step." |
| 1.4 | Header → **+1 day**. Clock: **20 Nov 2026 · 11:42**. Ladder status *With the navigator*, task for Nur H. | day 3 | "No movement, so the case goes to the navigator." |
| 1.5 | As **Navigator** (Nur H.): Outreach → log a call, reached: Yes, reason for delay **Fear**, note "Afraid of drinking the bowel preparation". **Re-check:** the picker has no navigator yet. Fallback: `demo:step -- 1.5`. | | "The navigator reaches him. The barrier is fear of the bowel preparation, recorded as a reason, not free text, so the programme can count it." |
| 1.6 | Open the patient page **/p/hq7m3kx9va** (the link from the message). Arabic, right to left. | | "This is what the patient sees: no login, the result in his language, one next step." |
| 1.7 | Patient page → **understood**. Back to the case: stage *Patient notified*. | | "He confirms. The case moves to Patient notified and the ladder stops on its own." |

## Programme view (6:00 to 7:00, day 3 → day 6)

| Step | Screen and control | Clock | Say |
|---|---|---|---|
| P.0 | Header → **Next deadline**. Clock: **23 Nov 2026 · 11:42**. One escalation, to the responsible physician. | day 6 | "Jump to the next deadline: CX-1001 has been told but no referral has gone out in 72 hours, so it escalates to the responsible physician. Time escalates cases; nobody has to remember." |
| P.1 | Acting as Program manager → **Programme**. Point at: the label that the data are synthetic; the funnel; referral to colonoscopy against the 31-day limit; delay reasons (fear); escalations per role per day; exceptions. | | "This is the programme across 1,000 synthetic cases plus our three: where cases stall, how many are past the 31-day referral limit, which barriers staff record, and how many alerts each role gets a day, so we can see alert fatigue before it happens. The cohort is synthetic and its drop-off rates are assumptions, written down in the repository. Nothing here is a finding about real patients." |

Close: "What is proven: the mechanism, end to end, on synthetic data; every step you saw is replayed through the API by an automated test. What is not: any effect on real patients. That is what a pilot is for."

Known issue to fix before rehearsal: the *Delay reasons* panel shows **Fear 2** after step 1.5, for one barrier. Logging the call writes an `outreach_attempted` event with the reason, and the ladder's `task_completed` for the navigator's task copies the reason into its own payload (`afterOutreachLogged` in `server/outreach/ladder.ts`); `server/programme.ts` counts both event types. One of the two should stop carrying or stop counting it.

## Controls to re-check once the parallel screens land

| Step | Control needed | API it must call |
|---|---|---|
| 3.3 | Reopen on the closure review | `POST /api/cases/CX-1003/events` `{ "type": "procedure_incomplete" }` |
| 3.4 | Assign owner on the case page | `POST /api/cases/{id}/events` `{ "type": "owner_assigned", "payload": { "owner_actor_id": "act_005" } }` |
| 3.5, 3.8 | Record the next step on the case page | `POST /api/cases/{id}/events` with `referral_accepted`, `pathology_ordered` |
| 3.10 | Propose closure with an outcome | `POST /api/cases/{id}/events` `{ "type": "closure_proposed", "payload": { "outcome": "surveillance_scheduled" } }` |
| 2.1 | Unowned queue | `GET /api/unowned` |
| 2.2 | Patient moved provider | `POST /api/cases/CX-1002/events` `{ "type": "patient_moved_provider", "payload": { "provider_id": "prov_clinic_b" } }` |
| 2.3 | Ask the receiving provider | `POST /api/cases/CX-1002/consultations` |
| 2.5 | Answer a consultation, and Dr. Fulana in the picker | `POST /api/consultations/{id}/answer` |
| 1.5 | Navigator in the picker | `POST /api/cases/CX-1001/outreach` as `act_002` |
| 2.2, 1.2 | S. Al Ali in the picker (today's coordinator is R. Haddad, which also works for these steps) | |

## If something goes wrong

- Any step fails or the state looks wrong: `npm run demo:reset` (about 6 s), reload, and restart from the case you were on. Steps from earlier cases do not need to be repeated for case 3 or case 2; case 1 expects the one day that case 2 advanced, so press **+1 day** once before starting it after a reset.
- The clock moved too far: there is no going back except a reset.
- The hosted demo resets itself every night at 21:00 UTC (01:00 in Abu Dhabi), so what the judges open is always day 0.
