# Helpers for building the Nexyra deck through PowerPoint COM.
function RGBc([int]$r, [int]$g, [int]$b) { return $r + 256 * $g + 65536 * $b }

$script:GREY   = RGBc 89 89 89      # template text colour 595959
$script:BROWN  = RGBc 110 90 80     # darker than the template bar (128,107,99) for text contrast
$script:BEIGE  = RGBc 227 221 209   # template header band
$script:BORDER = RGBc 166 166 166
$script:RED    = RGBc 192 0 0
$script:FONT   = 'Arial'
$script:GAP = 2; $script:HGAP = 5
$script:Report = New-Object System.Collections.ArrayList

# Paragraph DSL: 'H|' heading (bold brown), 'S|' sub-heading (bold), 'B|' bullet, 'N|' numbered-style
# plain with hanging indent, 'P|' plain. A leading '**label**' is bolded. Markers [..] turn red.
function Set-Paras($shape, [string[]]$paras, [double]$size) {
  $tf = $shape.TextFrame2
  $kinds = @(); $texts = @(); $bolds = @()
  foreach ($p in $paras) {
    $k = $p.Substring(0, 1); $t = $p.Substring(2)
    $segs = @(); $plain = ''; $rest = $t
    while ($rest -match '\*\*(.+?)\*\*') {
      $idx = $rest.IndexOf($matches[0]); $plain += $rest.Substring(0, $idx)
      $segs += , @($plain.Length, $matches[1].Length); $plain += $matches[1]
      $rest = $rest.Substring($idx + $matches[0].Length)
    }
    $plain += $rest
    $kinds += $k; $texts += $plain; $bolds += , $segs
  }
  $tf.TextRange.Text = ($texts -join "`r")
  $tr = $tf.TextRange
  $tr.Font.Name = $script:FONT
  $tr.Font.Fill.ForeColor.RGB = $script:GREY
  $tr.Font.Bold = 0
  $tr.ParagraphFormat.SpaceWithin = 1.0
  for ($i = 1; $i -le $texts.Count; $i++) {
    $pr = $tr.Paragraphs($i, 1)
    $k = $kinds[$i - 1]
    $pf = $pr.ParagraphFormat
    $pf.Alignment = 1
    $pf.SpaceAfter = 0
    $pf.SpaceBefore = [single]$(if ($i -eq 1) { 0 } elseif ($k -eq 'H' -or $k -eq 'S') { $script:HGAP } else { $script:GAP })
    if ($k -eq 'B') {
      $pf.Bullet.Visible = -1; $pf.Bullet.Character = 8226
      $pf.LeftIndent = 10; $pf.FirstLineIndent = -10
    } else {
      $pf.Bullet.Visible = 0; $pf.LeftIndent = 0; $pf.FirstLineIndent = 0
    }
    if ($k -eq 'H') { $pr.Font.Bold = -1; $pr.Font.Fill.ForeColor.RGB = $script:BROWN }
    if ($k -eq 'S') { $pr.Font.Bold = -1 }
    foreach ($sg in $bolds[$i - 1]) { if ($sg.Count -eq 2) { $pr.Characters($sg[0] + 1, $sg[1]).Font.Bold = -1 } }
  }
  Set-Size $shape $size
  # markers in red
  $full = $tr.Text
  foreach ($m in [regex]::Matches($full, '\[[^\]]*(TEAM|PENDING|CITATION)[^\]]*\]')) {
    $c = $tr.Characters($m.Index + 1, $m.Length)
    $c.Font.Fill.ForeColor.RGB = $script:RED
    $c.Font.Bold = -1
  }
}

function Set-Size($shape, [double]$size) {
  $tr = $shape.TextFrame2.TextRange
  for ($i = 1; $i -le $tr.Paragraphs().Count; $i++) {
    $pr = $tr.Paragraphs($i, 1)
    $pr.Font.Size = $size
  }
}

function Test-Fit($shape) {
  $tf = $shape.TextFrame2
  $avail = $shape.Height - $tf.MarginTop - $tf.MarginBottom
  return @{ need = [math]::Round($tf.TextRange.BoundHeight, 1); avail = [math]::Round($avail, 1); ok = ($tf.TextRange.BoundHeight -le $avail + 0.5) }
}

