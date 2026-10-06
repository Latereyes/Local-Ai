# Ripara insightface (serve a IPAdapter FaceID) e scarica la LoRA FaceID Plus v2 SDXL.
# Da eseguire SUL PC DI COMFYUI (192.168.1.12), in PowerShell, CON COMFYUI FERMO:
#   powershell -ExecutionPolicy Bypass -File ripara-insightface.ps1
# Se ComfyUI è installato altrove:  -ComfyDir "D:\percorso\ComfyUI"
# Se il Python di ComfyUI non è in <ComfyDir>\venv:  -Python "D:\percorso\python.exe"
#
# Cosa fa:
#  1. salva l'elenco dei pacchetti installati (pip freeze) per poter tornare indietro;
#  2. se insightface non si importa, reinstalla la versione precompilata per Python 3.12
#     SENZA toccare numpy né le altre dipendenze (numpy resta bloccato alla versione attuale);
#  3. installa onnxruntime (CPU) se manca, sempre senza cambiare numpy;
#  4. scarica i modelli buffalo_l di insightface in models\insightface\models\buffalo_l;
#  5. scarica ip-adapter-faceid-plusv2_sdxl_lora.safetensors (371 MB) in models\loras;
#  6. verifica che il rilevamento dei volti funzioni.

param(
  [string]$ComfyDir = "C:\IA\Packages\ComfyUI",
  [string]$Python = ""
)

$ErrorActionPreference = "Stop"
function Step($t) { Write-Host "`n>> $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "`n!! $t" -ForegroundColor Red; exit 1 }

if (-not $Python) { $Python = Join-Path $ComfyDir "venv\Scripts\python.exe" }
if (-not (Test-Path $Python)) { Fail "Python di ComfyUI non trovato: $Python (usa -Python)" }
$models = Join-Path $ComfyDir "models"
if (-not (Test-Path $models)) { Fail "Cartella non trovata: $models (usa -ComfyDir)" }

# ComfyUI deve essere fermo, altrimenti Windows blocca i file del pacchetto da sostituire
if (Get-NetTCPConnection -LocalPort 8188 -State Listen -ErrorAction SilentlyContinue) {
  Fail "ComfyUI e' in esecuzione (porta 8188). Fermalo da Stability Matrix e rilancia lo script."
}

$tmp = Join-Path $env:TEMP "ripara-insightface"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$pyCheck = Join-Path $tmp "check.py"
$insightDir = Join-Path $models "insightface"

# Script Python di verifica: versioni + import + (opzionale) caricamento buffalo_l su CPU
@'
import sys, importlib.metadata as md
def ver(p):
    try: return md.version(p)
    except Exception: return "non installato"
for p in ("numpy", "insightface", "onnxruntime", "onnxruntime-gpu", "opencv-python", "opencv-python-headless"):
    print(f"  {p:24} {ver(p)}")
try:
    import insightface
    from insightface.app import FaceAnalysis
except Exception as e:
    print(f"IMPORT_FAIL {type(e).__name__}: {e}")
    sys.exit(2)
print("IMPORT_OK")
if len(sys.argv) > 1:
    app = FaceAnalysis(name="buffalo_l", root=sys.argv[1], providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    print("FACEANALYSIS_OK")
'@ | Set-Content -Encoding ASCII $pyCheck

Step "Python: $Python"
& $Python --version

Step "1/6 Backup dei pacchetti installati"
$backup = Join-Path $ComfyDir ("pip-backup-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt")
& $Python -m pip freeze | Set-Content -Encoding UTF8 $backup
Write-Host "  salvato in $backup"

# Blocca numpy alla versione attuale per tutte le installazioni successive
$numpyVer = (& $Python -c "import numpy; print(numpy.__version__)").Trim()
$constraints = Join-Path $tmp "constraints.txt"
"numpy==$numpyVer" | Set-Content -Encoding ASCII $constraints
Write-Host "  numpy resta bloccato a $numpyVer"

Step "2/6 Verifica di insightface"
& $Python $pyCheck
$ok = ($LASTEXITCODE -eq 0)
if ($ok) {
  Write-Host "  insightface si importa gia' correttamente: nessuna reinstallazione." -ForegroundColor Green
} else {
  $major = [int]($numpyVer.Split(".")[0])
  if ($major -ge 2) {
    Write-Host "  numpy ${numpyVer}: reinstallo insightface dal sorgente (servono i Build Tools di Visual C++)." -ForegroundColor Yellow
    & $Python -m pip install --force-reinstall --no-deps --no-cache-dir --no-binary insightface "insightface==0.7.3" -c $constraints
  } else {
    # Wheel precompilata per Windows / Python 3.12 / numpy 1.x (la stessa usata da ReActor e IPAdapter)
    $whl = Join-Path $tmp "insightface-0.7.3-cp312-cp312-win_amd64.whl"
    curl.exe -L --fail --retry 3 -o "$whl" "https://github.com/Gourieff/Assets/raw/main/Insightface/insightface-0.7.3-cp312-cp312-win_amd64.whl"
    if ($LASTEXITCODE -ne 0) { Fail "Download della wheel di insightface fallito" }
    & $Python -m pip install --force-reinstall --no-deps --no-cache-dir "$whl"
  }
  if ($LASTEXITCODE -ne 0) { Fail "Reinstallazione di insightface fallita. Per tornare indietro: $Python -m pip install -r `"$backup`"" }
}

