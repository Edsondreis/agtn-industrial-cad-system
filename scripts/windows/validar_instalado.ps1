<#
.SYNOPSIS
  AGTN Industrial CAD — homologação do INSTALADOR no Windows real: W2, W3, W4, W5, W6, W7 (automático) e P2.

.DESCRIPTION
  Usa só o PowerShell 5.1 do Windows (sem Node, Rust ou Visual Studio), então pode rodar num PC "limpo" (W6).
  Sequência:
    0. sistema: Windows, CPU, RAM, GPU, resolução, WebView2, ferramentas de desenvolvimento no PATH;
    W3 (opcional, com -InstaladorAnterior): instala a versão anterior, confere, e depois instala a nova POR CIMA;
    W2. instalação silenciosa (/S) do instalador novo; registro, pasta, executável, motor 3D (occt-wasm.wasm);
    W5+W7+P2. teste de fumaça no WebView2 (smoke\webview2_smoke.ps1): abre cada projeto de referência a partir de
        uma pasta com espaço/acento, motor 3D, sólidos, booleana, planificação, DXF/DWG gravados, desenho 2D da
        v3.1.1, console sem erro de segurança, tempo/memória/CPU (-Repeticoes vezes);
    W4. desinstalação silenciosa: pasta do programa e registro removidos, projetos do usuário preservados.
  Tudo vai para -Out: homologacao_instalado.log, resumo_instalado.json e a pasta do teste de fumaça.

  ATENÇÃO: este script NÃO FOI EXECUTADO num Windows até agora. Se algum passo falhar por erro do próprio script,
  o log mostra a linha; mande o log.

