<#
.SYNOPSIS
  FASE 4 · ETAPA 3 — Build e testes do AGTN Industrial CAD num Windows REAL (homologação W1).

.DESCRIPTION
  Roda no PC Windows, sem alterar a main e sem publicar nada:
    1. registra o ambiente (Windows, CPU, RAM, GPU, tela, Node, Rust, WebView2, Visual Studio Build Tools);
    2. baixa (ou atualiza) a branch feature/agtn-3d-ia numa pasta própria (finais de linha LF, como no repositório);
    3. npm ci · typecheck · vitest · cargo test (com os DWG reais) · tauri build (instalador NSIS)   → W1;
    4. copia o instalador e monta "pacote_validacao" (roda em qualquer PC, sem ferramentas de desenvolvimento);
    5. (a menos de -SemValidar) roda validar_instalado.ps1: W2 instalação, W3 atualização (com
       -InstaladorAnterior), W5 caminhos, W7 teste de fumaça no WebView2, P2 desempenho, W4 desinstalação.
  Tudo fica em C:\AGTN_HOMOLOGACAO\<data-hora>\: homologacao.log, resumo.json, instalador, pacote_validacao,
  instalado\ (log e resumo do validar_instalado + webview2\).

  ATENÇÃO: revisado na ETAPA 4 sem execução num Windows real (o ambiente de desenvolvimento não tem Windows).

.EXAMPLE
  Abra o PowerShell (não precisa ser administrador) e rode:
    powershell -ExecutionPolicy Bypass -File .\homologacao.ps1
  ou, se o repositório já estiver clonado:
    powershell -ExecutionPolicy Bypass -File .\homologacao.ps1 -Repo "D:\dev\agtn-industrial-cad-system"
#>
param(
  [string]$Repo = "$env:USERPROFILE\agtn-homologacao\agtn-industrial-cad-system",
  [string]$Branch = "feature/agtn-3d-ia",
  [string]$Out = "C:\AGTN_HOMOLOGACAO",
  [string]$InstaladorAnterior = "",
  [switch]$SemValidar
)

$ErrorActionPreference = "Continue"
$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$dir = Join-Path $Out $stamp
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir "homologacao.log"
$summary = [ordered]@{ data = (Get-Date).ToString("s"); branch = $Branch; etapas = [ordered]@{} }

function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
function Ver($cmd, $arg = "--version") { try { (& $cmd $arg 2>&1 | Select-Object -First 1).ToString() } catch { "AUSENTE" } }
function Step($name, [scriptblock]$block) {
  Log "== $name"
  $t0 = Get-Date
  $global:LASTEXITCODE = 0
  $out = & $block 2>&1
  $code = $LASTEXITCODE
  $out | ForEach-Object { Add-Content -Path $log -Value $_ -Encoding UTF8 }
  $ms = [int]((Get-Date) - $t0).TotalMilliseconds
  $ok = ($code -eq 0 -or $null -eq $code)
  $summary.etapas[$name] = [ordered]@{ ok = $ok; codigo = $code; ms = $ms }
  Log ("   {0} ({1} ms, código {2})" -f ($(if ($ok) { "OK" } else { "FALHOU" }), $ms, $code))
  return $ok
}

# ---------------------------------------------------------------- 1. ambiente
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$wv2 = $null
foreach ($k in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}", "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")) {
  try { $wv2 = (Get-ItemProperty -Path $k -ErrorAction Stop).pv; break } catch {}
}
$vs = $null
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) { $vs = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName) }
$gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) (driver $($_.DriverVersion), $($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution))" })
$summary.ambiente = [ordered]@{
  computador = $env:COMPUTERNAME
  gpu = $gpu
  windows = "$($os.Caption) $($os.Version) (build $($os.BuildNumber))"
  cpu = $cpu.Name.Trim()
  nucleos = $cpu.NumberOfLogicalProcessors
  ram_gb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  node = Ver node "-v"
  npm = Ver npm "-v"
  git = Ver git
  rustc = Ver rustc "-V"
  cargo = Ver cargo "-V"
  webview2 = $(if ($wv2) { $wv2 } else { "AUSENTE" })
  vs_build_tools = $(if ($vs) { $vs } else { "AUSENTE (C++ x64 obrigatório para o Rust MSVC)" })
}
Log ("Ambiente: " + ($summary.ambiente | ConvertTo-Json -Compress))

$faltando = @()
foreach ($p in "node", "npm", "git", "rustc", "cargo") { if ($summary.ambiente[$p] -eq "AUSENTE") { $faltando += $p } }
if (-not $vs) { $faltando += "Visual Studio Build Tools (C++)" }
if ($faltando.Count) {
  Log ("FALTAM pré-requisitos: " + ($faltando -join ", "))
  Log "Instale: Node 22 LTS (nodejs.org), Git (git-scm.com), Rust (rustup.rs, toolchain stable-x86_64-pc-windows-msvc) e 'Ferramentas de Build do Visual Studio' com 'Desenvolvimento para desktop com C++'."
  $summary.resultado = "PRÉ-REQUISITOS AUSENTES"
  $summary | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $dir "resumo.json") -Encoding UTF8
  exit 2
}

