<#
.SYNOPSIS
  AGTN Industrial CAD — FASE 5: STEP e DXF abertos pela linha de comando no app INSTALADO (WebView2 real).

.DESCRIPTION
  Para cada arquivo: abre o app instalado com o arquivo na linha de comando (cópia numa pasta com espaço e acento),
  liga a depuração do WebView2 só para este processo (perfil isolado), injeta step_smoke.js e confere:
    STEP: abre no visualizador (documento próprio, só leitura), estado final, sólidos/volume/área/caixa contra
          referência independente, unidade do arquivo, corpos inválidos sinalizados, 7 vistas, enquadrar, arame/sólido;
          memória do processo do app + WebView2 com o documento aberto e depois de fechar; fecha e volta ao desenho.
    DXF : abre no desenho, objetos, unidade explícita, não suportadas avisadas, desenho sem caminho (Salvar pede
          .agtncad) e o .dxf com o MESMO SHA-256 antes e depois (somente leitura).
    Todos: console sem violação de CSP/segurança (página e worker).
  Não altera nada do app instalado. Saída em -Out: step.log, step_resultado.json.
#>
param(
  [string]$Exe = "",
  [string]$Out = "",
  [int]$Port = 9334,
  [string]$StepDir = "",
  [string]$BigDir = "",
  [string]$PfDir = "",
  [string]$DxfDir = "",
  [string[]]$Arquivos = @("box_100x50x20.step", "inch_block_2x1x0.5.step", "tank_assembly.step", "cone_sphere_torus.step", "vessel_revolved.step", "elipsoide_vertex_loop.step", "vessel_inconsistente.step", "fusion_srr_assembly.step", "grande_120_caixas.step", "grande_400_placas.step", "nao_step.step", "vazio.stp", "cobertura_r12.dxf", "cobertura_r2000.dxf", "unidade_cm.dxf"),
  [int]$TimeoutS = 600
)
$ErrorActionPreference = "Stop"
# chamado com powershell -File, uma lista chega como texto único "a,b": separa aqui
if ($Arquivos.Count -eq 1 -and $Arquivos[0] -match ",") { $Arquivos = @($Arquivos[0] -split "\s*,\s*" | Where-Object { $_ }) }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path $env:TEMP ("AGTN_STEP_" + (Get-Date -Format "yyyyMMdd_HHmmss")) }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out "step.log"
function Log([string]$m) { $l = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }

function Find-App {
  $roots = @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")
  foreach ($r in $roots) {
    if (-not (Test-Path $r)) { continue }
    foreach ($k in Get-ChildItem $r) {
      $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
      if ($p -and $p.DisplayName -eq "AGTN Industrial CAD") { return $p }
    }
  }
  return $null
}
function Get-WebView2Version {
  $keys = @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}", "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}")
  foreach ($k in $keys) { $v = (Get-ItemProperty $k -ErrorAction SilentlyContinue).pv; if ($v) { return $v } }
  return $null
}


