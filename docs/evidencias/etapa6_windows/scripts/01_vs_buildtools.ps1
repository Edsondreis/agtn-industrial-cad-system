# AGTN ETAPA 6 - passo 01: cria D:\AGTN_DEV e instala VS Build Tools 2022 (MSVC v143 + Windows 11 SDK 26100). UNICO passo com UAC.
$ErrorActionPreference = "Stop"
$R = "D:\AGTN_DEV"
foreach ($d in "tools","rust","cache","logs","downloads","tmp","vs\cache","vs\shared","src","homologacao") { New-Item -ItemType Directory -Force -Path (Join-Path $R $d) | Out-Null }
$log = Join-Path $R "logs\01_vs_buildtools.log"
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format s), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
Log "inicio; C livre GB=$([math]::Round((Get-PSDrive C).Free/1GB,1)); D livre GB=$([math]::Round((Get-PSDrive D).Free/1GB,1))"
$bt = Join-Path $R "downloads\vs_buildtools.exe"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_buildtools.exe" -OutFile $bt -UseBasicParsing
$sig = Get-AuthenticodeSignature $bt
Log ("bootstrapper: {0} bytes; SHA256 {1}; assinatura {2}; {3}" -f (Get-Item $bt).Length, (Get-FileHash $bt -Algorithm SHA256).Hash, $sig.Status, $sig.SignerCertificate.Subject)
if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") { Log "ERRO: assinatura invalida, abortado"; exit 2 }
$env:TEMP = Join-Path $R "tmp"; $env:TMP = $env:TEMP
$vsArgs = @("--installPath", "$R\BuildTools", "--path", "cache=$R\vs\cache", "--path", "shared=$R\vs\shared",
  "--add", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
  "--add", "Microsoft.VisualStudio.Component.Windows11SDK.26100",
  "--passive", "--wait", "--norestart")
Log ("executando (UAC): vs_buildtools.exe " + ($vsArgs -join " "))
$p = Start-Process -FilePath $bt -ArgumentList $vsArgs -Verb RunAs -Wait -PassThru
Log "codigo de saida: $($p.ExitCode) (0 = ok; 3010 = ok, reiniciar depois)"
$vw = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vw) { Log ("vswhere: " + ((& $vw -all -products * -format text) -join " | ")) }
Get-ChildItem $env:TEMP -Filter "dd_*.log" -ErrorAction SilentlyContinue | Copy-Item -Destination (Join-Path $R "logs") -ErrorAction SilentlyContinue
Get-ChildItem "$env:LOCALAPPDATA\Temp" -Filter "dd_*.log" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-3) } | Copy-Item -Destination (Join-Path $R "logs") -ErrorAction SilentlyContinue
Log "fim; C livre GB=$([math]::Round((Get-PSDrive C).Free/1GB,1)); D livre GB=$([math]::Round((Get-PSDrive D).Free/1GB,1))"
Set-Content -Path (Join-Path $R "logs\01_FIM.txt") -Value "codigo $($p.ExitCode)"
