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
| `/cases/:ref` | `src/pages/CaseDetail.tsx` | TICKET-09 | Stage strip, cited evidence with offsets, append-only audit trail |
| `/cases/:ref/outreach` | `src/pages/Outreach.tsx` | TICKET-10 | Attempt ladder and the log form with its error state |
| `/cases/:ref/closure` | `src/pages/Closure.tsx` | TICKET-15 | Proposal, evidence, confirm/return, role gate |
| `/programme` | `src/pages/Programme.tsx` | TICKET-16 | Stage bars (unowned = signal blue share), exception list with reasons |
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
