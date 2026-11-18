param([switch]$NoExport)
$ErrorActionPreference = 'Stop'
# Builds docs/deck/Nexyra-C05-submission.pptx and .pdf from the organisers' mandatory
# template with PowerPoint (COM). Run from anywhere: powershell -File tools\deck\build.ps1
# Work files (template copy, JPEG copies of docs/shots) go to %TEMP%\nexyra-deck.
$REPO = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$SD   = Join-Path $env:TEMP 'nexyra-deck'
$IMG  = "$SD\img"
$OUTD = Join-Path $REPO 'docs\deck'
$PPTX = "$OUTD\Nexyra-C05-submission.pptx"
$PDF  = "$OUTD\Nexyra-C05-submission.pdf"
. "$PSScriptRoot\lib.ps1"
New-Item -ItemType Directory -Force $OUTD, $SD, $IMG | Out-Null

# A fresh copy of the template every run; the original in docs/ is never opened for writing.
Copy-Item -Force -LiteralPath (Join-Path $REPO 'docs\[PUB] Future Health Digital Innovation Challenge _ Submission Template.pptx') -Destination "$SD\template-copy.pptx"

# Screenshots go in as 1280 px wide JPEG copies (quality 82) to keep the PDF small.
Add-Type -AssemblyName System.Drawing
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$quality = New-Object System.Drawing.Imaging.EncoderParameters 1
$quality.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]82)
Get-ChildItem (Join-Path $REPO 'docs\shots') -Filter *.png | ForEach-Object {
  $src = [System.Drawing.Image]::FromFile($_.FullName)
  try {
    $w = [Math]::Min(1280, $src.Width); $h = [int]($src.Height * $w / $src.Width)
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, $w, $h); $g.Dispose()
    $bmp.Save((Join-Path $IMG ($_.BaseName + '.jpg')), $jpegCodec, $quality); $bmp.Dispose()
  } finally { $src.Dispose() }
}

$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open("$SD\template-copy.pptx", $true, $false, $false)
function S($i) { return $pres.Slides.Item($i) }
trap { try { $pres.Close() } catch {}; $pp.Quit(); break }

# Layout constants (points; slide is 720 x 405, footer bar at 399)
$L = 20; $W = 680            # text boxes: left 20 + 7.2 margin = template text edge at ~27
$TOP1 = 88                   # slides whose heading box has one line
$TOP2 = 104                  # slides whose heading box has two lines
$BOT = 395

# ---------------- Slide 1 ----------------
$sh = (S 1).Shapes.Item('Google Shape;56;p13')
Set-Paras $sh @(
  'P|Team Name: Nexyra',
  'P|Team Size: 2',
  'P|Problem Statement:',
  'P|After a positive screening result, nobody is clearly responsible for the next step. In Abu Dhabi clinics, only 30.5% of people with a positive FIT had the follow-up colonoscopy, and 12% were never told their result (2015 to 2016; Almansoori et al., BMC Cancer 2021). Malaffi e-Referral tracks referral documents, not who owns the screening result or what happens when nobody acts. Challenge 05: closing the screening-to-care loop.'
) 18
$sh.TextFrame2.MarginTop = 4
$tr = $sh.TextFrame2.TextRange
$body = $tr.Paragraphs(4, 1)
$best = 11
foreach ($sz in 16, 15, 14, 13.5, 13, 12.5, 12, 11.5, 11) {
  $body.Font.Size = [single]$sz  # COM accepts Single, not Double (13.5 fails)
  if ((Test-Fit $sh).ok) { $best = $sz; break }
}
$body.ParagraphFormat.SpaceBefore = 2
$f = Test-Fit $sh
[void]$Report.Add(("S1 template box 56: labels 18, problem text {0} need {1} / avail {2} {3}" -f $best, $f.need, $f.avail, $(if ($f.ok) {'OK'} else {'OVERFLOW'})))