# ---------------------------------------------------------------- 2. código
if (-not (Test-Path (Join-Path $Repo ".git"))) {
  New-Item -ItemType Directory -Force -Path (Split-Path $Repo) | Out-Null
  Step "git clone" { git -c core.autocrlf=false clone --branch $Branch https://github.com/Edsondreis/agtn-industrial-cad-system.git $Repo } | Out-Null
} else {
  Step "git fetch + checkout" { git -C $Repo fetch origin; git -C $Repo checkout $Branch; git -C $Repo pull --ff-only origin $Branch } | Out-Null
}
$summary.commit = (git -C $Repo rev-parse HEAD).Trim()
Log "Commit: $($summary.commit)"
Push-Location $Repo

# ---------------------------------------------------------------- 3. build e testes
$ok = $true
$ok = (Step "npm ci" { npm ci }) -and $ok
$ok = (Step "typecheck" { npm run typecheck }) -and $ok
$ok = (Step "vitest" { npx vitest run }) -and $ok
$env:AGTN_DWG_SAMPLES = Join-Path $Repo "tests\dwg"
Push-Location "apps\desktop\src-tauri"
$ok = (Step "cargo test --release" { cargo test --release }) -and $ok
Pop-Location
$ok = (Step "tauri build (NSIS)" { npm run tauri build -- --bundles nsis }) -and $ok

$nsis = Get-ChildItem -Path "apps\desktop\src-tauri\target\release\bundle\nsis" -Filter *.exe -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($nsis) {
  Copy-Item $nsis.FullName -Destination $dir
  $summary.instalador = [ordered]@{ arquivo = $nsis.Name; mb = [math]::Round($nsis.Length / 1MB, 2); sha256 = (Get-FileHash $nsis.FullName -Algorithm SHA256).Hash }
  Log "Instalador: $($nsis.Name) ($($summary.instalador.mb) MB) sha256 $($summary.instalador.sha256)"
}
$exe = "apps\desktop\src-tauri\target\release\agtn-cad.exe"
if (Test-Path $exe) { $summary.exe_mb = [math]::Round((Get-Item $exe).Length / 1MB, 2) }

# pacote de validação: roda em qualquer PC Windows (W6), só com PowerShell
$pk = Join-Path $dir "pacote_validacao"
New-Item -ItemType Directory -Force -Path (Join-Path $pk "smoke\fixtures") | Out-Null
Copy-Item "scripts\windows\validar_instalado.ps1" $pk
Copy-Item "scripts\windows\smoke\webview2_smoke.ps1", "scripts\windows\smoke\agtn_smoke.js", "scripts\windows\smoke\referencias.json" (Join-Path $pk "smoke")
Copy-Item "modules\sheet3d\src\fixtures\*.agtncad" (Join-Path $pk "smoke\fixtures")
Copy-Item "tests\regressao2d\v311_desenho.agtncad" (Join-Path $pk "smoke")
if ($nsis) { Copy-Item $nsis.FullName $pk }
Log "Pacote de validação: $pk"
Pop-Location

$summary.W1 = $(if ($ok -and $nsis) { "APROVADO" } else { "REPROVADO" })
if (-not $SemValidar -and $nsis) {
  Log "== validar_instalado.ps1 (W2–W7, P2)"
  $va = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $pk "validar_instalado.ps1"), "-Instalador", (Join-Path $pk $nsis.Name), "-Out", (Join-Path $dir "instalado"))
  if ($InstaladorAnterior) { $va += @("-InstaladorAnterior", $InstaladorAnterior) }
  & powershell @va
  $summary.validacao_codigo = $LASTEXITCODE
  $rj = Join-Path $dir "instalado\resumo_instalado.json"
  if (Test-Path $rj) { $summary.validacao = ([IO.File]::ReadAllText($rj, [Text.Encoding]::UTF8) | ConvertFrom-Json).testes }
}

$summary.resultado = $(if ($ok -and $nsis) { "BUILD E TESTES OK" } else { "FALHOU — ver homologacao.log" })
if ($summary.Contains("validacao_codigo")) { $summary.resultado += $(if ($summary.validacao_codigo -eq 0) { " · VALIDAÇÃO DO INSTALADO SEM REPROVAÇÃO (ver pendentes)" } else { " · VALIDAÇÃO DO INSTALADO COM REPROVAÇÃO" }) }
$summary | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $dir "resumo.json") -Encoding UTF8
Log "Resultado: $($summary.resultado)"
Log "Pasta: $dir"
