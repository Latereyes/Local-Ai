# Installa il servizio voce di LocalAI (conversazione a voce): faster-whisper per capire cosa dici,
# Piper con le voci italiane per rispondere. Tutto in voice\.venv, un ambiente Python separato:
# ComfyUI e il resto del PC non si toccano. Circa 1 GB tra librerie e modelli (1,5 GB in più con -Gpu).
# Da eseguire sul PC di LocalAI, in PowerShell, dalla cartella di LocalAI:
#   powershell -ExecutionPolicy Bypass -File tools\installa-voce.ps1
# Whisper anche sulla GPU (quando c'è posto):  -Gpu   (scarica cuBLAS e cuDNN per CUDA 12)
# Python 3.12 da un'altra posizione:          -Python "C:\percorso\python.exe"
# Rilanciarlo è sicuro: salta quello che c'è già. Dopo, riavvia LocalAI: avvia lui il servizio voce.

param(
  [string]$Python = "",
  [switch]$Gpu,
  [string]$Modello = "large-v3-turbo",
  [string[]]$Voci = @("it_IT-paola-medium", "it_IT-riccardo-x_low")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$voice = Join-Path $root "voice"
$venv = Join-Path $voice ".venv"
$py = Join-Path $venv "Scripts\python.exe"

# Python 3.12: faster-whisper e Piper non hanno ancora i pacchetti per 3.14 (il Python predefinito del PC)
if (-not (Test-Path $py)) {
  if (-not $Python) {
    $cands = @("C:\IA\Assets\Python\cpython-3.12.10-windows-x86_64-none\python.exe")
    try { $cands += (& py -3.12 -c "import sys; print(sys.executable)" 2>$null) } catch {}
    $Python = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  }
  if (-not $Python) { Write-Error "Python 3.12 non trovato: indicalo con -Python"; exit 1 }
  Write-Host ">> Creo l'ambiente voce con $Python" -ForegroundColor Cyan
  & $Python -m venv $venv
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host "`n>> Librerie: faster-whisper, piper-tts" -ForegroundColor Cyan
& $py -m pip install --upgrade --quiet pip
& $py -m pip install --upgrade "faster-whisper>=1.2" "piper-tts>=1.3"
if ($LASTEXITCODE -ne 0) { Write-Error "Installazione delle librerie non riuscita"; exit 1 }
if ($Gpu) {
  Write-Host "`n>> Librerie CUDA 12 per Whisper sulla GPU (cuBLAS, cuDNN 9)" -ForegroundColor Cyan
  & $py -m pip install --upgrade "nvidia-cublas-cu12" "nvidia-cudnn-cu12==9.*"
  if ($LASTEXITCODE -ne 0) { Write-Error "Installazione delle librerie CUDA non riuscita"; exit 1 }
}

Write-Host "`n>> Voci italiane: $($Voci -join ', ')" -ForegroundColor Cyan
$vociDir = Join-Path $voice "voci"
New-Item -ItemType Directory -Force -Path $vociDir | Out-Null
& $py -m piper.download_voices @Voci --data-dir $vociDir
if ($LASTEXITCODE -ne 0) { Write-Error "Download delle voci non riuscito"; exit 1 }

Write-Host "`n>> Modello Whisper $Modello (circa 0,8 GB, solo la prima volta)" -ForegroundColor Cyan
$modelli = Join-Path $voice "modelli"
& $py -c "from faster_whisper import WhisperModel; WhisperModel('$Modello', device='cpu', compute_type='int8', download_root=r'$modelli')"
if ($LASTEXITCODE -ne 0) { Write-Error "Download del modello Whisper non riuscito"; exit 1 }

Write-Host "`nFatto. Riavvia LocalAI: avvia da solo il servizio voce e nella chat compare il tasto della voce." -ForegroundColor Green
Write-Host "Per provarlo da solo: voice\avvia-voce.bat (poi http://127.0.0.1:8190/health)." -ForegroundColor Green