# ---------------- Slide 2 ----------------
$sh = (S 2).Shapes.Item('Google Shape;63;p14')
$p2 = $sh.TextFrame2.TextRange.Paragraphs(2, 1)
$p2.Text = ''
$tb = (S 2).Shapes.Item('Google Shape;64;p14')
# Rows 2-3 of the template's table (row 1 is its header: S.No, Name, Country, Role,
# Organization, Age confirmation). Role = role in the team, with the job title.
$members = @(
  @('1', 'Alfian Hidayatullah', 'Indonesia', 'Team leader (Data & Tech Executive)', 'WPP Media', 'Confirmed, over 18 (26)'),
  @('2', 'Fajar Aji Pamungkas', 'Indonesia', 'Team member (Business Intelligence & Data Engineer)', 'Combiphar', 'Confirmed, over 18 (27)')
)
for ($r = 0; $r -lt $members.Count; $r++) {
  for ($c = 0; $c -lt 6; $c++) { $tb.Table.Cell($r + 2, $c + 1).Shape.TextFrame.TextRange.Text = $members[$r][$c] }
}
# Two members: the template's empty rows 3-5 go (bottom up, so indexes stay valid).
for ($r = $tb.Table.Rows.Count; $r -gt $members.Count + 1; $r--) { $tb.Table.Rows.Item($r).Delete() }
# PowerPoint reports the table's height before wrapped rows re-flow, so the note sits at a
# fixed line near the bottom of the slide instead of under a stale height.
[void](Add-Text (S 2) 'Answer note' $L ($BOT - 26) $W 24 @(
  'P|No clinician is on the team, and the clinical logic has not yet been reviewed by a clinician (see slide 9).'
) 12 11)

# ---------------- Slide 3 ----------------
[void](Add-Text (S 3) 'Answer' $L $TOP2 $W ($BOT - $TOP2) @(
  'P|**Alfian Hidayatullah (team leader)**, Data & Tech Executive at WPP Media: data platforms, analytics engineering and product delivery. Built the first prototype: the interface, the API contract and the first case engine.',
  'P|**Fajar Aji Pamungkas**, Business Intelligence & Data Engineer at Combiphar, a pharmaceutical company: data pipelines, data modelling and reporting in a healthcare setting. Extended the engine, ownership and outreach, report verification, deployment and documentation.',
  'P|Together we built the whole prototype during the challenge: case engine, HL7 v2 and FHIR ingest, report extraction with checked quotes, programme view, 317 automated tests, hosting on Vercel and Turso.',
  'P|No clinician is on the team. The clinical logic follows published standards and studies (slide 7) and has not yet been reviewed by a clinician; we say so wherever it matters.'
) 12 11)

