---
name: Nexyra
description: A case engine for positive screening results — every case owned, timed, and evidenced.
colors:
  ground: "#fbfbf9"
  surface-raised: "#ffffff"
  grid: "#dfe6f1"
  hair: "#d6deea"
  rule: "#101418"
  ink: "#101418"
  ink-body: "#2b323a"
  muted: "#576372"
  muted-soft: "#97a1ad"
  accent: "#1246d9"
  accent-deep: "#0e37ad"
  accent-soft: "#edf1fa"
  on-accent: "#ffffff"
  on-accent-muted: "#c6d5ff"
  on-ink-muted: "#cdd8e8"
  alarm: "#b03a2e"
  alarm-ink: "#6d231b"
  alarm-soft: "#f7e9e6"
  disabled-ground: "#f4f6fa"
  disabled-border: "#bcc6d3"
  ok: "#2f6b4f"
typography:
  figure:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "104px"
    fontWeight: 700
    lineHeight: 0.82
    letterSpacing: "-0.04em"
  figure-md:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "82px"
    fontWeight: 700
    lineHeight: 0.82
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline-sm:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "27px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  numeric-lg:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "38px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  numeric:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  brand:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.01em"
  cell-name:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.005em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  body-sm:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0em"
  note:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  filter:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "0em"
  cell-stage:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0em"
  meta:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.08em"
  label:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.14em"
  label-sm:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.1em"
  micro:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "9.5px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.15em"
  micro-sm:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.12em"
  micro-xs:
    fontFamily: "Spline Sans Mono, ui-monospace, monospace"
    fontSize: "8.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.14em"
rounded:
  none: "0"
spacing:
  unit: "36px"
  page: "36px"
  section: "26px"
  tight: "8px"
  loose: "20px"
components:
  button:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 16px"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "9px 16px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
    textColor: "#ffffff"
    padding: "9px 16px"
  filter:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "5px 11px"
  filter-selected:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    padding: "5px 11px"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 10px"
  cell:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    size: "116px"
  cell-late:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    size: "116px"
  cell-due:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    size: "116px"
  nav-link-active:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    padding: "26px 0 24px"
---

# Design System: Nexyra

## Overview

**Creative North Star: "The Case Register"**

The interface behaves like the grid it is drawn on. Nexyra's screens are the programme's accounting surface: a construction grid stays visible in the shell, and every case occupies exactly one cell in it. The grid is not decoration — it is the measurement the work is read against, which is why it is left showing rather than painted over.

Density is the point. Coordination staff scan roughly 140 open cases a day, so the system spends its contrast on the data, not on the frame: hard 1px ink rules instead of shadows, zero radii, and a near-white ground that lets a single saturated plane mean something. When a case misses its deadline, its whole cell turns that plane. Nothing else on the screen is that loud, so the eye finds the exception before it reads a label.

The system refuses three things the category ships by default: status pills (state is the number and the plane), KPI card grids of equal boxes (the figure and the counts have different weights and different rules), and rounded containers with soft shadows. Expression lives in the type scale and the grid, not in container styling.

**Key Characteristics:**
- Visible 36px construction grid, hairline-weight, behind every screen
- One saturated plane (`#1246d9`) reserved for missed deadlines and the single primary action
- Zero border radius, border-only elevation
- Monospace for anything measured; Archivo for anything read
- The deadline number at each cell's floor is the primary data of every list

## Colors

Near-white and ink, with one blue that means "this one is late".

### Primary
- **Signal Blue** (`#1246d9`): The only saturated plane on most screens. Fills a case cell whose deadline has passed, the selected filter button, and the one primary action per view (`Confirm closure`). Deepens to `#0e37ad` on hover. On it, text is white (8.6:1).
- **Signal Blue Soft** (`#edf1fa`): Cells due within 48 hours, completed stages in the strip, hover on cells, and the ground of the disable-free secondary hover. Never a background for text over an image.

### Neutral
- **Paper** (`#fbfbf9`): Page and cell ground. Deliberately not pure white, so `#ffffff` can be reserved for inputs and notice panels that sit above it.
- **Construction Grid** (`#dfe6f1`): The 36px gridlines in the shell. Hairline weight, never used inside a data region.
- **Hair** (`#d6deea`): Row and section divisions inside a section. The lighter of the two rules.
- **Ink Rule** (`#101418`): Cell edges, table headers, form borders, and the filled bar in the programme view. The structural line.
- **Ink** (`#101418`): All primary text, and the fill of the current stage cell.
- **Graphite** (`#576372`): Labels, provenance, secondary text, owners. Passes 4.5:1 on Paper.
- **Oxide** (`#b03a2e`): Alarm counts (unowned, past deadline) and exception wording only. Never a large fill; its soft ground is `#f7e9e6`.

