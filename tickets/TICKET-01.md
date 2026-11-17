# TICKET-01 · Complete the official submission requirements

- **Priority:** P0 · **Day:** 15 Nov · **Estimate:** 30 minutes · **Assignee:** human
- **Depends on:** –
- **Status:** in progress

## Goal

The submission requirements from the participant dashboard were copied into [`docs/submission.md`](../docs/submission.md) on 15 Nov. Four things can still only be seen from the participant account.

## What we already know

- Deadline: 21 Nov 2026 at 01:29 IST, which is **21 Nov at 02:59 UTC+7**.
- The organizers' PPT template is mandatory, submitted as a PDF of at most 5 MB.
- Demo video under 3 minutes, via a link anyone can open.
- A prototype or deployment link.
- Two text fields: solution summary (2,000 characters) and what was built during the challenge (1,500 characters).
- A conflict of interest declaration.

## Remaining scope

**Blocking checklist from the 17 Nov pre-code check** ([`docs/pre-code-sanity.md`](../docs/pre-code-sanity.md)). Do these in order; the first one unblocks TICKET-26 today.

- [ ] **Download the PPT template** from the "Click here to download the template" link and save it as `docs/template-deck.pptx`. If the link fails, is login-walled, or is not a .pptx, escalate to the organizers the same day. TICKET-26 cannot start without it.
- [ ] **Read the template and diff it against TICKET-26's outline the same day**, section by section. List every required section with no owner and no source material. This is how the missing technical-documentation field gets resolved properly instead of by assumption.
- [ ] **Copy the exact wording of all six challenge requirements** and the key question into `docs/template-map.md`. Three of six rows in the brief's requirement table are still placeholders; until they are filled, the deck cannot claim requirements 1, 2 and 5 are addressed.
- [ ] **Resolve the prototype-link rule.** The field is marked required but its note says "required if an existing prototype is claimed". Record which the form enforces, then record the decision "public deployment exists: yes/no" with a URL tested in a logged-out browser (TICKET-21).
- [ ] **Ask the organizers in writing whether a submission can be updated after it is sent.** Until told otherwise, assume one-shot and plan TICKET-27 accordingly.
- [ ] **Record what "AI Evaluation Score Feedback" is.** It may mean submissions are machine-scored before judging, which changes what the deck optimises for.
- [ ] **Screenshot the live countdown** from the participant account and compare it to 21 Nov 02:59 UTC+7. The whole schedule rests on that timestamp.
- [ ] **Nominate a second team member with verified account access**, test the login from a second device, and record the organizer support channel. The deadline is 02:59 local.
- [ ] **Build the checkpoint list from the organizer's own channel**, not the team calendar, and mark each one attended or missed. If one was missed, contact the organizers the same day.
- [ ] **Send the conflict-of-interest checklist to every member today** and collect written answers into `docs/form-answers.md`. TICKET-27 fills the form, but the answers cannot be guessed on anyone's behalf.
- [ ] Record the available options in the "Challenges" and "Solution stage" fields.

Original remaining scope, kept for reference:

- The PPT template download (above, now item 1).
- The four "Still to check" items in `docs/submission.md`.
- Checkpoint sessions or mandatory sessions; teams can be disqualified if members are absent.

## Done when

- [ ] The PPT template is in the project folder, and its sections have been mapped against TICKET-26's outline
- [ ] `docs/template-map.md` holds the exact wording of the six requirements and the key question
- [ ] The prototype-link rule and the edit-after-submit question are answered from the organizers, not assumed
- [ ] The live countdown has been checked against the stated deadline
- [ ] A second account holder and the organizer support channel are recorded
- [ ] Every checkpoint has an attended/missed status, not just a calendar entry
- [ ] Written conflict-of-interest answers are collected from every member
- [ ] The four "Still to check" items in `docs/submission.md` are checked off and filled in
