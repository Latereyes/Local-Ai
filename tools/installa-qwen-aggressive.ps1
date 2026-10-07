# Installa Qwen3.8 27B Uncensored Aggressive (HauhauCS, Q3_K_P, ~13,4 GB) in Ollama come "qwen3.8-aggressive".
# Da eseguire sul PC di Ollama (questo PC), in PowerShell:
#   powershell -ExecutionPolicy Bypass -File installa-qwen-aggressive.ps1
# Se il download si interrompe, rilancialo: riprende da dove era arrivato.

$ErrorActionPreference = "Stop"
$name = "qwen3.8-aggressive"
$repo = "https://huggingface.co/HauhauCS/Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-MTP-GGUF/resolve/main"
$file = "Qwen3.8-27B-Uncensored-HauhauCS-Aggressive-Q3_K_P.gguf"
$modelfile = Join-Path $PSScriptRoot "qwen-aggressive.Modelfile"
$gguf = Join-Path $PSScriptRoot $file   # accanto al Modelfile, che lo cita con ./ (i .gguf sono esclusi da git)

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { Write-Error "Ollama non trovato nel PATH"; exit 1 }

# 1. Download del GGUF (Ollama non accetta il tag Q3_K_P da Hugging Face, quindi si scarica il file)
Write-Host "`n>> Scarico $file (~13,4 GB)" -ForegroundColor Cyan
# curl.exe e' incluso in Windows 10/11: -C - riprende i download interrotti
curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o "$gguf" "$repo/$file"
if ($LASTEXITCODE -ne 0) { Write-Error "Download fallito"; exit 1 }

# 2. Controllo dell'impronta con SHA256SUMS del repo
Write-Host "`n>> Controllo SHA256" -ForegroundColor Cyan
$sums = (curl.exe -sL --fail "$repo/SHA256SUMS" | Out-String)
$line = $sums -split "`n" | Where-Object { $_ -match [regex]::Escape($file) } | Select-Object -First 1
if ($line) {
  $expected = ($line -split "\s+")[0].ToLower()
  $actual = (Get-FileHash -Algorithm SHA256 "$gguf").Hash.ToLower()
  if ($expected -ne $actual) {
    Remove-Item "$gguf"
    Write-Error "SHA256 diverso da quello del repo: file cancellato, rilancia lo script"; exit 1
  }
  Write-Host "SHA256 ok" -ForegroundColor Green
} else {
  Write-Warning "SHA256SUMS non trovato o senza questo file: salto il controllo"
}

# 3. Modello con i parametri per la 4070 Ti Super (tutto in GPU, contesto 16k)
Write-Host "`n>> Creo $name" -ForegroundColor Cyan
ollama create $name -f "$modelfile"
if ($LASTEXITCODE -ne 0) { Write-Error "Creazione del modello fallita"; exit 1 }
# Ollama ne ha fatto una copia: il file scaricato non serve piu'
Remove-Item "$gguf"

# LocalAI mostra nel menu solo i modelli che supportano i tool
$info = ollama show $name | Out-String
if ($info -notmatch "(?m)^\s*tools\s*$") {
  Write-Warning "Ollama non riconosce i tool per ${name}: LocalAI non lo mostrera' nel menu dei modelli. Aggiorna Ollama e rilancia lo script."
}

Write-Host "`nFatto: in LocalAI scegli 'Qwen Aggressive' dal menu dei modelli (ricarica la pagina)." -ForegroundColor Green
Write-Host "Per controllare che stia tutto in GPU: dopo un messaggio, 'ollama ps' deve dire 100% GPU." -ForegroundColor Green
