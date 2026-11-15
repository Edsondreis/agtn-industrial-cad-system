@echo off
title AGTN ETAPA 6 - passo 01: VS Build Tools (clique SIM no UAC)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp001_vs_buildtools.ps1"
if errorlevel 1 pause
