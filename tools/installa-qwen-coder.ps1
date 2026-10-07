# Installa Qwen3.8 27B Uncensored (orcarouter, IQ3_M, ~14 GB) in Ollama come modello per il codice ("qwen3.8-coder").
# Da eseguire sul PC di Ollama (questo PC), in PowerShell:
#   powershell -ExecutionPolicy Bypass -File installa-qwen-coder.ps1
# Se il download si interrompe, rilancialo: Ollama riprende da dove era arrivato.

$ErrorActionPreference = "Stop"
$name = "qwen3.8-coder"
$source = "orcarouter/Qwen3.8-27B-Uncensored:iq3_m"
# Versioni precedenti, da togliere (la Unsloth installata fino a ottobre 2026)
$old = @("hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q3_K_XL")
$modelfile = Join-Path $PSScriptRoot "qwen-coder.Modelfile"

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { Write-Error "Ollama non trovato nel PATH"; exit 1 }

# 1. KV cache in q8_0 (dimezza la memoria del contesto, serve il flash attention).
#    Sono impostazioni del server Ollama: valgono per tutti i modelli, Gemma compresa.
$restart = $false
foreach ($v in @(@{ K = "OLLAMA_FLASH_ATTENTION"; V = "1" }, @{ K = "OLLAMA_KV_CACHE_TYPE"; V = "q8_0" })) {
  if ([Environment]::GetEnvironmentVariable($v.K, "User") -ne $v.V) {
    [Environment]::SetEnvironmentVariable($v.K, $v.V, "User")
    Write-Host "Impostato $($v.K)=$($v.V)" -ForegroundColor Cyan
    $restart = $true
  }
}

# 2. Via il Qwen precedente: libera spazio su disco prima di scaricare il nuovo
$installed = (ollama list | Out-String)
foreach ($m in @($name) + $old) {
  if ($installed -match [regex]::Escape($m)) {
    Write-Host ">> Tolgo $m" -ForegroundColor Cyan
    ollama rm $m | Out-Null
  }
}

# 3. Download dalla libreria di Ollama (~14 GB)
Write-Host "`n>> Scarico $source" -ForegroundColor Cyan
ollama pull $source
if ($LASTEXITCODE -ne 0) { Write-Error "Download fallito"; exit 1 }

# 4. Modello con i parametri per la 4070 Ti Super (tutto in GPU, contesto 16k)
Write-Host "`n>> Creo $name" -ForegroundColor Cyan
ollama create $name -f "$modelfile"
if ($LASTEXITCODE -ne 0) { Write-Error "Creazione del modello fallita"; exit 1 }
# Il modello scaricato non serve piu': senza, nel menu di LocalAI c'e' un solo Qwen.
# I file del GGUF restano, perche' li usa $name.
ollama rm $source | Out-Null

# LocalAI mostra nel menu solo i modelli che supportano i tool
$info = ollama show $name | Out-String
if ($info -notmatch "(?m)^\s*tools\s*$") {
  Write-Warning "Ollama non riconosce i tool per ${name}: LocalAI non lo mostrera' nel menu dei modelli. Aggiorna Ollama e rilancia lo script."
}

Write-Host "`nFatto: in LocalAI scegli 'Qwen Coder' dal menu dei modelli (ricarica la pagina)." -ForegroundColor Green
if ($restart) {
  Write-Host "Chiudi Ollama dall'icona vicino all'orologio e riaprilo, cosi' legge la nuova KV cache." -ForegroundColor Yellow
}
Write-Host "Per controllare che stia tutto in GPU: dopo un messaggio, 'ollama ps' deve dire 100% GPU." -ForegroundColor Green
