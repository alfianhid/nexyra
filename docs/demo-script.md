# Demo script (7 minutes, live)

TICKET-17. The long version, for a live presentation if the team is called. The submission video has its own, shorter script: [`video-script.md`](video-script.md).

Order on stage: **case 3, case 2, case 1, programme view.** All people, providers and reports are fictional; every case is synthetic.

Every step below is also a request in [`scripts/demo/steps.ts`](../scripts/demo/steps.ts) (the step id is in the first column), and `server/demo.test.ts` runs the whole list through the API after a reset and checks each result. `node tools/demo-walk.mjs . 1500` clicks the same path in Edge at a presenter's pace (18 Nov: 56 s of clicks, no errors) and writes the screenshots in `docs/shots/`. If a screen misbehaves, the same step can be sent from a terminal:

```bash
npm run demo:step -- 2.5            # one step, to http://localhost:3001
DEMO_API_URL=https://<deployment> npm run demo:step -- 3.6 3.7
npm run demo:step -- list           # every step with its id
```

Steps marked **inbound** stand for a message from another system (the endoscopy unit's or the laboratory's FHIR resources). There is no button for them on purpose: in production they arrive over the interface. Send them with `demo:step`, say so, and refresh the page (the role you picked survives the refresh).

**Who the screen records.** The role picker has three seats: Coordinator (R. Haddad), Physician (Dr. Fulan), Program manager (A. Al Suwaidi). Where `steps.ts` acts as S. Al Ali (coordinator at clinic B), the screen records R. Haddad; the rules are the same, only the name on the audit line differs. Dr. Fulana (hospital B) and Nur H. (navigator) have no seat: their forms appear on the case and outreach screens when a consultation or a navigator task is theirs, and record under their own names.

## Before you start

1. `npm run demo:reset` (local) or wait for the nightly reset on the hosted demo; by hand there: `curl -X POST -H "Authorization: Bearer <secret>" https://<deployment>/api/demo/reset`. It takes about 6 s and always gives the same state: day 0 (17 Nov 2026 · 11:42), the three demo cases, the three mammography cases (MM-2001 to MM-2003), the 1,000-case synthetic cohort.
2. `npm run server` and `npm run dev` (local), open the app at `/cases`.
3. Check: acting as **Program manager**, the register shows CX-1001, CX-1002, CX-1003 and MM-2001, MM-2002, MM-2003 only (the cohort is hidden there by default). Each cell names its pathway ("FIT → colonoscopy", "Mammogram → biopsy"). The header clock reads **17 Nov 2026 · 11:42**.
   The three MM cases are the second-pathway proof (mammography, `TICKET-18`) and do not escalate during the scripted demo: their first deadlines are 24 Nov 09:00 and 10:00, after the last clock jump (day 6, 23 Nov 11:42).
4. The demo needs no network and no model key: both of case 3's readings are cached (the first report, and the repeat colonoscopy read with its pathology). Turn Wi-Fi off for a local run if you want to prove it.
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

Screen: **Cases** (the register), acting as Coordinator.

Say: "After a positive FIT test the patient needs a colonoscopy. In the Abu Dhabi data we have, only 30.5% got one (2015 to 2016, the latest figure we know). The cases are not lost in one place; they fall between people. Nexyra gives every case an owner, a deadline and an audit line. Three cases."

## Case 3: "done" that is not done (0:30 to 2:30, day 0)

