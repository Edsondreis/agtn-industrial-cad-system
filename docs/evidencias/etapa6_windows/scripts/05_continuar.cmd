@echo off
title AGTN ETAPA 6 - 03b (branch c35c0a0) e 04 (instalar/atualizar/desinstalar) - nao feche, o app abre e fecha sozinho
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\AGTN_DEV\scripts\03_w1.ps1" -SemMain
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\AGTN_DEV\scripts\04_ciclo.ps1"
