@echo off
title LocalAI
cd /d "%~dp0"
if not exist node_modules (
  echo Installo le dipendenze...
  call npm install
)
node server.js
pause
