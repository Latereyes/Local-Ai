# Rende LocalAI raggiungibile in HTTPS dal telefono con Tailscale, anche fuori casa.
# In HTTPS il browser permette il microfono (melodia canticchiata) e le notifiche.
# Requisiti: Tailscale installato e collegato su questo PC e sul telefono; nella console di Tailscale
# (DNS) attivi MagicDNS e "HTTPS Certificates".
# Da eseguire sul PC di LocalAI, in PowerShell:
#   powershell -ExecutionPolicy Bypass -File attiva-https.ps1
# Per toglierlo:  tailscale serve reset

param(
  [int]$Port = 3000,            # porta dell'app (PORT)
  [int]$FilesPort = 3001,       # porta dei file della cartella di lavoro (WORKSPACE_PORT)
  [int]$HttpsFilesPort = 8443   # porta HTTPS per i file: Tailscale accetta solo 443, 8443 e 10000
)

if (-not (Get-Command tailscale -ErrorAction SilentlyContinue)) {
  Write-Error "Tailscale non trovato: installalo da https://tailscale.com/download e accedi."
  exit 1
}

# App su https://<pc>.<tailnet>.ts.net, file della cartella di lavoro sulla porta 8443 (origine diversa, come la 3001)
tailscale serve --bg --https=443 "http://127.0.0.1:$Port"
if ($LASTEXITCODE -ne 0) { Write-Error "tailscale serve non riuscito: controlla che HTTPS Certificates sia attivo nella console di Tailscale."; exit 1 }
tailscale serve --bg --https=$HttpsFilesPort "http://127.0.0.1:$FilesPort"
if ($LASTEXITCODE -ne 0) { Write-Error "tailscale serve per i file non riuscito."; exit 1 }

$dns = ((tailscale status --json | ConvertFrom-Json).Self.DNSName).TrimEnd('.')
# Variabili per LocalAI: porta HTTPS dei file e indirizzo dell'app (per il link nelle notifiche ntfy)
setx WORKSPACE_HTTPS_PORT $HttpsFilesPort | Out-Null
setx APP_URL "https://$dns" | Out-Null

Write-Host "`nFatto. LocalAI in HTTPS: https://$dns" -ForegroundColor Green
Write-Host "Chiudi e riapri la finestra di LocalAI (start.bat): le nuove variabili valgono per le finestre aperte da adesso." -ForegroundColor Green
Write-Host "Dal telefono apri https://$dns con Tailscale acceso: il tasto microfono registra direttamente." -ForegroundColor Green
