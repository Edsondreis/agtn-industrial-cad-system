# AGTN ETAPA 6 - passo 09: estado final (SOMENTE LEITURA): espaco usado, pastas, AGTN instalado, registro.
$o = "D:\AGTN_DEV\logs\09_estado_final.txt"; $r = New-Object System.Collections.Generic.List[string]
function A($t) { $r.Add($t) }
function Sz($p) { if (Test-Path -LiteralPath $p) { "{0:N2} GB" -f (((Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) / 1GB) } else { "ausente" } }
A ("data " + (Get-Date -Format s))
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { A ("{0} livre {1:N1} GB de {2:N1} GB" -f $_.DeviceID, ($_.FreeSpace / 1GB), ($_.Size / 1GB)) }
foreach ($p in "D:\AGTN_DEV", "D:\AGTN_DEV\BuildTools", "D:\AGTN_DEV\vs", "D:\AGTN_DEV\rust", "D:\AGTN_DEV\tools", "D:\AGTN_DEV\src", "D:\AGTN_DEV\cache", "D:\AGTN_DEV\homologacao", "D:\Windows Kits", "C:\Program Files (x86)\Windows Kits", "C:\Program Files (x86)\Microsoft Visual Studio", "C:\ProgramData\Microsoft\VisualStudio", "C:\ProgramData\Package Cache", "$env:LOCALAPPDATA\tauri", "$env:LOCALAPPDATA\br.com.agtn.cad", "$env:LOCALAPPDATA\AGTN Industrial CAD") { A ("{0} -> {1}" -f $p, (Sz $p)) }
$apps = foreach ($root in "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall") { Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like "*AGTN*" -or $_.DisplayName -like "*Build Tools*" -or $_.DisplayName -like "*Windows Software Development Kit*" } | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" } }
A ("programas (AGTN / Build Tools / SDK): " + (($apps | Sort-Object -Unique) -join " | "))
A ("PATH usuario: " + [Environment]::GetEnvironmentVariable("Path", "User")); A ("PATH maquina: " + [Environment]::GetEnvironmentVariable("Path", "Machine"))
A ("variaveis RUSTUP/CARGO/npm no usuario: " + (([Environment]::GetEnvironmentVariables("User").Keys | Where-Object { $_ -match "RUST|CARGO|npm|NODE" }) -join ","))
$r | Set-Content $o -Encoding UTF8