### Named Rules
**The One Plane Rule.** The saturated blue may appear on at most one cell per viewport band and one control per screen. Its rarity is what makes a missed deadline readable at a glance.

**The No-Colour-Only Rule.** Colour never carries a state by itself. Every late cell also prints a negative number and the word `escalated`; every unowned case prints `no owner`.

## Typography

**Display Font:** Archivo (with system-ui, sans-serif)
**Body Font:** Archivo (with system-ui, sans-serif)
**Label/Mono Font:** Spline Sans Mono (with ui-monospace, monospace)

**Character:** One grotesque does all the reading at four weights, so hierarchy comes from size and rule weight rather than from a second family. The mono is not a costume for "technical": it is used only for values a person would compare digit by digit — case refs, deadlines, hours, citation counts, audit ids, and character offsets.

### Hierarchy
- **Display** (700, 104px, line-height 0.82, tracking −0.04em): The single programme figure (`142`). One per screen, never two.
- **Headline** (700, 34px, line-height 1.1, tracking −0.025em): Case identity on a detail sheet. The ref above it sets at 11px mono in Signal Blue.
- **Title** (600, 15px): Section headings inside a sheet. Sentence case, no kicker and no eyebrow above it.
- **Body** (400, 14px, line-height 1.45): Default text. Prose blocks cap at ~68ch (`.note`).
- **Label** (400–500, 9–10.5px, tracking 0.12–0.16em, uppercase): Column heads, field labels, provenance lines, nav items.
- **Numeric** (600, 24px in a cell / 38px in a count, tracking −0.03em): The deadline figure and the summary counts, always `font-variant-numeric: tabular-nums`.

### Named Rules
**The Mono-For-Measurement Rule.** If a value is compared across rows, it is set in Spline Sans Mono with tabular figures. If it is read as a sentence, it is set in Archivo. There is no third case.

**The No-Eyebrow Rule.** A section heading carries itself. No small uppercase kicker sits above a heading anywhere in the product.

## Layout

A 36px base unit, matching the construction grid exactly, so every panel edge lands on a gridline. Page padding is 36px on desktop and 18px below 820px. Sections hold a 26px rhythm with the heading closer to its content than to the section above.

The register is a six-across cell grid above 1180px, four across above 820px, two above 520px, and one below. Column widths are equal because case weight is not meaningfully unequal; the exception is carried by fill, not by size. Cells have a 116px floor and grow with content.

Summary blocks are asymmetric by design: a 288px figure column divided from three counts by a hard rule, with hairline separators between the counts. Detail sheets split at 1fr / 320px and collapse to one column below 820px, where the meta block becomes a ruled strip under the title.

Containers are full-bleed to the page padding with no maximum card width — the list is the page. The `.page` wrapper caps at 1500px to stop the grid stretching a cell past readability on very wide displays.

Breakpoints: 1180px (cell count), 820px (page padding, sheet collapse, nav wrap), 520px (single column).

## Elevation & Depth

**No shadows.** The system is flat, and depth is conveyed by rule weight and fill instead: a 2px ink rule closes the top bar and the summary block, 1px rules divide cells and rows, and `#ffffff` panels (inputs, notices) sit above `#fbfbf9` with no shadow at all. A surface that needs to look above another changes ground or border weight, never blur.

Radii are zero everywhere, including buttons, inputs, selects, and notices. The only rounded thing in the product is the text cursor.

### Named Rules
**The Border-Or-Nothing Rule.** Elevation is a border. A soft shadow added to a card, cell, or panel is a defect, not a variation.

## Shapes

Square. Every interactive and structural element has `border-radius: 0`: buttons, filter chips, inputs, textareas, selects, cells, stage strip segments, bar tracks, notice panels. Borders are 1px, except the 2px structural rules under the top bar and above the cell grid, and the 3px nav active indicator.

The one recurring silhouette is the cell: a square unit with a hard edge, a mono ref at its top-left, the owner at its top-right, and the deadline figure resting on its floor. The stage strip repeats the same square unit seven times at fixed scale so two cases compare without opening either.

