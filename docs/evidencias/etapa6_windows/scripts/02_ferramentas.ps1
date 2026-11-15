# AGTN ETAPA 6 - passo 02: Git portatil, Node 22 LTS (zip) e Rust 1.97.0 MSVC em D:\AGTN_DEV. SEM UAC, sem alterar PATH do sistema.
$ErrorActionPreference = "Stop"
$R = "D:\AGTN_DEV"; $T = "$R\tools"; $DL = "$R\downloads"
$log = "$R\logs\02_ferramentas.log"
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format s), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"
$env:TEMP = "$R\tmp"; $env:TMP = $env:TEMP
Log "inicio"
try {
  # ---- Node 22 LTS (mesma linha da CI)
  $idx = Invoke-RestMethod "https://nodejs.org/dist/index.json"
  $nv = ($idx | Where-Object { $_.version -like "v22.*" -and $_.files -contains "win-x64-zip" } | Select-Object -First 1).version
  $nz = "node-$nv-win-x64.zip"
  Invoke-WebRequest "https://nodejs.org/dist/$nv/$nz" -OutFile "$DL\$nz" -UseBasicParsing
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/$nv/SHASUMS256.txt" -UseBasicParsing).Content
  $exp = (($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($nz) } | Select-Object -First 1).Split(" ")[0]
  $got = (Get-FileHash "$DL\$nz" -Algorithm SHA256).Hash.ToLower()
  Log "Node $nv : SHA256 $got (oficial $exp)"
  if ($got -ne $exp) { throw "SHA256 do Node nao confere" }
  if (Test-Path "$T\node") { Log "ja existe $T\node (mantido)" } else { Expand-Archive "$DL\$nz" -DestinationPath $T; Rename-Item "$T\node-$nv-win-x64" "node" }
  # ---- Git for Windows portatil
  $rel = Invoke-RestMethod "https://api.github.com/repos/git-for-windows/git/releases/latest" -Headers @{ "User-Agent" = "agtn-homologacao" }
  $a = $rel.assets | Where-Object { $_.name -match "^PortableGit-.*-64-bit\.7z\.exe$" } | Select-Object -First 1
  Invoke-WebRequest $a.browser_download_url -OutFile "$DL\$($a.name)" -UseBasicParsing
  $gh = (Get-FileHash "$DL\$($a.name)" -Algorithm SHA256).Hash.ToLower()
  $sig = Get-AuthenticodeSignature "$DL\$($a.name)"
  Log "Git $($rel.tag_name) $($a.name): SHA256 $gh (GitHub digest: $($a.digest)); assinatura $($sig.Status) $($sig.SignerCertificate.Subject)"
  if ($a.digest -and ("sha256:" + $gh) -ne $a.digest) { throw "SHA256 do Git nao confere" }
  if ($sig.Status -ne "Valid") { throw "assinatura do Git invalida" }
  if (Test-Path "$T\git\cmd\git.exe") { Log "ja existe $T\git (mantido)" } else { $p = Start-Process "$DL\$($a.name)" -ArgumentList "-o`"$T\git`"", "-y" -Wait -PassThru; Log "extracao Git: codigo $($p.ExitCode)" }
  # ---- Rust 1.97.0 MSVC (rustup em D:, sem mexer no PATH)
  $env:RUSTUP_HOME = "$R\rust\rustup"; $env:CARGO_HOME = "$R\rust\cargo"
  $ru = "$DL\rustup-init.exe"
  Invoke-WebRequest "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $ru -UseBasicParsing
  $rc = (Invoke-WebRequest "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe.sha256" -UseBasicParsing).Content; if ($rc -is [byte[]]) { $rc = [Text.Encoding]::ASCII.GetString($rc) }; $rexp = ($rc.Trim() -split "\s+")[0].ToLower()
  $rgot = (Get-FileHash $ru -Algorithm SHA256).Hash.ToLower()
  Log "rustup-init: SHA256 $rgot (oficial $rexp)"
  if ($rgot -ne $rexp) { throw "SHA256 do rustup-init nao confere" }
  cmd /c "`"$ru`" -y --no-modify-path --profile minimal --default-host x86_64-pc-windows-msvc --default-toolchain 1.97.0 > `"$R\logs\02_rustup.log`" 2>&1"
  Log "rustup-init codigo $LASTEXITCODE (saida em logs\02_rustup.log)"; if ($LASTEXITCODE -ne 0) { throw "rustup-init falhou" }
  # ---- ambiente por processo
  $amb = @"
@echo off
rem AGTN ETAPA 6 - ambiente de build (so para este processo; nao altera o PATH do Windows)
set "RUSTUP_HOME=$R\rust\rustup"
set "CARGO_HOME=$R\rust\cargo"
set "npm_config_cache=$R\cache\npm"
set "TEMP=$R\tmp"
set "TMP=$R\tmp"
set "PATH=$T\node;$T\git\cmd;$R\rust\cargo\bin;%PATH%"
"@
  Set-Content -Path "$R\ambiente.cmd" -Value $amb -Encoding ASCII
  $env:PATH = "$T\node;$T\git\cmd;$R\rust\cargo\bin;" + $env:PATH
  Log ("versoes: node " + (node --version) + "; npm " + (npm --version) + "; git " + (git --version) + "; " + (rustc --version) + "; " + (cargo --version) + "; rustup host " + ((rustup show active-toolchain) -join " "))
  Log ("C livre GB=$([math]::Round((Get-PSDrive C).Free/1GB,1)); D livre GB=$([math]::Round((Get-PSDrive D).Free/1GB,1))")
  Set-Content "$R\logs\02_FIM.txt" "ok"
} catch { Log ("ERRO: " + $_.Exception.Message); Set-Content "$R\logs\02_FIM.txt" ("erro: " + $_.Exception.Message) }
