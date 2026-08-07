<#
  Normalize a Rich Menu image to a LINE-safe JPEG:
    - draw onto a 2500x1686 Bitmap, PixelFormat 24bppRgb
    - flatten any transparency onto a WHITE background (prevents "black in LINE")
    - contain (preserve aspect, centered) — never stretch out of proportion
    - save as standard RGB/sRGB baseline JPEG; auto-reduce quality (88 -> 55, step 5)
      until the file is <= 950 KB. Fails clearly if 950 KB can't be met at q55.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/richmenu-image-convert.ps1 <source> [dest] [width] [height] [quality]
    npm run richmenu:image-convert -- <source> [dest]

  Does NOT call the LINE API.
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$Dest = "config/richmenu.jpg",
  [int]$Width = 2500,
  [int]$Height = 1686,
  [int]$StartQuality = 88,
  [int]$MinQuality = 55,
  [int]$Step = 5,
  [int]$MaxBytes = 972800  # 950 KB
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) { Write-Error "Source not found: $Source"; exit 1 }

$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
try {
  $target = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($target)
  try {
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.Clear([System.Drawing.Color]::White)  # white background flatten

    # contain: fit within target, preserve aspect, center
    $scale = [Math]::Min($Width / $src.Width, $Height / $src.Height)
    $dw = [int]([Math]::Round($src.Width * $scale))
    $dh = [int]([Math]::Round($src.Height * $scale))
    $dx = [int](($Width - $dw) / 2)
    $dy = [int](($Height - $dh) / 2)
    if ($dw -ne $Width -or $dh -ne $Height) {
      Write-Host "note: source $($src.Width)x$($src.Height) differs in aspect; using contain (white letterbox)."
    }
    $g.DrawImage($src, $dx, $dy, $dw, $dh)
  } finally { $g.Dispose() }

  # Build the quality ladder: start -> min, step down; always include MinQuality.
  $qualities = @()
  $q = $StartQuality
  while ($q -ge $MinQuality) { $qualities += $q; $q -= $Step }
  if ($qualities[-1] -ne $MinQuality) { $qualities += $MinQuality }

  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }

  # Encode to memory at each quality; keep the first that fits <= MaxBytes.
  $chosenQuality = $null
  $chosenBytes = $null
  $lastQuality = $null
  $lastSize = $null
  foreach ($qv in $qualities) {
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$qv)
    $ms = New-Object System.IO.MemoryStream
    try {
      $target.Save($ms, $codec, $ep)
      $len = $ms.Length
      $lastQuality = $qv
      $lastSize = $len
      Write-Host ("  try q{0} -> {1} KB" -f $qv, [int]($len / 1024))
      if ($len -le $MaxBytes) {
        $chosenQuality = $qv
        $chosenBytes = $ms.ToArray()
        break
      }
    } finally {
      $ms.Dispose()
      $ep.Dispose()
    }
  }

  if ($null -eq $chosenBytes) {
    Write-Error ("Cannot fit under {0} KB even at quality {1} (smallest was {2} KB). " +
      "Reduce image detail/colors or provide a simpler {3}x{4} artwork." -f `
      [int]($MaxBytes / 1024), $MinQuality, [int]($lastSize / 1024), $Width, $Height)
    exit 1
  }

  if ([System.IO.Path]::IsPathRooted($Dest)) {
    $destFull = $Dest
  } else {
    $destFull = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Dest))
  }
  [System.IO.File]::WriteAllBytes($destFull, $chosenBytes)
  $finalSize = (Get-Item $destFull).Length
  Write-Host ""
  Write-Host ("OK -> {0}" -f $Dest)
  Write-Host ("  width={0} height={1} quality={2} fileSize={3} bytes ({4} KB) format=24bppRgb JPEG (RGB)" -f `
    $Width, $Height, $chosenQuality, $finalSize, [int]($finalSize / 1024))
} finally {
  $src.Dispose()
}