## Components

### Buttons
- **Shape:** 1px ink border, zero radius, padding `9px 16px`.
- **Primary:** Signal Blue fill, white text, same padding. Exactly one per view.
- **Hover:** secondary buttons take `#edf1fa`; primary deepens to `#0e37ad`. No transform, no shadow.
- **Focus:** 2px Signal Blue outline with 2px offset on every focusable element.
- **Disabled:** border drops to `#bcc6d3`, text to `#97a1ad`, ground `#f4f6fa`, cursor not-allowed. The control stays legible and in layout; it is never a faded copy of the enabled state.

### Chips / Filters
- **Style:** a plain `<button>` with a 1px ink border, 12px text, zero radius.
- **State:** `aria-pressed="true"` fills with Signal Blue and white text. Hover on the unselected state is `#edf1fa`. Filters are a pressed-state group, not tabs.

### Cards / Containers
The system has no card component, deliberately. Regions are separated by rules and grounds: `.section` (26px padding, hairline bottom), `.notice` (1px ink border, white ground), `.cell` (square case unit). Nesting a bordered box inside a bordered region is a defect.

### Inputs / Fields
- **Style:** 1px ink border, white ground, zero radius, padding `8px 10px`, 13px text.
- **Focus:** the shared 2px Signal Blue outline.
- **Error:** pairs the field with a `.notice.alarm` panel (Oxide border on `#f7e9e6`) naming the problem and the recovery — never a red outline alone. Invalid fields carry `aria-invalid` and `aria-describedby` pointing at that panel.

### Navigation
- **Style:** a 72px bar with the wordmark and a mono label beneath it. Items are 10.5px mono uppercase at `0.14em` tracking, Graphite at rest.
- **Active:** ink text with a 3px Signal Blue bottom border. `end` matching keeps `Cases` inactive on a detail route.
- **Mobile:** the bar wraps; the nav takes its own full-width row with horizontal scroll and 8px vertical padding.

### The Case Cell (signature)
The product's distinctive component. A square link in a bordered grid containing, in fixed positions: owner (mono, 8.5px, top-right), ref (mono, 10px, Signal Blue), patient and age (14.5px, 600), stage (11.5px, Graphite), the deadline figure (24px tabular, with a mono unit beside it), and a state line. Three variants: default on Paper, `due` on Signal Blue Soft, `late` on the full Signal Blue plane with white text. Cells settle in from a 6px translate with an 18ms per-cell stagger; `prefers-reduced-motion` removes it.

### The Stage Strip
Seven fixed-scale segments in one bordered row. Completed segments take Signal Blue Soft, the current segment inverts to ink with white text and carries `aria-current="step"`. Each segment prints its ordinal, a short stage name, and its relation (`done` / `here` / `ahead`) so the state is never colour-only.

### The Brand Mark
Two columns by three rows of square cells on an 8-unit grid, 1.5–2px ink rules, the top-right cell filled with Signal Blue and carrying a white bar. `public/brand/favicon.svg` is the 32px tab version, `public/brand/nexyra-mark.svg` the 128px lockup. The blue cell is the only element that must survive a 16px shrink; everything else may collapse.

## Do's and Don'ts

### Do:
- **Do** put the deadline's distance at the floor of every list row or cell, as a signed number in tabular figures.
- **Do** keep the construction grid visible in the shell at `#dfe6f1` and nowhere inside a data region.
- **Do** print provenance next to every extracted value: source file, character offset, and read time.
- **Do** name the reason in an exception list (`Unowned 26h`, `No accession event 40h`) rather than showing a count alone.
- **Do** disable an action a role cannot take, keep it legible, and state why in a sentence beside it.
- **Do** set every compared value in Spline Sans Mono with `tabular-nums`.
- **Do** honour `prefers-reduced-motion` by removing the cell settle entirely.

### Don't:
- **Don't** introduce status pills, rounded badges, or a second accent colour; state is number plus plane.
- **Don't** add `box-shadow` anywhere — including hover states and "floating" panels.
- **Don't** round a corner. Zero radius applies to buttons, chips, inputs, notices, and cells alike.
- **Don't** use `#ffffff` as a page ground; it is reserved for inputs and notice panels above `#fbfbf9`.
- **Don't** put a kicker or eyebrow above a heading.
- **Don't** nest a bordered container inside another bordered container.
- **Don't** imply automatic closure in copy or layout; the engine proposes, a clinician confirms.