# ---------------- Slide 4 (diagram) ----------------
$s4 = S 4
[void](Add-Text $s4 'Answer heading' $L ($TOP1 - 1) $W 21 @('H|One case engine above Malaffi data. Pathways are configuration. AI proposes; a physician closes.') 12 11)
$y0 = 108; $y1 = 300; $gx = 10; $gy = 5; $H = $y1 - $y0
$c1w = 116; $c2w = 116; $c4w = 146
$c3w = 673 - $c1w - $c2w - $c4w - 3 * $gx
$c1x = 27; $c2x = $c1x + $c1w + $gx; $c3x = $c2x + $c2w + $gx; $c4x = $c3x + $c3w + $gx
$b1 = Add-Box $s4 'D1 Inputs' $c1x $y0 $c1w $H '1. Inputs:' 'positive FIT result (HL7 v2 ORU or FHIR), referral messages (HL7 v2 REF), FHIR Appointment, Procedure and DiagnosticReport. Anything that does not match a case goes to an unstitched queue and is never dropped.'
$b2 = Add-Box $s4 'D2 Case engine' $c2x $y0 $c2w $H '2. Case engine:' 'Express, one Vercel function; Turso/libSQL. Pathway file (FIT built, mammography as configuration), one owner per stage, deadline per stage, escalation by role, unowned triggers, append-only audit trail.'
$b3 = Add-Box $s4 'D3 Outreach' $c3x $y0 $c3w 40 '3. Outreach ladder:' 'automated message (English or Arabic) → staff call → navigator. Patient page, no login.'
$b4 = Add-Box $s4 'D4 Consultation' $c3x $y0 $c3w 40 '4. Consultation monitoring:' 'on top of e-Referral: owner, deadline and escalation for a question between providers. Not a messaging channel.'
$b5 = Add-Box $s4 'D5 Extraction' $c3x $y0 $c3w 40 '5. Report extraction:' 'a model returns six fields with a quote each; code checks every quote is in the report; plain rules turn the fields into a proposal (reopen, wait for pathology, needs human reading, propose closure).'
$b7 = Add-Box $s4 'D7 Programme view' $c4x $y0 $c4w 40 '7. Programme view:' 'exceptions, funnel, 31-day referral-to-colonoscopy limit, delay reasons, escalations per role per day, scenario panel (labelled assumption).' -Dashed
$b6 = Add-Box $s4 'D6 Closure' $c4x $y0 $c4w 40 '6. Closure:' "valid outcome, attached evidence and the responsible physician's confirmation. The system role and AI can never close a case."
function Stack-Boxes($boxes) {
  $need = @(); foreach ($b in $boxes) { $need += (Need-Height $b) }
  $sum = 0; foreach ($n in $need) { $sum += $n }
  $extra = ($H - $sum - $gy * ($boxes.Count - 1)) / $boxes.Count
  [void]$Report.Add(("S4 column stack: need {0:N1} of {1}, extra per box {2:N1}" -f ($sum + $gy * ($boxes.Count - 1)), $H, $extra))
  $y = $y0
  for ($k = 0; $k -lt $boxes.Count; $k++) { $boxes[$k].Top = [single]$y; $boxes[$k].Height = [single]($need[$k] + $extra); $y += $boxes[$k].Height + $gy }
}
Stack-Boxes @($b3, $b4, $b5)
Stack-Boxes @($b7, $b6)
foreach ($b in $b1, $b2, $b3, $b4, $b5, $b6, $b7) { Check-Box $b 'S4' }
[void](Add-Arrow $s4 $b1 4 $b2 2 1)
[void](Add-Arrow $s4 $b2 4 $b3 2 2)
[void](Add-Arrow $s4 $b2 4 $b4 2 2)
[void](Add-Arrow $s4 $b2 4 $b5 2 2)
[void](Add-Arrow $s4 $b5 4 $b6 2 2)
$tw4 = 456
[void](Add-Text $s4 'Answer built and hosted' $L ($y1 + 2) $tw4 ($BOT - $y1 - 1) @(
  'P|**Built:** everything above, on synthetic data. **Designed, not built:** probabilistic identity matching, Malaffi connection, SMS gateway, login.',
  'P|**Hosted:** https://nexyra-health.vercel.app (Vercel; API and Turso database in Mumbai; daily reset). Stack: React and Vite, Express, Turso, any OpenAI-compatible model endpoint (DeepSeek default; Meta Muse Spark via the Meta Model API possible). 317 automated tests in 26 files.'
) 11 11)
$sw4 = (700 - ($L + $tw4) - 6 - 6) / 2
$sy4 = $y1 + 8
[void](Add-Shot $s4 "$IMG\case2-2-case-unowned.jpg" (700 - 2 * $sw4 - 6) $sy4 $sw4 'Screenshot: Nexyra case CX-1002 with no owner. The receiving provider rejected the referral; the case shows Unowned 20h with an assign-owner task and its deadline.' 'Shot unowned case')
[void](Add-Shot $s4 "$IMG\case3-8-closed.jpg" (700 - $sw4) $sy4 $sw4 'Screenshot: case closure confirmed by the responsible physician, with the quoted report fields (tissue taken, pathology, outcome, next step) and the decision recorded in the audit trail.' 'Shot closure confirmed')

