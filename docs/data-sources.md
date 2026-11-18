# Data sources

## Statement on personal data

No personal data was used. No real patient record, name, identifier, image or report was collected, copied or processed. Every person, report and event in the prototype is invented by the team. Nothing from any team member's or reviewer's workplace was used.

Because the data is synthetic, it is the only kind that is sent to an external model. This matters while the team uses Meta's free credits, where content may be used for product improvement.

## Data in the prototype

| Data | Type | Owner | Sensitivity | Personal data | Notes |
|---|---|---|---|---|---|
| Six actors and three demo cases (`server/seed.ts`) | Invented | The team | None | No | Names are fictional |
| Demo report text and its stored extraction | Invented | The team | None | No | Written by the team |
| Demo clock and escalation records | Generated at run time | The team | None | No | |
| Labelled test reports | `[PENDING — TICKET-12]` | The team | None | No | Not in the repository yet |
| Synthetic cohort | `[NOT BUILT]` | The team | None | No | |

## Sources used for facts

| Source | Used for |
|---|---|
| Atlas et al., JAMA 2023 | Follow-up completion by arm |
| Kaiser Permanente Northwest, 2021 | Navigation effect, prediction model discrimination |
| PRECISE trial, 2025 | Navigation effect, risk prediction. From summaries, not full text. |
| Abu Dhabi colonoscopy follow-up after positive FIT, 2015 to 2016 data | Baseline of 30.5%. `[FULL CITATION TO BE ADDED]` |
| HAAD standard, cited in BMC Cancer 2021 | Referral to colonoscopy within 31 days |
| DoH Circular 144/2026 | Referral transactions to Malaffi as HL7 REF messages by 31 August 2026. Cited by number and gist only. The document is not reproduced, attached or stored in the repository. |

Exact numbers and caveats are in [`evidence.md`](evidence.md).

## Legal right to use

- Literature: cited, not copied. Numbers are quoted with their source.
- DoH Circular 144/2026: read by the team and cited by number and gist. Not redistributed.
- Software: open-source packages under their own licences. See [`dependencies.md`](dependencies.md).
- Statements that lab results and schedules must also be sent as HL7 messages come from search summaries of a different circular. They are not cited as fact.