$inst = Find-App
if (-not $Exe -and $inst -and $inst.InstallLocation) { $Exe = Join-Path ($inst.InstallLocation.Trim('"')) "agtn-cad.exe" }
if (-not $Exe -or -not (Test-Path $Exe)) { Log "ERRO: app instalado não encontrado (informe -Exe)."; exit 2 }
$repo = Join-Path $here "..\..\.."
if (-not $StepDir) { $StepDir = Join-Path $repo "tests\step\viewer_ref" }
if (-not $BigDir) { $BigDir = Join-Path $repo "tests\output\step" }
if (-not $PfDir) { $PfDir = Join-Path $repo "tests\step\p-f5-01" }
if (-not $DxfDir) { $DxfDir = Join-Path $repo "tests\dxf\fixtures\fase5" }
$js = [IO.File]::ReadAllText((Join-Path $here "step_smoke.js"), [Text.Encoding]::UTF8)
$refAll = [IO.File]::ReadAllText((Join-Path $here "referencias_step.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$dxfRef = @{
  "cobertura_r12.dxf"   = @{ objetos = 10; unidade = "não declarada.*sem escala" }
  "cobertura_r2000.dxf" = @{ objetos = 15; unidade = "Unidade do arquivo: mm"; naoSuportadas = "3DFACE.*RAY.*XLINE|3DFACE" }
  "unidade_cm.dxf"      = @{ objetos = 2; unidade = "×10" }
}
$exeVer = (Get-Item $Exe).VersionInfo
Log "App: $Exe (arquivo $($exeVer.FileVersion); registro $($inst.DisplayVersion))"
$pasta = Join-Path $Out "Modelos AGTN\Peça ção #5 (rev.2)"
New-Item -ItemType Directory -Force -Path $pasta | Out-Null
[IO.File]::WriteAllText((Join-Path $pasta "nao_step.step"), "isto não é STEP`n", (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllBytes((Join-Path $pasta "vazio.stp"), [byte[]]@())

# ------------------------------------------------------------------ cliente CDP mínimo (WebSocket)
$script:ws = $null
$script:pending = $null
$script:buf = New-Object byte[] 4194304
$script:acc = New-Object System.IO.MemoryStream
$script:nextId = 0
$script:events = New-Object System.Collections.ArrayList

function Cdp-Connect([string]$url) {
  $script:ws = New-Object System.Net.WebSockets.ClientWebSocket
  $script:ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
  $script:ws.ConnectAsync([Uri]$url, [Threading.CancellationToken]::None).Wait(15000) | Out-Null
  if ($script:ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) { throw "WebSocket CDP não abriu ($($script:ws.State))" }
  $script:pending = $null
}
function Cdp-Close { try { $script:ws.Dispose() } catch { } ; $script:ws = $null; $script:pending = $null }
function Cdp-Read([int]$ms) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds($ms)
  while ($true) {
    if (-not $script:pending) {
      $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList (, $script:buf)
      $script:pending = $script:ws.ReceiveAsync($seg, [Threading.CancellationToken]::None)
    }
    $left = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds
    if ($left -le 0) { return $null }
    if (-not $script:pending.Wait($left)) { return $null }
    $r = $script:pending.Result
    $script:pending = $null
    if ($r.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw "CDP fechou a conexão" }
    $script:acc.Write($script:buf, 0, $r.Count)
    if ($r.EndOfMessage) {
      $s = [Text.Encoding]::UTF8.GetString($script:acc.ToArray())
      $script:acc.SetLength(0)
      return $s
    }
  }
}
function Cdp-Event($m) {
  # guarda o que interessa: console, exceções, log (inclui CSP/segurança) — da página e dos workers
  $null = $script:events.Add([ordered]@{ t = (Get-Date).ToString("HH:mm:ss.fff"); sessao = $m.sessionId; metodo = $m.method; params = $m.params })
  if ($m.method -eq "Target.attachedToTarget") {
    $sid = $m.params.sessionId
    foreach ($meth in @("Runtime.enable", "Log.enable")) { Cdp-Send $meth @{} $sid | Out-Null }
    Cdp-Send "Runtime.runIfWaitingForDebugger" @{} $sid | Out-Null
  }
}
function Cdp-Send([string]$method, $params, [string]$session = "") {
  $script:nextId++
  $msg = [ordered]@{ id = $script:nextId; method = $method; params = $params }
  if ($session) { $msg.sessionId = $session }
  $json = $msg | ConvertTo-Json -Depth 30 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList (, $bytes)
  $script:ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait() | Out-Null
  return $script:nextId
}
function Cdp-Call([string]$method, $params, [int]$ms = 30000, [string]$session = "") {
  $id = Cdp-Send $method $params $session
  $deadline = [DateTime]::UtcNow.AddMilliseconds($ms)
  while ($true) {
    $left = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds
    if ($left -le 0) { throw "CDP: sem resposta para $method em $ms ms" }
    $s = Cdp-Read $left
    if ($null -eq $s) { continue }
    $m = $s | ConvertFrom-Json
    $sameSession = $(if ($session) { $m.sessionId -eq $session } else { -not $m.sessionId })
    if ($m.id -eq $id -and $sameSession) {
      if ($m.error) { throw "CDP $method : $($m.error.message)" }
      return $m.result
    }
    if ($m.method) { Cdp-Event $m }
  }
}
function Js-Eval([string]$expr, [int]$ms = 30000, [bool]$await = $false) {
  $r = Cdp-Call "Runtime.evaluate" @{ expression = $expr; returnByValue = $true; awaitPromise = $await } $ms
  if ($r.exceptionDetails) { throw "JS: $($r.exceptionDetails.exception.description)" }
  return $r.result.value
}

# ------------------------------------------------------------------ processos (app + WebView2 filhos)
function Get-Tree([int]$root) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, WorkingSetSize, PrivatePageCount
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($root)
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $grew = $true } }
  }
  return @($all | Where-Object { $ids.Contains([int]$_.ProcessId) })
}
function Measure-Tree([int]$root) {
  $t = Get-Tree $root
  $cpu = 0.0
  foreach ($p in $t) { $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($gp) { $cpu += $gp.TotalProcessorTime.TotalSeconds } }
  return [ordered]@{
    processos = $t.Count
    nomes = (($t | Group-Object Name | ForEach-Object { "$($_.Name)×$($_.Count)" }) -join ", ")
    memoriaMB = [math]::Round((($t | Measure-Object WorkingSetSize -Sum).Sum) / 1MB, 1)
    privadaMB = [math]::Round((($t | Measure-Object PrivatePageCount -Sum).Sum) / 1MB, 1)
    cpuSegundos = [math]::Round($cpu, 2)
  }
}


