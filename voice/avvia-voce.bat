@echo off
title LocalAI - voce
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Servizio voce non installato: lancia tools\installa-voce.ps1
  pause
  exit /b 1
)
.venv\Scripts\python.exe server.py
pause