# ---------------- Slide 5 ----------------
$s5 = S 5
$tw = 466; $iw = 210; $ix = 700 - $iw
[void](Add-Text $s5 'Answer' $L $TOP1 $tw ($BOT - $TOP1) @(
  'H|For the people who own a positive result, and the programme that must see where cases stall.',
  'S|Users',
  'B|**Coordination staff:** work the cases they own, with deadlines, outreach tasks and the unowned queue.',
  'B|**Navigator:** gets the patients who did not respond to the message or the staff call.',
  'B|**Responsible physician:** reads the latest report and its quotes, then confirms closure, reopens the case, or rejects the AI proposal with a reason. Dr. Fulana (receiving physician) and Nur H. (navigator) act through their own forms on the case page.',
  'B|**Program manager:** sees exceptions, the funnel, the 31-day limit and alert load per role.',
  'B|**Patient:** receives the result in English or Arabic and one next step.',
  'S|Intended outcome (a design aim, not a result)',
  'P|Every positive result has one named owner, a deadline and a record; a case with no owner is visible; a case is closed only on evidence and a physician''s decision. Health impact and clinical relevance would be shown in a pilot by follow-up completion and time to colonoscopy. We do not claim that Nexyra improves patient outcomes.',
  'P|**Challenge fit:** closes the loop between a screening result and care without a risk model.'
) 11 11)
[void](Add-Shot $s5 "$IMG\case1-1-ladder.jpg" $ix ($TOP1 + 4) $iw 'Screenshot: outreach ladder for a silent patient: automated message, then a staff call task, then the navigator.' 'Shot outreach ladder')
[void](Add-Shot $s5 "$IMG\patient-ar.jpg" $ix ($TOP1 + 4 + $iw * 0.625 + 8) $iw 'Screenshot: patient page in Arabic (right to left) explaining the positive FIT result, the next step (colonoscopy), when to act and whom to contact. Language tabs show English, Arabic and draft Urdu, Hindi and Tagalog.' 'Shot patient page Arabic')

# ---------------- Slide 6 ----------------
$s6 = S 6
[void](Add-Text $s6 'Answer' $L $TOP1 $tw ($BOT - $TOP1) @(
  'H|Two kinds of measure: the mechanism now, programme outcomes in a pilot.',
  'S|Measured now, on synthetic data',
  'B|**Closure verification, measured 18 Nov (Muse Spark 1.3, 24 labelled synthetic reports, prompt not tuned on them):** 0 of 14 must-not-close reports proposed for closure; 4 of 10 closable reports proposed, 6 held for human reading (mostly bowel prep given only as a score). Field agreement 15 to 24 of 24; 1 citation rejected.',
  'B|**Behaviour of the engine:** 321 automated tests, including the whole demo replayed through the API.',
  'S|Proposed for a pilot, to be agreed with the programme and clinicians',
  'B|Share of positive results with a named owner within a set time.',
  'B|Share of cases with a colonoscopy within 31 days of referral (HAAD standard: within 31 days for over 90% of people).',
  'B|Time unowned cases wait for a new owner.',
  'B|Colonoscopy follow-up after a positive FIT, against the 30.5% baseline (2015 to 2016).',
  'B|Alerts per role per day, so alert fatigue is seen early.',
  'B|Share of AI proposals the physician rejects. The prototype already counts this (ai_divergence: rejections plus closures confirmed against the last reading), on synthetic data.',
  'P|Drop-off rates in the synthetic cohort are inputs, not findings.'
) 12 11)
[void](Add-Shot $s6 "$IMG\programme-2-delays.jpg" $ix ($TOP1 + 4) $iw 'Screenshot: programme view with referral-to-colonoscopy time bands against the 31-day limit, delay reasons counted once per barrier, and physician decisions against the AI reading.' 'Shot programme delays')