$initJs = "try { localStorage.setItem('agtn.e2e', '1') } catch (e) { } window.__agtnCsp = window.__agtnCsp || []; document.addEventListener('securitypolicyviolation', function (e) { window.__agtnCsp.push({ d: e.violatedDirective, u: e.blockedURI }); });"
$resultados = New-Object System.Collections.ArrayList
foreach ($f in $Arquivos) {
  $dst = Join-Path $pasta $f
  if (-not (Test-Path -LiteralPath $dst)) {
    $orig = $null
    foreach ($d in @($StepDir, $PfDir, $BigDir, $DxfDir)) { $c = Join-Path $d $f; if (Test-Path -LiteralPath $c) { $orig = $c; break } }
    if (-not $orig) { [void]$resultados.Add([ordered]@{ arquivo = $f; testes = @([ordered]@{ id = "SX"; nome = "arquivo de teste"; ok = $false; detalhe = "não encontrado em $StepDir / $BigDir / $DxfDir" }) }); Log "FAIL $f — arquivo de teste ausente"; continue }
    Copy-Item -LiteralPath $orig -Destination $dst -Force
  }
  $isDxf = $f -match "\.dxf$"
  $hashAntes = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
  $script:events = New-Object System.Collections.ArrayList
  $udf = Join-Path $Out ("wv2data_" + ($f -replace '[^A-Za-z0-9]', '_'))
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --remote-allow-origins=*"
  $env:WEBVIEW2_USER_DATA_FOLDER = $udf
  Log "$f — abrindo o app ($((Get-Item -LiteralPath $dst).Length) bytes)"
  $t0 = Get-Date
  $proc = Start-Process -FilePath $Exe -ArgumentList ('"' + $dst + '"') -PassThru
  Remove-Item Env:\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
  Remove-Item Env:\WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  $res = [ordered]@{ arquivo = $f; bytes = (Get-Item -LiteralPath $dst).Length; testes = @(); medidas = [ordered]@{} }
  try {
    $page = $null
    $deadline = (Get-Date).AddSeconds(60)
    while (-not $page -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 250
      if ($proc.HasExited) { throw "o app fechou sozinho (código $($proc.ExitCode))" }
      try { $list = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2 } catch { $list = $null }
      if ($list) { $page = @($list | Where-Object { $_.type -eq "page" -and $_.url -match "tauri\.localhost|^tauri:" }) | Select-Object -First 1 }
    }
    if (-not $page) { throw "a página do app não apareceu no WebView2 em 60 s" }
    Cdp-Connect $page.webSocketDebuggerUrl
    Cdp-Call "Runtime.enable" @{} | Out-Null
    Cdp-Call "Log.enable" @{} | Out-Null
    Cdp-Call "Page.enable" @{} | Out-Null
    Cdp-Call "Target.setAutoAttach" @{ autoAttach = $true; waitForDebuggerOnStart = $false; flatten = $true } | Out-Null
    $carregou = $false
    for ($i = 0; $i -lt 240 -and -not $carregou; $i++) { try { $carregou = [bool](Js-Eval "location.origin.indexOf('tauri') >= 0 && document.readyState === 'complete'" 5000) } catch { $carregou = $false }; if (-not $carregou) { Start-Sleep -Milliseconds 250 } }
    if (-not $carregou) { throw "a página do app não carregou" }
    # recarrega com o gancho de teste e o ouvinte de CSP desde o primeiro script (o arquivo da linha de comando reabre)
    Cdp-Call "Page.addScriptToEvaluateOnNewDocument" @{ source = $initJs } | Out-Null
    Cdp-Call "Page.reload" @{ ignoreCache = $true } | Out-Null
    $ok = $false
    for ($i = 0; $i -lt 120 -and -not $ok; $i++) { Start-Sleep -Milliseconds 250; try { $ok = (Js-Eval "document.readyState === 'complete' && !!window.__agtn2d" 5000) } catch { $ok = $false } }
    Js-Eval $js 30000 | Out-Null
    if ($isDxf) {
      $cfg = @{ arquivo = $f; ref = $dxfRef[$f] } | ConvertTo-Json -Depth 10 -Compress
      $r = Js-Eval ("window.__agtnDxfSmoke(" + $cfg + ")") 120000 $true
      $res.testes = @($r.testes)
      $res.medidas.app = $r.medidas
    } else {
      $ref = $refAll.$f
      $cfg = @{ arquivo = $f; ref = $ref; timeoutMs = ($TimeoutS * 1000) } | ConvertTo-Json -Depth 10 -Compress
      $r = Js-Eval ("window.__agtnStepSmoke(" + $cfg + ")") (($TimeoutS + 60) * 1000) $true
      $res.testes = @($r.testes)
      $res.medidas.app = $r.medidas
      if (-not $ref.falha) {
        Start-Sleep -Seconds 2
        $aberto = Measure-Tree $proc.Id
        $c = Js-Eval "window.__agtnStepClose()" 30000 $true
        $res.testes += @($c.testes)
        Start-Sleep -Seconds 5
        $fechado = Measure-Tree $proc.Id
        $res.medidas.processoAberto = $aberto
        $res.medidas.processoFechado = $fechado
        $grande = $f -match "^grande_"
        $okMem = $(if ($grande) { $fechado.privadaMB -lt $aberto.privadaMB } else { $fechado.privadaMB -le $aberto.privadaMB + 5 })
        $res.testes += [ordered]@{ id = "P14"; nome = "memória (app + WebView2) não cresce depois de fechar o documento"; ok = $okMem; detalhe = "privada $($aberto.privadaMB) MB aberto → $($fechado.privadaMB) MB fechado; conjunto de trabalho $($aberto.memoriaMB) → $($fechado.memoriaMB) MB; processos $($aberto.processos) → $($fechado.processos)" }
      }
    }
    Start-Sleep -Milliseconds 500
    while ($true) { $s = Cdp-Read 300; if ($null -eq $s) { break }; $m = $s | ConvertFrom-Json; if ($m.method) { Cdp-Event $m } }
    $csp = Js-Eval "JSON.stringify(window.__agtnCsp || [])" 5000
    $sec = @($script:events | Where-Object {
        ($_.metodo -eq "Log.entryAdded" -and ($_.params.entry.source -match "security|violation" -or $_.params.entry.text -match "Content Security Policy|Refused to")) -or
        ($_.metodo -eq "Runtime.exceptionThrown" -and $_.params.exceptionDetails.exception.description -match "Content Security Policy|Refused|EvalError")
      })
    $res.testes += [ordered]@{ id = "S9"; nome = "sem violação de CSP/segurança (página e worker)"; ok = ($sec.Count -eq 0 -and $csp -eq "[]"); detalhe = "eventos $($script:events.Count); segurança $($sec.Count); securitypolicyviolation $csp" }
    $res.medidas.processo = Measure-Tree $proc.Id
  } catch {
    $res.testes += [ordered]@{ id = "SX"; nome = "execução do teste"; ok = $false; detalhe = $_.Exception.Message }
    Log "  ERRO: $($_.Exception.Message)"
  } finally {
    Cdp-Close
    if (-not $proc.HasExited) {
      try { $null = $proc.CloseMainWindow(); $proc.WaitForExit(8000) | Out-Null } catch { }
      if (-not $proc.HasExited) { Get-Tree $proc.Id | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
    }
    Start-Sleep -Seconds 2
  }
  $hashDepois = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash
  $res.testes += [ordered]@{ id = "RO"; nome = "arquivo de origem intacto (mesmo SHA-256 antes e depois)"; ok = ($hashAntes -eq $hashDepois); detalhe = $hashDepois }
  foreach ($t in $res.testes) { Log ("  {0} {1} {2} — {3}" -f $(if ($t.ok) { "PASS" } else { "FAIL" }), $t.id, $t.nome, ([string]$t.detalhe).Substring(0, [math]::Min(200, ([string]$t.detalhe).Length))) }
  [void]$resultados.Add($res)
}
$todos = @($resultados | ForEach-Object { $_.testes })
$okN = @($todos | Where-Object { $_.ok }).Count
$resumo = [ordered]@{ data = (Get-Date).ToString("s"); app = $Exe; versaoArquivo = $exeVer.FileVersion; versaoRegistro = $inst.DisplayVersion; verificacoes = $todos.Count; aprovadas = $okN; resultado = $(if ($todos.Count -gt 0 -and $okN -eq $todos.Count) { "APROVADO" } else { "REPROVADO" }); execucoes = $resultados }
($resumo | ConvertTo-Json -Depth 14) | Set-Content -Path (Join-Path $Out "step_resultado.json") -Encoding UTF8
Log "STEP/DXF no app instalado: $okN/$($todos.Count) verificações — $($resumo.resultado)"
if ($resumo.resultado -eq "APROVADO") { exit 0 } else { exit 1 }
