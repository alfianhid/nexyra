# Brand assets

Generated 17 Nov 2026 for the Nexyra prototype. The visual world is the one recorded in
[`DESIGN.md`](../DESIGN.md): a gridded type specimen — visible construction grid, hard 1px rules,
zero radius, one saturated plane (`#1246d9`) reserved for a missed deadline.

## Files

| File | Size | Use | Origin |
|---|---|---|---|
| `public/brand/favicon.svg` | 32×32, vector | browser tab, top-bar mark | hand-authored SVG |
| `public/brand/nexyra-mark.svg` | 128×128, vector | wordmark lockup, docs, slides | hand-authored SVG |
| `public/brand/nexyra-og-1200x630.png` | 1200×630 | Open Graph / link preview | derived from `nexyra-og.png` with ffmpeg (scale + centre crop) |
| `public/brand/nexyra-og.png` | 1536×864 | source plate for the OG crop | generated, prompt in `nexyra-og.png.json` |
| `public/brand/nexyra-deck-cover.png` | 1536×864 | solution deck cover (TICKET-26) | generated, prompt in `nexyra-deck-cover.png.json` |
| `public/brand/nexyra-icon.png` | 1024×1024 | app icon / launcher | generated, prompt in `nexyra-icon.png.json` |
| `public/brand/nexyra-icon-crop.png` | 793×793 | apple-touch-icon | derived from `nexyra-icon.png` (centre crop) |

Every raster ships beside a `.json` sidecar holding the exact generation prompt, so the asset can be
re-made or audited later.

## The mark

Three rows of two square cells forming a 3×2 register, hard 1.5–2px ink rules, one cell filled with
signal blue and carrying a white bar — the case cell from the product, reduced to a mark. It is drawn
on an 8-unit grid so it stays legible at 16px: the blue cell is the only element that survives shrinking,
which is the intended read ("one case in the plane").

## Caveats

- **The wordmark in the generated plates is painted, not set.** `nexyra-og.png` and
  `nexyra-deck-cover.png` render "Nexyra" as raster type inside the image. They are correct at their
  delivered size; they are not reusable at other sizes. For anything else, set the wordmark live in
  Archivo 700 at `-0.01em` against `public/brand/nexyra-mark.svg`.
- **Hero/secondary art is not generated.** The product screens carry no raster imagery by design; the
  register is the visual. If the deck needs section art later, generate it against this palette rather
  than sourcing photography.
- **No claim in these plates is invented.** "Challenge 05 — Closing the Screening-to-Care Loop" and
  "A case engine for positive screening results" come from the brief and `PRODUCT.md`. No statistics,
  hospital logos, or evaluation numbers appear in any asset.