# ---------------- Slide 7 ----------------
[void](Add-Text (S 7) 'Answer' $L $TOP2 $W ($BOT - $TOP2) @(
  'H|Outreach drove follow-up in the trials; risk prediction did not change the navigation effect.',
  'B|**Atlas et al., JAMA 2023:** follow-up completed in 22.9% with usual care, 22.7% with an EHR reminder, 31.0% with reminder plus letter and phone outreach, 31.4% with outreach plus a navigator. Outreach drove the effect, not navigation. One trial, one health system.',
  'B|**Kaiser Permanente Northwest, 2021:** navigation 76% against 65% usual care. The prediction model had a C-statistic of 0.65. No evidence that effects differed by risk group.',
  'B|**PRECISE, 2025** (from summaries, not full text): 55.1% with navigation against 42.1% without. Risk prediction did not change the navigation effect.',
  'B|**Abu Dhabi, Almansoori, Alzaabi, Alketbi, BMC Cancer 2021;21:897 (doi:10.1186/s12885-021-08623-9):** in ambulatory clinics in 2015 to 2016, 30.5% (436) of people with a positive FIT/gFOBT had the follow-up colonoscopy; 12% were never told their result. The HAAD standard the paper cites: colonoscopy within 31 days of referral for over 90% of people.',
  'B|**DoH Circular 144/2026:** all referral transactions go to Malaffi as HL7 REF messages by 31 August 2026; e-Referral is for referral management, status tracking and referrer-receiver communication.',
  'B|**What follows for the design:** an outreach ladder that starts early, escalation to people, no risk model. We do not claim that risk-targeted navigation works.',
  'B|**Prior testing:** 321 automated tests. Report reading on 24 labelled synthetic reports with a live model (Muse Spark 1.3): 0 of 14 unsafe closures proposed; 4 of 10 safe closures proposed, the rest sent to a human.'
) 12 11)

# ---------------- Slide 8 (table) ----------------
$s8 = S 8
[void](Add-Text $s8 'Answer heading' $L $TOP2 $W 22 @('H|Synthetic data only. No personal data.') 12 11)
$rows = @(
  @('Source', 'Type', 'Owner', 'Sensitivity', 'Permissions', 'Personal data'),
  @('Six demo cases and actors', 'Invented', 'The team', 'None', 'Own work', 'No'),
  @('1,000-case synthetic cohort (seeded generator)', 'Generated', 'The team', 'None', 'Own work', 'No'),
  @('24 labelled test reports', 'Invented, written with AI help', 'The team', 'None', 'Own work', 'No'),
  @('HL7 v2 and FHIR example messages', 'Invented', 'The team', 'None', 'Own work', 'No'),
  @('Patient message templates (English, Arabic)', 'Written by the team', 'The team', 'None', 'Own work', 'No'),
  @('Literature (Atlas, Kaiser NW, PRECISE, BMC Cancer)', 'Published', 'Authors', 'Public', 'Cited, not copied', 'No'),
  @('DoH Circular 144/2026', 'Official circular', 'DoH', 'Public', 'Cited by number and gist, not reproduced', 'No')
)
$colW = @(190, 128, 64, 76, 131, 84)
$tshape = $s8.Shapes.AddTable($rows.Count, 6, 27, ($TOP2 + 24), 673, 120)
$tshape.Name = 'Answer table'
$tbl = $tshape.Table
$tblStyle = (S 2).Shapes.Item('Google Shape;64;p14').Table.Style.Id
$tbl.ApplyStyle($tblStyle, $false)
for ($c = 1; $c -le 6; $c++) { $tbl.Columns.Item($c).Width = $colW[$c - 1] }
for ($r = 1; $r -le $rows.Count; $r++) {
  for ($c = 1; $c -le 6; $c++) {
    $cell = $tbl.Cell($r, $c)
    $cs = $cell.Shape
    $ctr = $cs.TextFrame2.TextRange
    $ctr.Text = $rows[$r - 1][$c - 1]
    $ctr.Font.Name = 'Arial'; $ctr.Font.Size = 11; $ctr.Font.Fill.ForeColor.RGB = (RGBc 0 0 0)
    $ctr.Font.Bold = $(if ($r -eq 1) { -1 } else { 0 })
    $cs.TextFrame2.MarginTop = 2; $cs.TextFrame2.MarginBottom = 2; $cs.TextFrame2.MarginLeft = 4; $cs.TextFrame2.MarginRight = 4
    if ($r -eq 1) { $cell.Shape.Fill.ForeColor.RGB = $BEIGE; $cell.Shape.Fill.Visible = -1 }
  }
  $tbl.Rows.Item($r).Height = 8
}
$tbBottom = $tshape.Top + $tshape.Height
[void]$Report.Add(("S8 table: top {0:N0} height {1:N0} bottom {2:N0}" -f $tshape.Top, $tshape.Height, $tbBottom))
[void](Add-Text $s8 'Answer note' $L ($tbBottom + 4) $W ($BOT - $tbBottom - 4) @(
  'P|Only synthetic data is ever sent to a model, because a provider''s free-credit terms may allow content to be used for product improvement. Nothing from any team member''s or reviewer''s workplace was used.'
) 12 11)

