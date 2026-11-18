# Video script (under 3 minutes, target 2:45)

TICKET-21. Derived from the live script in [`demo-script.md`](demo-script.md), cut to TICKET-21's outline. English narration over a screen recording. Case 1 (the silent patient) is not shown as its own segment, for time; it appears once, in the clock jump. Draft: timings are estimates until a rehearsal recording is timed.

**Recording setup.** Run `npm run demo:reset` right before recording (day 0, 17 Nov 2026 · 11:42). Browser zoom 125% or more and a window about 1280 px wide, so the text stays readable in a small player. No other tabs, notifications or bookmarks on screen; no API key anywhere in view. The step ids (3.1, 2.5, ...) are the requests in `scripts/demo/steps.ts`; `server/demo.test.ts` ("the video's path") runs this exact path and checks every number read out below.

The case-2 screens are being built in parallel, and the closure review has no **Reopen** control yet (step 3.3); re-check those rows before recording (see "Controls to re-check" in `demo-script.md`). Inbound messages (FHIR from the endoscopy unit, not shown here) and any missing control can be sent with `npm run demo:step -- <id>` between takes and cut out.

## 0:00 to 0:20 · The problem

Screen: the worklist (**Cases**), acting as Program manager: the three demo cases, plus the three mammography cases (MM-2001 to MM-2003) that show a second pathway on the same engine; none of them escalates during the video.

> After a positive bowel-screening test, the next step is a colonoscopy. In the Abu Dhabi data we have, only 30.5 percent of patients got one. Cases fall between people. Nexyra gives every case an owner, a deadline, and an audit line.

On-screen text: "30.5% had the follow-up colonoscopy (Abu Dhabi, 2015 to 2016)".

## 0:20 to 1:20 · Case 3: "done" that is not done

| Time | Screen and action | Narration |
|---|---|---|
| 0:20 | Acting as **Physician** → **CX-1003** → **Closure review** (step 3.1). | "This case is marked done: every step recorded, closure proposed. Before a physician signs, Nexyra reads the colonoscopy report." |
| 0:35 | Zoom on the notice *AI proposal, not a decision: reopen* and the two quotes. | "Two findings, each with the exact sentence it came from: preparation inadequate, caecum not reached. The model only reads. Rules in code make the proposal, and a quote that is not in the report is rejected." |
| 0:55 | **Reopen** (step 3.3). The case page: stage *Referral sent*, owner Dr. Fulan, outcome cleared. | "So the physician does not close it. The case goes back to referral for a repeat colonoscopy, and it keeps an owner. The system can propose; only a clinician closes or reopens." |
| 1:15 | Hold on the timeline's last line. | "Every step is on the audit line, with a name." |

## 1:20 to 2:00 · Case 2: referral rejected, the case becomes unowned, it gets a new owner

| Time | Screen and action | Narration |
|---|---|---|
| 1:20 | Acting as Coordinator → **Unowned** queue: CX-1002 (step 2.1). | "Hospital B rejected this referral. Usually the case now belongs to nobody. Here it is on the unowned list, with a task and a deadline." |
| 1:30 | Case CX-1002 → **Patient moved provider** → Clinic B (2.2). | "The patient has moved clinic, and the task follows the patient." |
| 1:38 | Acting as Physician → **Ask the receiving provider** (2.3). | "One question to hospital B, with a 48-hour deadline." |
| 1:45 | Header → **+1 day** (2.4); as Dr. Fulana → **Accept**, owner S. Al Ali (2.5). | "A day later hospital B accepts and names the owner. Unowned for 44 hours, and that number is measured." |

## 2:00 to 2:30 · The clock moves, escalation runs, programme view

| Time | Screen and action | Narration |
|---|---|---|
| 2:00 | Header → **Next deadline** (step P.0). Clock **20 Nov 2026 · 11:42**. Show the result: 1 escalation, to the responsible physician; 1 case made unowned; the navigator step. | "Now we jump to the next deadline. Case 3's repeat referral has had no answer for 72 hours: it escalates to the physician and goes back on the unowned list, with a task. A third patient who never answered our messages goes to a navigator. Nobody pressed a button on any of these cases." |
| 2:15 | Acting as Program manager → **Programme** (P.1): the synthetic-data label, the funnel, referral to colonoscopy against the 31-day limit, escalations per role per day. | "The programme view, over 1,000 synthetic cases: where cases stall, how many are past the 31-day referral limit, and how many alerts each role gets a day." |

## 2:30 to 2:45 · What is proven, what is not, the pilot path

Screen: the programme view, then a closing card.

> What we have shown: the mechanism, end to end, on synthetic data, and every step in this video is replayed by an automated test. What we have not shown: any effect on real patients. The next step is a pilot with one clinic, reading referral status from Malaffi e-Referral, to measure time to owner and how many stages close within their deadline.

Closing card (on screen, not read): "Nexyra · synthetic data only · not clinically validated · prototype link: <URL>".

## Numbers in this video and where they come from

| Number | Source |
|---|---|
| 30.5% colonoscopy follow-up after a positive FIT, Abu Dhabi, 2015 to 2016 | `docs/evidence.md` (full citation still to be added there before submission) |
| 48-hour consultation deadline | `server/pathways/fit-colonoscopy.json`, `consultation.answer_hours` |
| 44 hours unowned (CX-1002) | demo data; checked in `server/demo.test.ts` |
| 72-hour referral acceptance deadline | `fit-colonoscopy.json`, `referral_sent.sla_hours`; unsourced, needs clinical review |
| 1 escalation, 1 case unowned, 1 navigator step at the jump | `server/demo.test.ts`, "the video's path" |
| 1,000 synthetic cases | `data/generator-assumptions.json` (`cohort_size`) |
| 31-day referral-to-colonoscopy limit | HAAD standard, cited in BMC Cancer 2021 (`docs/evidence.md`) |

The pilot measures named at 2:30 (time to owner, share of stages closed within deadline) are proposals in `docs/template-map.md` and still need a team decision; change the sentence if the team picks others.
