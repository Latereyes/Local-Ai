# Scarica i modelli audio di LocalAI nella cartella di ComfyUI:
#   musica          -> ACE-Step 1.5 Turbo (circa 9,3 GB)
#   effetti sonori  -> Stable Audio 3 Medium (circa 9,7 GB)
# I nodi servono già nel ComfyUI del PC (controllato il 2026-10-11): basta scaricare i modelli.
# Da eseguire sul PC di ComfyUI, in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scarica-audio.ps1
# Solo una parte:  -Cosa musica   oppure   -Cosa effetti
# Se ComfyUI è installato altrove:  -ComfyDir "D:\percorso\ComfyUI"
# Il download riprende da dove si era interrotto se lo rilanci.

param(
  [string]$ComfyDir = "C:\IA\Packages\ComfyUI",
  [ValidateSet("tutto", "musica", "effetti")][string]$Cosa = "tutto"
)

$ace = "https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files/resolve/main/split_files"
$sa3 = "https://huggingface.co/Comfy-Org/stable-audio-3/resolve/main"
$files = @(
  @{ Per = "musica"; Folder = "diffusion_models"; Name = "acestep_v1.5_turbo.safetensors"; Size = "4,5 GB"; Url = "$ace/diffusion_models/acestep_v1.5_turbo.safetensors" },
  @{ Per = "musica"; Folder = "text_encoders"; Name = "qwen_0.6b_ace15.safetensors"; Size = "1,1 GB"; Url = "$ace/text_encoders/qwen_0.6b_ace15.safetensors" },
  @{ Per = "musica"; Folder = "text_encoders"; Name = "qwen_1.7b_ace15.safetensors"; Size = "3,5 GB"; Url = "$ace/text_encoders/qwen_1.7b_ace15.safetensors" },
  @{ Per = "musica"; Folder = "vae"; Name = "ace_1.5_vae.safetensors"; Size = "0,3 GB"; Url = "$ace/vae/ace_1.5_vae.safetensors" },
  @{ Per = "effetti"; Folder = "checkpoints"; Name = "stable_audio_3_medium.safetensors"; Size = "8,6 GB"; Url = "$sa3/checkpoints/stable_audio_3_medium.safetensors" },
  @{ Per = "effetti"; Folder = "text_encoders"; Name = "t5gemma_b_b_ul2.safetensors"; Size = "1,1 GB"; Url = "$sa3/text_encoders/t5gemma_b_b_ul2.safetensors" }
)

$models = Join-Path $ComfyDir "models"
if (-not (Test-Path $models)) { Write-Error "Cartella non trovata: $models (usa -ComfyDir)"; exit 1 }

foreach ($f in $files) {
  if ($Cosa -ne "tutto" -and $f.Per -ne $Cosa) { continue }
  $dir = Join-Path $models $f.Folder
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $dest = Join-Path $dir $f.Name
  Write-Host "`n>> $($f.Name) ($($f.Size), $($f.Per)) -> $dir" -ForegroundColor Cyan
  # curl.exe è incluso in Windows 10/11: -C - riprende i download interrotti
  curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o "$dest" "$($f.Url)"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Download fallito: $($f.Name). Se Hugging Face risponde 401/403 il modello chiede di accettare la licenza: apri la pagina del link, accetta e riprova."
    exit 1
  }
}

Write-Host "`nFatto. Non serve riavviare ComfyUI: LocalAI rileva i nuovi modelli entro 5 minuti" -ForegroundColor Green
Write-Host "(oppure subito, da Gestione utenti > Ricarica workflow, o riavviando LocalAI)." -ForegroundColor Green