# Fit: start at $base, step down by 0.5 to $min. Records the result.
function Fit-Text($shape, [string]$label, [double]$base, [double]$min) {
  $s = $base
  while ($true) {
    Set-Size $shape $s
    $f = Test-Fit $shape
    if ($f.ok -or $s -le $min) { break }
    $s -= 0.5
  }
  [void]$script:Report.Add(("{0}: size {1} need {2} / avail {3} {4}" -f $label, $s, $f.need, $f.avail, $(if ($f.ok) { 'OK' } else { 'OVERFLOW' })))
  return $s
}

function Add-Text($slide, [string]$name, [double]$l, [double]$t, [double]$w, [double]$h, [string[]]$paras, [double]$base = 12, [double]$min = 11) {
  $sh = $slide.Shapes.AddTextbox(1, $l, $t, $w, $h)
  $sh.Name = $name
  $tf = $sh.TextFrame2
  $tf.WordWrap = -1
  $tf.AutoSize = 0
  $tf.MarginLeft = 7.2; $tf.MarginRight = 7.2; $tf.MarginTop = 3.6; $tf.MarginBottom = 3.6
  $tf.VerticalAnchor = 1
  Set-Paras $sh $paras $base
  $sh.Top = $t; $sh.Height = $h; $sh.Width = $w; $sh.Left = $l
  $size = Fit-Text $sh ("S{0} {1}" -f $slide.SlideIndex, $name) $base $min
  return $sh
}

function Add-Shot($slide, [string]$jpg, [double]$l, [double]$t, [double]$w, [string]$alt, [string]$name) {
  $h = $w * 800 / 1280
  $pic = $slide.Shapes.AddPicture($jpg, 0, -1, $l, $t, $w, $h)
  $pic.LockAspectRatio = -1
  $pic.Name = $name
  $pic.AlternativeText = $alt
  $pic.Line.Visible = -1
  $pic.Line.ForeColor.RGB = $script:BORDER
  $pic.Line.Weight = 0.75
  [void]$script:Report.Add(("S{0} picture {1}: L{2:N0} T{3:N0} W{4:N0} H{5:N0}" -f $slide.SlideIndex, $name, $pic.Left, $pic.Top, $pic.Width, $pic.Height))
  return $pic
}

# Diagram box: rounded rectangle, one paragraph with a bold inline label.
function Add-Box($slide, [string]$name, [double]$l, [double]$t, [double]$w, [double]$h, [string]$label, [string]$body, [double]$size = 11, [switch]$Dashed) {
  $sh = $slide.Shapes.AddShape(5, $l, $t, $w, $h)
  $sh.Name = $name
  $sh.Adjustments.Item(1) = 0.06
  $sh.Fill.ForeColor.RGB = $script:BEIGE
  $sh.Line.ForeColor.RGB = (RGBc 128 107 99)
  $sh.Line.Weight = 0.75
  if ($Dashed) { $sh.Line.DashStyle = 4 }
  $sh.Shadow.Visible = 0
  $tf = $sh.TextFrame2
  $tf.WordWrap = -1; $tf.AutoSize = 0
  $tf.MarginLeft = 5; $tf.MarginRight = 4; $tf.MarginTop = 3; $tf.MarginBottom = 3
  $tf.VerticalAnchor = 1
  Set-Paras $sh @("P|**$label** $body") $size
  $tr = $tf.TextRange
  $tr.Font.Fill.ForeColor.RGB = (RGBc 64 64 64)
  $tr.Characters(1, $label.Length).Font.Fill.ForeColor.RGB = $script:BROWN
  return $sh
}

function Need-Height($sh) { $tf = $sh.TextFrame2; return $tf.TextRange.BoundHeight + $tf.MarginTop + $tf.MarginBottom + 1 }

function Check-Box($sh, [string]$label) {
  $f = Test-Fit $sh
  [void]$script:Report.Add(("{0} box '{1}': 11pt need {2} / avail {3} {4}" -f $label, $sh.Name, $f.need, $f.avail, $(if ($f.ok) { 'OK' } else { 'OVERFLOW' })))
}
function Add-Arrow($slide, $from, [int]$fromSite, $to, [int]$toSite, [int]$type = 2) {
  $c = $slide.Shapes.AddConnector($type, 0, 0, 10, 10)
  $c.ConnectorFormat.BeginConnect($from, $fromSite)
  $c.ConnectorFormat.EndConnect($to, $toSite)
  $c.Line.ForeColor.RGB = (RGBc 128 107 99)
  $c.Line.Weight = 1.25
  $c.Line.EndArrowheadStyle = 2
  return $c
}