| Step | Screen and control | Clock | Say |
|---|---|---|---|
| **3.1** | Header **Acting as** → Physician. Register → cell **CX-1003** (L. Fernandes, Closure proposed, FIT → colonoscopy) → **Closure review**. | day 0 | "Every step was marked complete and the coordinator proposed closing it: returned to routine screening. Before a physician signs, Nexyra reads the colonoscopy report." |
| **3.1** | Same screen: the box reads *AI proposal, not a decision: Reopen the case*, "Incomplete exam and inadequate prep", and below it two quotes: "Preparation was inadequate." and "The cecum was not reached." | | "Two findings, each with the exact sentence from the report. The model only reads; rules in code turn the findings into a proposal, and a quote that is not in the report is thrown away. This reading is cached, so nothing here needs the network." |
| 3.2 | (optional) **Read the report again**. | | "Reading again costs nothing: same report, same answer, from the cache." |
| **3.3** | Scroll to **Decision**. Reason: "Repeat colonoscopy needed" → **Reopen case**. The box reads *Case reopened by Dr. Fulan · 17 Nov 11:42*: back at Referral sent, owner Dr. Fulan, outcome cleared, with the reading's reasons. | | "The physician does not close it. The engine records an incomplete examination, with the AI's two findings and her reason on the audit line. The case goes back to the referral step, the outcome is cleared, and it keeps an owner." |
| 3.4 | **Open the case** → **Record next step**: Step *Owner assigned or handed over*, New owner *S. Al Ali · coordination staff*, note "Handed to S. Al Ali to rebook" → **Record step**. | | "Handed to the coordinator at clinic B to rebook." |
| 3.5 | **Acting as** → Coordinator. **Record next step**: *Receiving provider accepted the referral → Referral accepted* → **Record step**. | | "The endoscopy unit takes the repeat." |
| 3.6 | **inbound**: `npm run demo:step -- 3.6` (Appointment from Endoscopy Unit E). Refresh. Stage *Colonoscopy booked*. | | "The unit's booking arrives as a FHIR Appointment and is stitched to the case by the referral number and the patient identifier." |
| 3.7 | **inbound**: `demo:step -- 3.7` (Procedure + colonoscopy report). Refresh. Stage *Colonoscopy done*. | | "The repeat colonoscopy is done and complete: caecum reached, one 8 mm polyp removed for histology." |
| 3.8 | **Acting as** → Physician. **Record next step**: *Pathology ordered* → **Record step**. | | |
| 3.9 | **inbound**: `demo:step -- 3.9` (pathology report). Refresh. Stage *Pathology received*. | | "Pathology: tubular adenoma, completely removed, surveillance in three years." |
| 3.10 | **Acting as** → Coordinator. **Record next step**: *Closure proposed with an outcome → Closure proposed*, Outcome proposed *Surveillance scheduled* → **Record step**. (The physician has the same step; the template lets either propose.) | | "The coordinator proposes closing it again, this time with surveillance." |
| **3.11** | **Acting as** → Physician. **Closure review**. The box reads *AI proposal, not a decision: Latest report not read yet* (the first report's "reopen" is history, not the proposal on the table). **Read the latest report**. Now: *Propose closure*, "Complete exam, adequate prep, polyp with pathology available; proposed outcome: surveillance scheduled", six quotes from the repeat report and the pathology, read together. | | "The physician reads the latest report: the repeat colonoscopy and its pathology, together. Six findings, each quoted. The proposal is now closure with surveillance." |
| **3.12** | Outcome to confirm *Surveillance scheduled* → **Confirm closure**. The box reads *Closure confirmed by Dr. Fulan · 17 Nov 11:42*. **Open the case**: stage *Closed*; the audit trail shows both colonoscopies, the reopen with its reasons and the physician's confirmation. | | "Now the physician closes it, with the evidence attached and their name on the audit line. The system can propose; only a physician can close." |

**Reject proposal** (same Decision row, physician only) records that the physician does not accept the AI proposal, with a reason of at least 5 characters. It does not move the case; the programme view counts it as a divergence between physician and AI. It is not part of the scripted path.

## Case 2: referral rejected, the patient moves (2:30 to 4:15, day 0 → day 1)

| Step | Screen and control | Clock | Say |
|---|---|---|---|
| **2.1** | **Acting as** → Coordinator. Register → filter **Unowned**: one row, CX-1002 (R. Kumar, 47), *Unowned 20h*, *Receiving provider rejected the referral: Colonoscopy request incomplete (hospital B)*, task with R. Haddad, due 17 Nov 15:40. The figure above still reads the open cases in the coordinator's register (the counts ignore the filter). | day 0 | "Hospital B rejected the referral. In most systems the case now belongs to nobody. Here it is on the unowned list, with a task and a deadline for someone at the referring clinic." |
| **2.2** | Click the row → case CX-1002 (Owner *Unowned 20h*). **Hand-over** → **Patient moved provider**: Moved to *Clinic B* → **Record move**. The box now says the patient moved and the assign-owner task is with S. Al Ali, due 18 Nov 11:42. | | "The patient has moved to clinic B. The case is still unowned, but the task follows the patient: it is now S. Al Ali's at clinic B, with a fresh 24 hours." |
| **2.3** | **Acting as** → Physician. **Request consultation** (Hospital B and Dr. Fulana are preselected from the referral): Question "Missing FIT date and history now attached. Can you accept the referral?" → **Send consultation request**. | | "Instead of a phone chase, one question to hospital B, with an owner and a 48-hour deadline. In production this travels over Malaffi e-Referral; Nexyra only keeps the owner and the clock." |
| **2.4** | Header → **+1 day**. Clock: **18 Nov 2026 · 11:42**. | day 1 | "A day later." |
| **2.5** | Same page, **Answer as Dr. Fulana · Hospital B**: Answer *Referral accepted*, New owner *S. Al Ali · coordination staff*, note → **Record answer as Dr. Fulana**. The box reads *Owned by S. Al Ali*, owner again 18 Nov 11:42, 44h after the rejection. Only Dr. Fulana, the addressee, can record this answer. | | "Hospital B accepts and names the owner. Answered in 24 hours; the case was unowned for 44 hours, and that number goes to the programme view." |
| 2.6 | **inbound**: `demo:step -- 2.6` (Appointment from hospital B). Refresh: stage *Colonoscopy booked*, owner S. Al Ali; register → **Unowned** is empty. | | "Their booking is stitched to the case, and the unowned list is empty." |

## Case 1: the silent patient (4:15 to 6:00, day 1 → day 3)

| Step | Screen and control | Clock | Say |
|---|---|---|---|
| 1.1 | Acting as Coordinator. Case **CX-1001** (Y. Al Hammadi, 58, Arabic) → **Outreach ladder**. Status *Staff call*; the call task opened when the clock moved in case 2. | day 1 | "An automated message in Arabic went out on 16 Nov with a link to a patient page. No answer in 48 hours, so when the clock moved, the ladder opened a call task for the case's coordinator. Nobody pressed a button for that." |
| 1.2 | **Log a call**: Reached the patient *No*, What happened "No answer" → **Log attempt as R. Haddad**. | | "No answer." |
| 1.3 | Header → **+1 day**. Clock: 19 Nov. Nothing new on the ladder. | day 2 | "The navigator waits 48 hours after the call step." |
| 1.4 | Header → **+1 day**. Clock: **20 Nov 2026 · 11:42**. A **Navigator call** section appears: task for Nur H. | day 3 | "No movement, so the case goes to the navigator." |
| 1.5 | **Navigator call**: Reached the patient *Yes*, Reason for delay *Fear*, What happened "Reached the patient; afraid of the bowel preparation" → **Log attempt as Nur H.** | | "The navigator reaches him. The barrier is fear of the bowel preparation, recorded as a reason, not free text, so the programme can count it, once." |
| 1.6 | Open the patient page **/p/hq7m3kx9va** (the link from the message). Arabic, right to left. | | "This is what the patient sees: no login, the result in his language, one next step." |
| 1.7 | Patient page → the first button (*understood*, in Arabic). Back to the case: stage *Patient notified*. | | "He confirms. The case moves to Patient notified and the ladder stops on its own." |

## Programme view (6:00 to 7:00, day 3 → day 6)

| Step | Screen and control | Clock | Say |
|---|---|---|---|
| P.0 | Header → **Next deadline**. Clock: **23 Nov 2026 · 11:42**. One escalation, to the responsible physician. | day 6 | "Jump to the next deadline: CX-1001 has been told but no referral has gone out in 72 hours, so it escalates to the responsible physician. Time escalates cases; nobody has to remember." |
| P.1 | **Acting as** → Program manager → **Programme**. Point at: the label that the data are synthetic; the funnel; referral to colonoscopy against the 31-day limit; **Delay reasons recorded by staff** (Fear 1); **Physician against the AI reading** (0 on the scripted path, 1 if a proposal was rejected); escalations per role per day; exceptions. | | "This is the programme across 1,000 synthetic cases plus our three: where cases stall, how many are past the 31-day referral limit, which barriers staff record, where physicians disagreed with the AI, and how many alerts each role gets a day, so we can see alert fatigue before it happens. The cohort is synthetic and its drop-off rates are assumptions, written down in the repository. Nothing here is a finding about real patients." |

Close: "What is proven: the mechanism, end to end, on synthetic data; every step you saw is replayed through the API by an automated test. What is not: any effect on real patients. That is what a pilot is for."

## If something goes wrong

- Any step fails or the state looks wrong: `npm run demo:reset` (about 6 s), reload, and restart from the case you were on. Steps from earlier cases do not need to be repeated for case 3 or case 2; case 1 expects the one day that case 2 advanced, so press **+1 day** once before starting it after a reset.
- A control is missing: check **Acting as** first. Each form appears only for the roles the engine allows at that stage.
- The clock moved too far: there is no going back except a reset.
- The hosted demo resets itself every night at 21:00 UTC (01:00 in Abu Dhabi), so what the judges open is always day 0.
