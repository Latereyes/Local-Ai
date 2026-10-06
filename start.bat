@echo off
title LocalAI
cd /d "%~dp0"
if not exist node_modules (
  echo Installo le dipendenze...
  call npm install
)
node server.js
rem Avviato dall'agent del PC (remote-app-controller): niente pausa, la finestra non c'è
if not defined CONTROL_TOKEN pause