# ---------------- Slide 9 ----------------
$s9 = S 9
$iw9 = 140; $ix9 = 700 - $iw9
$script:GAP = 1.5
[void](Add-Text $s9 'Answer' $L $TOP2 $W ($BOT - $TOP2) @(
  'H|Responsible AI: AI reads and proposes, a physician decides, and every claim is checkable.',
  'B|**Human oversight:** AI never closes a case (blocked in code and tests). Only the responsible physician closes one, with a valid outcome and attached evidence. AI proposals are labelled as such; the physician can reopen or reject one with a reason, and the programme view counts physician-AI divergence.',
  'B|**Explainability:** every extracted answer carries a quote, which code checks is in the report (if not, the field becomes unknown). Rules in code, not the model, make the proposal. Cancer never yields a closure proposal.',
  'B|**Failure modes:** a doubt ends as "needs human reading"; a case staying open is the safe direction of error. No model key, no model call. A model can quote correctly yet choose the wrong value, so the physician reads the quote.',
  'B|**Bias:** no risk score; no patient features beyond age and language in invented cases. Real-data bias, including Arabic reports, is untested.',
  'B|**Privacy and security:** no personal data. No login, security review or privacy assessment yet; a pilot needs them first.',
  'B|**Misuse:** a user can confirm closure wrongly; the audit trail records who did. Consultation answers are enforced to the addressed physician (server 403 otherwise). Roles are self-declared: no login.',
  'B|**Demo readings:** the two readings stored for case 3 (offline demo) are not live model output; the second is hand-written. Live calls are measured in the evaluation.',
  'B|**Patient wording:** Arabic not reviewed by a native speaker; Urdu, Hindi and Tagalog are empty drafts; no clinician has reviewed English or Arabic.',
  'B|**Evaluation, live model:** 0 of 14 unsafe closures proposed; errors fall on the safe side (6 of 10 closable reports sent to a human). Synthetic reports, small set. **Not yet done:** no clinician has reviewed the pathway, deadlines, closure rules or test labels; this comes before any pilot.'
) 11 11)
$script:GAP = 2
# slide 9 screenshots (case3-2-closure-reopen, case3-3-reopened) left out: the full text needs the whole width at 11 pt
# slide 9 screenshots (case3-2-closure-reopen, case3-3-reopened) left out: the full text needs the whole width at 11 pt
# ---------------- Slide 10 ----------------
[void](Add-Text (S 10) 'Answer' $L $TOP2 $W 80 @(
  'H|Not applicable. Software only.',
  'P|Nexyra uses no wearable, sensor, connected device or other hardware. It runs in a web browser and as a server function.'
) 12 11)