.PARAMETER Instalador          setup .exe (NSIS) gerado pelo build (homologacao.ps1 copia para a pasta de saída)
.PARAMETER InstaladorAnterior  setup .exe da versão publicada (3.1.1, ou 3.1.0 da Release do GitHub) para o W3
.PARAMETER ManterInstalado     não desinstala no fim (pula o W4)
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\validar_instalado.ps1 -Instalador ".\AGTN Industrial CAD_3.1.1_x64-setup.exe"
#>
param(
  [Parameter(Mandatory = $true)][string]$Instalador,
  [string]$InstaladorAnterior = "",
  [string]$Out = "",
  [int]$Repeticoes = 3,
  [switch]$ManterInstalado
)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path "C:\AGTN_HOMOLOGACAO" ("instalado_" + (Get-Date -Format "yyyy-MM-dd_HH-mm-ss")) }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out "homologacao_instalado.log"
function Log([string]$m) { $l = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
$R = [ordered]@{ data = (Get-Date).ToString("s"); instalador = $Instalador; testes = [ordered]@{}; sistema = [ordered]@{} }
function Result([string]$id, [string]$status, [string]$detalhe) {
  $R.testes[$id] = [ordered]@{ status = $status; detalhe = $detalhe }
  Log ("{0} {1} — {2}" -f $id, $status, $detalhe)
}
function Find-App {
  foreach ($r in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")) {
    if (-not (Test-Path $r)) { continue }
    foreach ($k in Get-ChildItem $r) {
      $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
      if ($p -and $p.DisplayName -eq "AGTN Industrial CAD") { return $p }
    }
  }
  return $null
}
function App-Dir($p) {
  if ($p.InstallLocation) { return $p.InstallLocation.Trim('"').TrimEnd('\') }
  if ($p.UninstallString) { return (Split-Path -Parent ($p.UninstallString.Trim('"') -replace '"? /.*$', '')) }
  return $null
}
function Hash([string]$f) { if (Test-Path -LiteralPath $f) { return (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash } else { return $null } }
function Install([string]$setup) {
  Log "Instalando (silencioso): $setup"
  $p = Start-Process -FilePath $setup -ArgumentList "/S" -PassThru -Wait
  Start-Sleep -Seconds 2
  return $p.ExitCode
}
function Uninstall($app) {
  $u = $app.QuietUninstallString
  if (-not $u) { $u = $app.UninstallString }
  $exe = $u.Trim()
  if ($exe.StartsWith('"')) { $exe = $exe.Substring(1, $exe.IndexOf('"', 1) - 1) } else { $exe = $exe.Split(' ')[0] }
  Log "Desinstalando (silencioso): $exe /S"
  $p = Start-Process -FilePath $exe -ArgumentList "/S" -PassThru -Wait
  # o desinstalador NSIS copia-se para %TEMP% e continua; espera a pasta sumir
  for ($i = 0; $i -lt 60 -and (Find-App); $i++) { Start-Sleep -Seconds 1 }
  return $p.ExitCode
}

# ------------------------------------------------------------------ 0. sistema
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) (driver $($_.DriverVersion), $($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution))" })
$wv2 = $null
foreach ($k in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}", "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")) { if (-not $wv2) { $wv2 = (Get-ItemProperty $k -ErrorAction SilentlyContinue).pv } }
$dev = [ordered]@{}
foreach ($t in @("node", "npm", "rustc", "cargo", "python", "git")) { $c = Get-Command $t -ErrorAction SilentlyContinue; $dev[$t] = $(if ($c) { $c.Source } else { $null }) }
$R.sistema = [ordered]@{
  windows = "$($os.Caption) $($os.Version) (build $($os.BuildNumber)) $($os.OSArchitecture)"
  cpu = "$($cpu.Name.Trim()) — $($cpu.NumberOfCores) núcleos / $($cpu.NumberOfLogicalProcessors) lógicos"
  ramGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  gpu = $gpu
  webview2 = $wv2
  powershell = $PSVersionTable.PSVersion.ToString()
  ferramentasDesenvolvimento = $dev
  instaladorSha256 = (Hash $Instalador)
  instaladorVersao = (Get-Item -LiteralPath $Instalador).VersionInfo.ProductVersion
}
Log "Sistema: $($R.sistema.windows) · $($R.sistema.cpu) · $($R.sistema.ramGB) GB · WebView2 $wv2"
Log "GPU: $($gpu -join ' | ')"
Log "Instalador: $Instalador · versão $($R.sistema.instaladorVersao) · sha256 $($R.sistema.instaladorSha256)"
if (-not $wv2) { Log "AVISO: WebView2 Runtime não encontrado no registro (o instalador tenta baixar; sem internet a instalação falha)." }

# projetos do usuário (para conferir que a desinstalação não apaga nada fora da pasta do programa)
$proj = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "AGTN Homologação — não apagar"
New-Item -ItemType Directory -Force -Path $proj | Out-Null
$v311 = Join-Path $here "smoke\v311_desenho.agtncad"
if (-not (Test-Path $v311)) { $v311 = Join-Path $here "..\..\tests\regressao2d\v311_desenho.agtncad" }
Copy-Item -LiteralPath $v311 -Destination (Join-Path $proj "desenho v3.1.1 ção.agtncad") -Force
$projHash = Hash (Join-Path $proj "desenho v3.1.1 ção.agtncad")

# ------------------------------------------------------------------ W3 (opcional): anterior → nova por cima
$prev = Find-App
if ($InstaladorAnterior) {
  if ($prev) { Uninstall $prev | Out-Null }
  $ec = Install $InstaladorAnterior
  $old = Find-App
  if ($old) {
    $oldExe = Join-Path (App-Dir $old) "agtn-cad.exe"
    Log "Anterior instalada: versão $($old.DisplayVersion) em $(App-Dir $old) (exe sha256 $(Hash $oldExe))"
    $R.anterior = [ordered]@{ versao = $old.DisplayVersion; pasta = (App-Dir $old); exeSha256 = (Hash $oldExe) }
  } else { Result "W3" "REPROVADO" "instalador anterior terminou (código $ec) mas o app não aparece no registro" }
} elseif ($prev) {
  Log "Já havia uma instalação ($($prev.DisplayVersion)) — o instalador novo vai por cima (vale como atualização, não como instalação limpa)."
}

# ------------------------------------------------------------------ W2: instalação
$antes = Find-App
$ec = Install $Instalador
$app = Find-App
if (-not $app) { Result "W2" "REPROVADO" "instalador terminou com código $ec e o app não está no registro"; $R | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $Out "resumo_instalado.json") -Encoding UTF8; exit 1 }
$dir = App-Dir $app
$exe = Join-Path $dir "agtn-cad.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  # nome do binário: o do Cargo (agtn-cad) é o esperado; se mudar, usa o .exe do programa que não é o desinstalador
  $alt = Get-ChildItem -LiteralPath $dir -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "^uninstall" } | Select-Object -First 1
  if ($alt) { $exe = $alt.FullName }
}
$wasm = Join-Path $dir "occt\occt-wasm.wasm"
$wasmOk = Test-Path -LiteralPath $wasm
$R.instalado = [ordered]@{ versao = $app.DisplayVersion; pasta = $dir; exe = $exe; exeSha256 = (Hash $exe); wasm = $wasm; wasmMB = $(if ($wasmOk) { [math]::Round((Get-Item -LiteralPath $wasm).Length / 1MB, 2) } else { $null }); wasmSha256 = (Hash $wasm); atalhos = @(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter "AGTN Industrial CAD*.lnk" -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
$w2 = (Test-Path -LiteralPath $exe) -and $wasmOk -and ($ec -eq 0)
$tipo = $(if ($antes) { "por cima de $($antes.DisplayVersion)" } else { "limpa" })
Result "W2" $(if ($w2) { "APROVADO" } else { "REPROVADO" }) "instalação $tipo (código $ec); $exe; motor 3D $(if ($wasmOk) { "$($R.instalado.wasmMB) MB sha256 $($R.instalado.wasmSha256)" } else { 'AUSENTE' }); atalhos $($R.instalado.atalhos.Count)"
if ($InstaladorAnterior -and $R.anterior) {
  $mudou = $R.anterior.exeSha256 -ne $R.instalado.exeSha256
  Result "W3-instalacao" $(if ($w2 -and $mudou) { "APROVADO" } else { "REPROVADO" }) "de $($R.anterior.versao) para $($app.DisplayVersion); executável trocado: $mudou (atenção: as duas podem dizer 3.1.1 — a prova é o hash)"
}

# ------------------------------------------------------------------ W5 + W7 + P2: teste de fumaça no WebView2
$smokeOut = Join-Path $Out "webview2"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here "smoke\webview2_smoke.ps1") -Exe $exe -Out $smokeOut -Repeticoes $Repeticoes
$smokeCode = $LASTEXITCODE
$sr = $null
$srf = Join-Path $smokeOut "webview2_resultado.json"
if (Test-Path $srf) { $sr = [IO.File]::ReadAllText($srf, [Text.Encoding]::UTF8) | ConvertFrom-Json }
if ($sr) {
  $all = @($sr.execucoes | ForEach-Object { $_.testes })
  $fail = @($all | Where-Object { -not $_.ok })
  $byId = { param($rx) @($all | Where-Object { $_.id -match $rx }) }
  $grp = [ordered]@{
    "W7-abre" = "^S1$"; "W7-motor-wasm" = "^S2$"; "W7-occt" = "^S3$"; "W7-solido" = "^S4"; "W7-booleana" = "^S5$"; "W7-planificacao" = "^S6$"
    "W7-dxf" = "^S7-R(2000|12)"; "W7-dwg" = "^S7-dwg$"; "W7-seguranca" = "^S9"; "W5-caminhos" = "^(S1b|S7-disco-dxf|S8-salvar)$"; "R1-2D-v311" = "^S2D$"
  }
  foreach ($k in $grp.Keys) {
    $ts = & $byId $grp[$k]
    if ($ts.Count -eq 0) { Result $k "PENDENTE" "nenhuma verificação executada"; continue }
    $bad = @($ts | Where-Object { -not $_.ok })
    Result $k $(if ($bad.Count -eq 0) { "APROVADO" } else { "REPROVADO" }) "$($ts.Count - $bad.Count)/$($ts.Count)$(if ($bad.Count) { ' — ' + (($bad | Select-Object -First 2 | ForEach-Object { $_.id + ': ' + $_.detalhe }) -join ' || ') })"
  }
  # P2: tempos e memória por arquivo e por repetição (o mesmo arquivo não pode crescer de uma repetição para outra)
  $p2 = @($sr.execucoes | ForEach-Object { [ordered]@{ rep = $_.repeticao; arquivo = $_.arquivo; janela_ms = $_.medidas.janela_ms; motor_ms = $_.medidas.app.motorPronto_ms; regeneracao_ms = $_.medidas.app.regeneracao_ms; abertura_ms = $_.medidas.app.aberturaArquivo_ms; memoriaMB = $_.medidas.processo.memoriaMB; privadaMB = $_.medidas.processo.privadaMB; cpuS = $_.medidas.processo.cpuSegundos } })
  $R.desempenho = $p2
  $cresc = @()
  foreach ($g in ($p2 | Group-Object { $_.arquivo })) {
    $ms = @($g.Group | Sort-Object { $_.rep } | ForEach-Object { $_.privadaMB })
    if ($ms.Count -ge 2 -and $ms[-1] -gt 1.5 * $ms[0]) { $cresc += "$($g.Name): $($ms -join ' → ') MB" }
  }
  Result "P2-medicao" $(if ($p2.Count) { "APROVADO" } else { "PENDENTE" }) "$($p2.Count) medições gravadas em resumo_instalado.json (tempos e memória SÃO DADOS; não há meta aprovada pela AGTN)"
  Result "P2-estabilidade" $(if ($Repeticoes -lt 2) { "PENDENTE" } elseif ($cresc.Count -eq 0 -and $fail.Count -eq 0) { "APROVADO" } else { "REPROVADO" }) $(if ($cresc.Count) { "memória privada cresceu > 50 % entre repetições: " + ($cresc -join '; ') } else { "$Repeticoes repetições, $($all.Count) verificações, falhas $($fail.Count)" })
} else {
  Result "W7" "REPROVADO" "o teste de fumaça não gerou resultado (código $smokeCode) — ver $smokeOut\webview2.log"
}
$semDev = -not ($dev.node -or $dev.rustc -or $dev.cargo)
Result "W6" $(if (-not $sr) { "PENDENTE" } elseif (-not $semDev) { "PENDENTE" } elseif ($smokeCode -eq 0) { "APROVADO" } else { "REPROVADO" }) $(if ($semDev) { "PC sem Node/Rust no PATH; teste de fumaça código $smokeCode" } else { "este PC TEM ferramentas de desenvolvimento ($((($dev.GetEnumerator() | Where-Object { $_.Value }) | ForEach-Object { $_.Key }) -join ', ')) — repetir num PC sem elas" })

# ------------------------------------------------------------------ W4: desinstalação
if ($ManterInstalado) {
  Result "W4" "PENDENTE" "pulado (-ManterInstalado)"
} else {
  $app = Find-App
  $ec = Uninstall $app
  $restoReg = Find-App
  $restoDir = Test-Path -LiteralPath $dir
  $sobra = @()
  if ($restoDir) { $sobra = @(Get-ChildItem -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
  $projOk = (Hash (Join-Path $proj "desenho v3.1.1 ção.agtncad")) -eq $projHash
  $smokeProj = @(Get-ChildItem -LiteralPath (Join-Path $smokeOut "Projetos AGTN") -Recurse -Filter *.agtncad -ErrorAction SilentlyContinue).Count
  $dados = @("$env:LOCALAPPDATA\br.com.agtn.cad", "$env:APPDATA\br.com.agtn.cad") | Where-Object { Test-Path $_ }
  $ok4 = (-not $restoReg) -and ((-not $restoDir) -or $sobra.Count -eq 0) -and $projOk
  Result "W4" $(if ($ok4) { "APROVADO" } else { "REPROVADO" }) "código $ec; registro removido: $(-not $restoReg); pasta do programa removida: $(-not $restoDir) ($($sobra.Count) sobras); projeto do usuário intacto: $projOk; projetos do teste: $smokeProj; dados do app que ficaram (configurações/WebView2, esperado): $($dados -join ', ')"
}

$R | ConvertTo-Json -Depth 12 | Set-Content -Path (Join-Path $Out "resumo_instalado.json") -Encoding UTF8
$rep = @($R.testes.Values | Where-Object { $_.status -eq "REPROVADO" }).Count
$pen = @($R.testes.Values | Where-Object { $_.status -eq "PENDENTE" }).Count
Log "Fim: $($R.testes.Count) itens · reprovados $rep · pendentes $pen · pasta $Out"
if ($rep -gt 0) { exit 1 } else { exit 0 }
