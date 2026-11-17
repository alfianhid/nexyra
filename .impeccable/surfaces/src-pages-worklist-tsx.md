---
version: 1
slug: "src-pages-worklist-tsx"
primary_target: "src/pages/Worklist.tsx"
related_targets: ["src/pages/CaseDetail.tsx","src/pages/Outreach.tsx","src/pages/Closure.tsx","src/pages/Programme.tsx"]
---

# Surface: Nexyra case engine (web app)

Mode: **Operate** — a coordinator completes a task, not a visitor being persuaded.
Targets: `/cases`, `/cases/:id`, `/cases/:id/outreach`, `/cases/:id/closure`, `/programme`.

Audience: coordination staff working ~140 open FIT cases; responsible physician reviewing closure; program manager watching throughput. Job: know who owns a case and what is due, then act. Frequency: all day, scanning a long list in ordinary indoor light.

Constraints: synthetic data only, labelled as such. English. Closure is never automatic — the machine proposes, a clinician decides. Timers, unowned cases, and citation provenance are the product's differentiators and must be findable within seconds.

## Direction contract

THESIS: The programme is a visible grid. One case occupies one cell, and the number in that cell is its distance to deadline — the accounting sheet a ward already keeps, refusing the KPI-card dashboard that this category ships.

OWN-WORLD: Near-white ground #FBFBF9 with the 36px construction grid left visible in the shell, hard 1px rules #101418, hairline cell divisions #DDE5F2, one saturated plane #1246D9 spent only on a case past its deadline or the single primary action, oxide #B03A2E for the alarm text, Archivo at 700 for the monumental programme figure and 400–600 for UI, Spline Sans Mono for refs, dates, offsets and citations. Zero radius, borders for elevation, no shadows.

STORY: The coordinator sees 142 open cases, 14 unowned and 2 past deadline before reading any label, drills into a cell, reads the stage strip and cited evidence, then hands closure to a clinician who confirms it. The programme manager sees the same grid aggregated.

FIRST VIEWPORT: 72px top bar with the product name, four nav items, the demo clock right-aligned. Below, a 288px figure block (open cases at 104px) divided by a hard rule from three counts with their own hairline separators. Then the filter row (standard buttons, one selected in the accent plane) and a six-across cell grid that runs to the fold, each cell 112px tall: ref, name, stage, owner, deadline number. The escalated cell is the only filled plane on the screen.

FORM: Challenger `crouwel-grid-specimen` (Wim Crouwel gridded type specimens), taken through the Operate limit — the world lends type, palette, density and one signature move; navigation and controls stay standard web. seed: cba22476b3fd99b1

REFERENCE: the direction round's comps are at `.impeccable/mocks/decision/*.png` (assigned, model-pick, challenger-emission-line, challenger-crouwel — all 1440×912, prompts in the matching `.json` sidecars). The built screen is the code-led realisation of `challenger-crouwel.png`; that comp is the critique reference for the finish review, not an approved build contract.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
