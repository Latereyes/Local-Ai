# Scarica i modelli di Qwen-Image-Edit 2511 nella cartella di ComfyUI.
# Da eseguire SUL PC DI COMFYUI (192.168.1.12), in PowerShell:
#   powershell -ExecutionPolicy Bypass -File scarica-qwen-image-edit.ps1
# Se ComfyUI è installato altrove:  -ComfyDir "D:\percorso\ComfyUI"
# Il download riprende da dove si era interrotto se lo rilanci.

param([string]$ComfyDir = "C:\IA\Packages\ComfyUI")

$files = @(
  @{ Folder = "diffusion_models"; Name = "qwen_image_edit_2511_int8_convrot.safetensors"; Size = "20,5 GB"
     Url = "https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI/resolve/main/split_files/diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors" },
  @{ Folder = "text_encoders"; Name = "qwen_2.5_vl_7b_fp8_scaled.safetensors"; Size = "9,4 GB"
     Url = "https://huggingface.co/Comfy-Org/HunyuanVideo_1.5_repackaged/resolve/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors" },
  @{ Folder = "loras"; Name = "Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors"; Size = "0,85 GB"
     Url = "https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning/resolve/main/Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors" }
)

$models = Join-Path $ComfyDir "models"
if (-not (Test-Path $models)) { Write-Error "Cartella non trovata: $models (usa -ComfyDir)"; exit 1 }

foreach ($f in $files) {
  $dir = Join-Path $models $f.Folder
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $dest = Join-Path $dir $f.Name
  Write-Host "`n>> $($f.Name) ($($f.Size)) -> $dir" -ForegroundColor Cyan
  # curl.exe è incluso in Windows 10/11: -C - riprende i download interrotti
  curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o "$dest" "$($f.Url)"
  if ($LASTEXITCODE -ne 0) { Write-Error "Download fallito: $($f.Name)"; exit 1 }
}

Write-Host "`nFatto. Non serve riavviare ComfyUI: LocalAI rileva i nuovi modelli entro 5 minuti" -ForegroundColor Green
Write-Host "(oppure subito, da Gestione utenti > Ricarica workflow, o riavviando LocalAI)." -ForegroundColor Green