# ---------------- Slide 11 ----------------
$s11 = S 11
$iw11 = 250; $ix11 = 700 - $iw11
[void](Add-Text $s11 'Answer' $L $TOP2 ($ix11 - $L - 6) ($BOT - $TOP2) @(
  'H|No login needed. Open the link and pick a role.',
  'B|**Prototype link:** https://nexyra-health.vercel.app (public)',
  'B|**Demo video (under 3 minutes):** [PENDING — TICKET-21]',
  'B|The app has no login. A role picker with three seats (coordinator, physician, program manager) gives guest access to every feature; the receiving physician and the navigator act through their own forms on the case page. All data is synthetic.',
  'B|The hosted demo resets itself every day, so a reviewer always starts at day 0. The demo clock is moved from the screen header.',
  'B|**Suggested first minute:** pick Physician, open case CX-1003, Closure review; then pick Program manager, open Programme.'
) 12 11)
[void](Add-Shot $s11 "$IMG\case3-1-register.jpg" $ix11 ($TOP2 + 2) $iw11 'Screenshot: the case register as the physician sees it, with the role picker in the header.' 'Shot register')

# ---------------- Slide 12 ----------------
$s12 = S 12
[void](Add-Text $s12 'Answer' $L $TOP2 ($ix - $L - 6) ($BOT - $TOP2) @(
  'H|From a synthetic demonstration to a supervised pilot on one screening pathway.',
  'B|**Stakeholders:** DoH Abu Dhabi, Malaffi, a screening programme with a named clinical owner, endoscopy and pathology units. None engaged yet.',
  'B|**Integration:** Nexyra reads the referral and result messages DoH Circular 144/2026 already requires (HL7 v2 REF and ORU, FHIR stitching built); the field map must be checked against the Malaffi specification, not yet seen.',
  'B|**Scale:** a pathway is a JSON file; mammography runs on the same engine unchanged (demonstration, not clinically reviewed). Programme view over 1,000 cases in about 0.2 s.',
  'B|**Needs:** DoH pilot approval, security and data-protection review, an AI policy for clinical data, real login, native-speaker and clinical review of patient text, an SMS gateway.',
  'B|**Timeline (proposal):** month 1, clinical and DoH review, Malaffi data access; months 2 to 4, read-only pilot at one FIT site; months 5 to 7, owners, escalation and outreach live with staff, against the pre-pilot baseline; then more pathways and sites.',
  'B|**Sustainability (proposal):** a per-site subscription paid by the screening programme owner, on UAE-hosted infrastructure. Pricing follows the pilot evidence (cases closed within 31 days, staff time); none claimed yet.'
) 12 11)
[void](Add-Shot $s12 "$IMG\programme-1-top.jpg" $ix ($TOP2 + 2) $iw 'Screenshot: programme view over the synthetic cohort: closed this week, open, unowned and due-today counts, and the exceptions list (unowned cases, cases past the 31-day referral limit), labelled as synthetic data.' 'Shot programme top')

# ---------------- Slide 13 ----------------
[void](Add-Text (S 13) 'Answer' $L $TOP2 $W ($BOT - $TOP2) @(
  'H|All code written during the challenge. Open-source packages under their own licences.',
  'B|**Ownership of the code and documents:** owned by the two team members, Alfian Hidayatullah and Fajar Aji Pamungkas. The source is visible on GitHub (github.com/alfianhid/nexyra) for evaluation; no open-source licence is granted for it yet.',
  'B|**Open-source components:** React 18, Vite 5, React Router 6, Express 4, @libsql/client, hl7v2 (BSD-3-Clause), Vitest 2, TypeScript, tsx. The full list with licences is docs/third-party-licences.md in the repository.',
  'B|**Services:** Vercel (hosting), Turso (database), an OpenAI-compatible model provider (DeepSeek default; Meta Muse Spark via the Meta Model API possible). Provider terms apply; only synthetic data is sent.',
  'B|Literature and the DoH circular are cited, not reproduced.',
  'B|**Restrictions:** no real patient data may be loaded; the demo wording is not clinically reviewed and is not for patient care.',
  'B|No pre-existing proprietary IP is used: everything was written during the challenge.'
) 12 11)

