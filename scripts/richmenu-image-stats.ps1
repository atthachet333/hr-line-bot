<#
  Sample an image's pixels and emit JSON stats (no LINE API). Used by
  richmenu:image-check and richmenu:update to detect blank/placeholder images.

  Output (one JSON line):
    { width, height, pixelFormat, sampled, whitePct, blackPct, avgLuminance }
#>
param([Parameter(Mandatory = $true)][string]$Source)

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
try {
  $bmp = New-Object System.Drawing.Bitmap $img
  try {
    $stepX = [Math]::Max(1, [int]($bmp.Width / 80))
    $stepY = [Math]::Max(1, [int]($bmp.Height / 60))
    $white = 0; $black = 0; $lum = 0.0; $n = 0
    for ($y = 0; $y -lt $bmp.Height; $y += $stepY) {
      for ($x = 0; $x -lt $bmp.Width; $x += $stepX) {
        $p = $bmp.GetPixel($x, $y)
        $l = 0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B
        $lum += $l
        if ($p.R -ge 250 -and $p.G -ge 250 -and $p.B -ge 250) { $white++ }
        if ($l -lt 12) { $black++ }
        $n++
      }
    }
    $out = @{
      width        = $bmp.Width
      height       = $bmp.Height
      pixelFormat  = "$($bmp.PixelFormat)"
      sampled      = $n
      whitePct     = [Math]::Round(($white / $n) * 100, 1)
      blackPct     = [Math]::Round(($black / $n) * 100, 1)
      avgLuminance = [Math]::Round(($lum / $n), 1)
    } | ConvertTo-Json -Compress
    Write-Output $out
  } finally { $bmp.Dispose() }
} finally { $img.Dispose() }
