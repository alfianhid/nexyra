# Direction comps

Four north-star comps for the case-engine screens, generated 17 Nov 2026 at 1440×912 from the
decision round recorded in [`.impeccable/decision-payload.json`](../.impeccable/decision-payload.json).
Each carries its exact prompt embedded in the file and in a `.json` sidecar.

| Card | Comp | What it shows |
|---|---|---|
| **THE ROLL** — The Case Register | `assigned.png` | Navy index rail; one ruled ledger entry per case; state as a stamped word at the far edge, overstamped in red when a deadline is missed. |
| **IMPECCABLE'S PICK** — Flight Strip Rack | `model-pick.png` | Day ruler; four bays (Unowned 14, In flight 38, Waiting on lab 27, Closure review 5); paper strips per case; the overdue strip hatched and pinned. |
| **Challenger** — Emission Line Rail | `challenger-emission-line.png` | Four stage lanes over a five-day axis; each case a hairline running to its deadline; state by line weight and dash, not hue; selected line on a sodium plate. |
| **Challenger** — Cell Grid Specimen | `challenger-crouwel.png` | Monumental 142; three counts; six-across cell grid; deadline distance as the number on each cell floor; one filled plane for the late case. |

The chosen world was the last of these, and the built app is its code-led realisation — so
`challenger-crouwel.png` doubles as the finish review's critique reference.

## How to read them

Comps are direction tests, not screenshot specifications. Core UI text, responsive behaviour,
interaction states and accessibility stay implementation responsibilities — the running app in
`src/` is the contract, and these images show the ambition it was built against.

What is *not* to be taken literally:

- Invented content. The comps fill unused rows with plausible cases (`CX-0473`, `CX-0419`, …) that do
  not exist in `src/data.ts`. Only the twelve real synthetic cases are the demo set.
- Painted type. The wordmark and all labels are raster inside these images. Set type live from
  Archivo / Spline Sans Mono; never crop a label out of a comp.
- Iconography in the emission-line comp (lane glyphs) — the built UI uses text labels, and the craft
  floor bans glyphs standing in for an icon system.

## Provenance

`impeccable embed-prompt --scan .impeccable/mocks/decision` reports **4 rasters, 0 missing** — every
comp carries the prompt it was made from.