# ---------------- Slide 14 ----------------
[void](Add-Text (S 14) 'Answer' $L $TOP2 $W ($BOT - $TOP2) @(
  'H|None. No member has any of these relationships.',
  'P|Both team members, Alfian Hidayatullah and Fajar Aji Pamungkas, answered no to each question below.',
  'S|The five questions',
  'B|Employed or contracted by the Department of Health Abu Dhabi?',
  'B|Employed or contracted by Future Health or a challenge collaborator (Microsoft, Inception42, MBZUAI, Hack2skill)?',
  'B|A family member or close personal relationship with a judge, organizer or collaborator staff?',
  'B|A financial interest in the organization running or judging the challenge?',
  'B|Access to non-public information about the challenge or its judging?'
) 12 11)

# ---------------- Slide 15 ----------------
$s15 = S 15
$sw15 = 160; $script:GAP = 1; $script:HGAP = 3; $sh15 = $sw15 * 0.625; $sy15 = $BOT - $sh15 - 1
[void](Add-Text $s15 'Answer' $L 56 $W ($sy15 - 56 - 4) @(
  'H|What works today, what is a demonstration, and what is not done.',
  'S|Working solution and demo (all synthetic)',
  'B|**Case 3:** a case marked done is reopened because the AI reading quotes "Preparation was inadequate." and "The cecum was not reached." After the repeat colonoscopy and pathology, the closure review reads the latest report (both reports together) and the physician confirms closure. Both readings are stored demo readings, not model output.',
  'B|**Case 2:** a referral is rejected, the case is unowned, the patient moves, a consultation is answered, and an incoming booking is stitched to the case.',
  'B|**Case 1:** a silent patient. Message, staff call task, then navigator; the patient page in Arabic.',
  'B|Programme view over 1,000 synthetic cases: exceptions, funnel, 31-day limit, delay reasons, physician-AI divergence.',
  'B|Hosted at https://nexyra-health.vercel.app, resets itself every day.',
  'P|**Demonstration only:** mammography pathway, not clinically reviewed.',
  'P|**Assumptions:** deadlines other than the 31-day limit are team assumptions; drop-off rates are inputs, not findings; the scenario panel applies one trial''s effect size and is labelled an assumption.',
  'P|**Measured:** live-model report reading, 0 of 14 unsafe closures proposed, 4 of 10 safe ones (docs/evaluation-results.md). **Not done:** clinical review, Malaffi connection, real messaging, login, security review.',
  'P|Nexyra is not a referral tracker and not a messaging channel, and it builds no risk model.'
) 12 11)
$script:GAP = 2; $script:HGAP = 5
$sx = 700 - 3 * $sw15 - 12
[void](Add-Shot $s15 "$IMG\case3-3-reopened.jpg" $sx $sy15 $sw15 'Screenshot: case 3 reopened by the physician after the AI reading quoted the inadequate preparation and the unreached cecum.' 'Shot case 3 reopened')
[void](Add-Shot $s15 "$IMG\case1-1-ladder.jpg" ($sx + $sw15 + 6) $sy15 $sw15 'Screenshot: case 1 outreach ladder for a silent patient: message, staff call task, then navigator.' 'Shot case 1 ladder')
[void](Add-Shot $s15 "$IMG\case2-4-consultation.jpg" ($sx + 2 * ($sw15 + 6)) $sy15 $sw15 'Screenshot: case 2 consultation answered by Dr. Fulana at Hospital B through her own form; the unowned case gets a new owner.' 'Shot case 2 consultation')

# ---------------- Save ----------------
# The deck lives in a public repository: strip the Office user's name (author, last
# modified by, comment authors) that PowerPoint writes on save.
$pres.RemovePersonalInformation = $true
$pres.SaveAs($PPTX)
if (-not $NoExport) {
  $pres.SaveAs($PDF, 32)
  New-Item -ItemType Directory -Force "$SD\render" | Out-Null
  foreach ($s in $pres.Slides) { $s.Export(("$SD\render\s{0:D2}.png" -f $s.SlideIndex), 'PNG', 1600, 900) }
}
$pres.Close()
$pp.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($pp) | Out-Null
$Report
if (Test-Path $PDF) { "PDF size: {0:N0} bytes" -f (Get-Item $PDF).Length }
