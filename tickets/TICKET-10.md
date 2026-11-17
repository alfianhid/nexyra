# TICKET-10 · Patient outreach ladder

- **Priority:** P0 · **Day:** 17 Nov · **Estimate:** 4 hours · **Assignee:** Claude Code
- **Depends on:** TICKET-06, TICKET-09
- **Status:** not started

## Goal

Answering challenge requirement 3 (clear communication, in the right language, with confirmation of understanding) in an evidence-backed way: automated outreach first, humans for those who do not respond.

## Scope

- **Step 1, automated message.** A patient page opened from a link in the message (in the prototype: a message preview and a simulated link). It explains the result in plain language, what the next step is, how urgent it is, and a number to call.
- Two buttons on the patient page: "I understand and I will come" and "I would like a phone call". Both become events on the case. A call request becomes a task with an owner and a deadline.
- **Step 2, staff phone call.** If the patient does not respond by the deadline, a call task is created for coordination staff. Staff record the call outcome: connected or not, and the patient's reason for delaying (fear, transport, cost, language, other).
- **Step 3, navigator.** If the case still does not move, or staff record a barrier, the case escalates to a navigator.
- Languages: English and Arabic templates (with right-to-left text). Urdu, Hindi, and Tagalog are only shown as template slots labeled "draft, not yet reviewed by a native speaker".
- Message content comes from fixed templates with variables (name, date, place). No clinical text is invented by AI when a message is sent.

## Out of scope

Real SMS or WhatsApp delivery. Free-form Q&A chatbot. Clinical answers from AI.

## Done when

- [ ] Test: a silent patient escalates to a staff call and then to a navigator according to the template deadlines
- [ ] Test: patient confirmation stops the ladder and advances the case
- [ ] Test: a call request creates a task with an owner and a deadline
- [ ] Delay reasons are stored as structured choices and appear in the program view (TICKET-16)
- [ ] The Arabic patient page renders right-to-left correctly
- [ ] Arabic template text is marked "not yet reviewed by a native speaker" in the documentation until someone reviews it

## Notes

The deadlines between steps are template parameters (TICKET-04) and are not yet sourced. In the Atlas 2023 trial letters went out in week 2 and phone calls in week 4, too slow for the 31-day limit, so our values deliberately differ and that must be written down as an assumption.