Step "3/6 onnxruntime"
$hasOrt = (& $Python -c "import importlib.util as u; print(bool(u.find_spec('onnxruntime')))").Trim()
if ($hasOrt -eq "True") { Write-Host "  gia' installato" }
else {
  & $Python -m pip install -c $constraints "onnxruntime"
  if ($LASTEXITCODE -ne 0) { Fail "Installazione di onnxruntime fallita" }
}

Step "4/6 Modelli insightface buffalo_l"
$buffalo = Join-Path $insightDir "models\buffalo_l"
if (Test-Path (Join-Path $buffalo "det_10g.onnx")) { Write-Host "  gia' presenti in $buffalo" }
else {
  $zip = Join-Path $tmp "buffalo_l.zip"
  curl.exe -L --fail --retry 5 -C - -o "$zip" "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"
  if ($LASTEXITCODE -ne 0) { Fail "Download di buffalo_l fallito" }
  $ex = Join-Path $tmp "buffalo_l"
  if (Test-Path $ex) { Remove-Item -Recurse -Force $ex }
  Expand-Archive -Path $zip -DestinationPath $ex
  New-Item -ItemType Directory -Force -Path $buffalo | Out-Null
  Get-ChildItem -Path $ex -Recurse -Filter *.onnx | Copy-Item -Destination $buffalo -Force
  Write-Host "  installati in $buffalo"
}

Step "5/6 LoRA FaceID Plus v2 SDXL (371 MB)"
$loraDir = Join-Path $models "loras"
New-Item -ItemType Directory -Force -Path $loraDir | Out-Null
$lora = Join-Path $loraDir "ip-adapter-faceid-plusv2_sdxl_lora.safetensors"
if ((Test-Path $lora) -and (Get-Item $lora).Length -eq 371842896) { Write-Host "  gia' presente" }
else {
  curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o "$lora" "https://huggingface.co/h94/IP-Adapter-FaceID/resolve/main/ip-adapter-faceid-plusv2_sdxl_lora.safetensors"
  if ($LASTEXITCODE -ne 0) { Fail "Download della LoRA fallito" }
}

Step "6/6 Verifica finale"
& $Python $pyCheck $insightDir
if ($LASTEXITCODE -ne 0) {
  Fail "insightface non funziona ancora. Copia l'output qui sopra in chat. Per tornare indietro: $Python -m pip install -r `"$backup`""
}
Write-Host "`nFatto. Riavvia ComfyUI da Stability Matrix: LocalAI usera' FaceID per le foto con il tuo volto." -ForegroundColor Green
