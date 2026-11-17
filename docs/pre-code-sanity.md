# Pre-code sanity check — challenge assumptions and edge cases

Written 17 Nov 2026, before TICKET-01. Method: two fresh-context adversarial reviewers were given the artifact and the contract only, with no statement of what the author believed. Findings below are reconciled against the actual text, not rubber-stamped.

## What the reviewers were given

- **Contract A:** the team must not miss the submission window, must not be disqualified, and must not discover a submission blocker after the work is done.
- **Contract B:** a judge must not find, in the deck, a claim falsified by the brief's own text, a requirement answered by something not built, or a schedule that cannot produce what the deck says exists.

## The finding that matters most

**TICKET-01 is not a 30-minute admin ticket.** Three of six rows in the brief's requirement table are placeholders ("restore the exact wording from the challenge page"), and the fix requires exactly the participant-account access this ticket exists to obtain. Until those three rows are filled, the deck cannot honestly claim requirements 1, 2, and 5 are addressed — and the deck is the thing being judged.

Second: the brief currently asserts two things that are **not true yet**, in the past tense:

| Section | Says | Reality on 17 Nov |
|---|---|---|
| §10 | resource "then reviewed by one clinician with clinic experience outside Abu Dhabi" | TICKET-19 not started, slot not booked |
| §11 Q&A | "one external clinician … reviewed it before the judges did" | same |
| §8 | test material "labeled by hand before extraction ever ran" | labels due end of today, Fulan not booked |

Any judge who asks "who reviewed it, when, what did they change" gets a worse answer than the brief implies. These are one-line tense fixes now and a credibility problem on 20 Nov.

Third: the brief reports its own safety failures and then claims they cannot happen. §11 says *"A misread can make a case stay open too long; it cannot close one that should not close."* §8 says wrong closures that "slipped through" are reported at the top of the results, and TICKET-14 calls that "the dangerous error". Both are defensible only if the distinction between *proposed* and *closed* is stated. Right now it is not.

## Falsifiable claims in the brief, ranked

1. **§11 safety claim vs §8 evaluation.** "Cannot close one that should not close" needs the qualifier: a misread cannot close a case without human confirmation, but it *can* propose closure wrongly, and that error is counted. **Fix:** one sentence.
2. **§10/§11 clinical review in past tense.** Make it conditional and dated: review on 18 Nov, corrections applied before submission, unreviewed deadlines marked as such. Do not use past tense until `docs/clinical-review.md` exists.
3. **§6 "Built and demonstrated" lists 12 systems.** 27 tickets, nothing built, 4 days left, one unbooked review, an evaluation, three demo cases, a deploy, a deck, a video. Retitle to "planned P0 by 20 Nov" and re-date after 18 Nov, or expect the judge to count artifacts against the claim.
4. **§4 requirement 4 answered by consultation monitoring**, which §6 lists under *designed, not built* and TICKET-11 puts second in the cut order. Mark partial: engine logic exists, e-Referral status monitoring does not.
5. **§4 requirements 1, 2, 5 are placeholders** in a section titled "Meeting the challenge requirements". Retrieve the exact strings (TICKET-01) or state they are not addressed. A placeholder cannot survive into the deck.
6. **§8 "labeled by hand before extraction ever ran"** — state it as a condition evidenced by `docs/evaluation-results.md` timestamps, not a claim in the brief.
7. **§12 cites an "approximately 8-point follow-up lift"** while §1 and §12 both say effect sizes were lost and must be re-sourced. It cannot be both a lost statistic and a quoted one. Delete the number or mark it to verify.
8. **§12 Malaffi mandate date (31 Aug 2026) is already past** as the brief is read, and the positioning argues Nexyra attaches to "data Circular 144/2026 already mandates". Unstated leap: mandate ⇒ REF messages exist, are complete, and are reachable by a third party. §10 admits no REF message has been seen. Add the assumption explicitly.
9. **§4 requirement 3** claims the patient's language and confirmation of understanding, but only English and Arabic exist (Arabic unreviewed by a native speaker and fifth in the cut order), and the two buttons record self-attestation of intent, not comprehension. Narrow to: comprehension is confirmed by the staff call.
10. **Mammography "configured"** in §11 while §12 says the standard's time limits "have not been read yet" and TICKET-18 is first to be cut. Say "template structure proven by a second configuration, deadlines placeholder" or drop the claim.

## Submission edge cases that can still sink this

- **Template still not downloaded**, and TICKET-26 was scheduled to start today. Retrieve it as the first action; if the link fails or is login-walled, escalate to organizers today.
- **Template contents unread**, yet the missing technical-documentation field is resolved by "most likely it all goes into the deck per the template". That is a guess filling a mandatory-fields gap. Walk the template against TICKET-26's outline the same day and list any section with no owner.
- **Deck 5 MB and video link are unverified.** Export the PDF and check size and formatting; open the video link logged out. Drive permissions and "unlisted" settings fail for external viewers routinely.
- **Deck content, video, and the final from-scratch check all land 19 Nov.** No slack for a re-render. Move the video to 18 Nov.
- **"Prototype / Deployment Link" is contradictory**: marked required, but its note says "required if an existing prototype is claimed". Resolve which the form enforces, then record "public deployment exists: yes/no" with an incognito-tested URL.
- **Can a submission be updated after it is sent?** Presented as a click-through; it probably needs a written question to Hack2skill. The answer is binary and decides everything: if editable, submit a complete draft early and iterate; if one-shot, the 19 Nov build has to be right first time. Until told otherwise, assume **one-shot** and plan accordingly.
- **One human, one login, deadline 02:59 local.** Nominate a second member with verified account access, test login from a second device now, and record the organizer support channel.
- **Checkpoints as calendar entries is not an audit.** Build the list from the organizer's own channel, mark attended/missed per checkpoint, and contact organizers the same day if any are missed.
- **Timezone.** IST as India (UTC+5:30) is almost certainly right — Hack2skill is Indian — but the whole schedule rests on that timestamp. Screenshot the live countdown from the account and compare.
- **Conflict of interest** is listed in TICKET-27 but not in TICKET-01's scope. Send the checklist to every member today and collect written answers; a guessed "none of the above" is disqualification-grade.
- **AI Evaluation Score** sits in "Visible but unexplained" and is covered by no checklist item in TICKET-01. It may mean submissions are machine-scored, which changes what the deck optimises for.

## Assumptions the plan is betting on

- Participants can download the template and see the form fields without special access.
- The prototype link can point at a public deployment that exists by 20 Nov.
- Fulan reviews labels before the first extraction run and the flow before the deck is final.
- ~100 hours of ticket work fits in 4 days alongside the deck, video, deploy, and submission.
- Judges score mechanism and auditability, not measured patient impact — the brief bets on this explicitly and it is the right bet, but it is a bet.

## What changes now, before TICKET-01 starts

1. TICKET-01 gains a blocking checklist covering the template, the six requirement strings, the prototype-link rule, the edit policy, the timezone screenshot, the second login, and the COI answers.
2. The three tense claims in the brief get conditional wording (needs owner sign-off; the brief may be republished).
3. The 8-point effect size and the "cannot close one that should not close" sentence get fixed in the same pass.

## Recorded trade-off

**Not doing:** rewriting §6's 12-item "built" list today. The list is the plan, and the team is allowed to plan; re-dating it on 18 Nov with actual state is cheaper than maintaining an accurate list for three days. Accepted risk: if the deck is assembled from §6 without re-checking, it overclaims.
