@echo off
title AGTN ETAPA 6 - 06 testes finais + 07 reteste do ciclo (o app abre e fecha sozinho; nao mexa)
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\AGTN_DEV\scripts\06_testes.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\AGTN_DEV\scripts\07_reteste.ps1"
