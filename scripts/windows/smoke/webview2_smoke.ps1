<#
.SYNOPSIS
  AGTN Industrial CAD — teste de fumaça no WebView2 REAL (FASE 4 · ETAPA 4, W7 automático + P2).

.DESCRIPTION
  Roda no Windows com o app JÁ INSTALADO. Não precisa de Node, Rust, Python nem Visual Studio (serve para o W6):
  só o PowerShell 5.1 do Windows e o WebView2 do sistema.

  Para cada projeto de referência:
    1. abre o app instalado com o arquivo na linha de comando (cópia numa pasta com espaço e acento);
    2. liga a depuração do WebView2 só para este processo (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
       --remote-debugging-port) e uma pasta de dados própria (não mexe no perfil do usuário);
    3. pelo protocolo de depuração (CDP): escuta console, erros e violações de segurança da página E do worker do
       motor; injeta agtn_smoke.js e roda as verificações S1–S9 (app abre, WASM, OCCT, sólido, booleana,
       planificação, DXF R2000/R12 com SHA-256 igual ao de referência, gravação de DXF/DWG/.agtncad pelo Rust);
    4. mede tempo de abertura, memória e CPU do processo do app + processos do WebView2;
    5. fecha o app.

  Saída (pasta -Out): webview2.log, webview2_resultado.json, console_<arquivo>.json.
  NÃO altera nada do app instalado. Os arquivos de teste ficam em -Out.

  ATENÇÃO: este script NÃO FOI EXECUTADO num Windows até agora (o ambiente de desenvolvimento não tem Windows).
  O conteúdo injetado (agtn_smoke.js) foi validado no app Tauri compilado no Linux e no Chromium.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\webview2_smoke.ps1 -Out C:\AGTN_HOMOLOGACAO\teste
#>
param(
  [string]$Exe = "",
  [string]$Out = "",
  [int]$Port = 9333,
  [string]$Fixtures = "",
  [string[]]$Arquivos = @("etapa2_completo.agtncad", "fase3_peca_parametrica.agtncad", "fase2_projeto_3d.agtncad", "etapa1_chapa.agtncad", "grande_120furos.agtncad"),
  [int]$Repeticoes = 1,
  [int]$TimeoutS = 300
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Out) { $Out = Join-Path $env:TEMP ("AGTN_WEBVIEW2_" + (Get-Date -Format "yyyyMMdd_HHmmss")) }
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out "webview2.log"
function Log([string]$m) { $l = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }

# ------------------------------------------------------------------ localizar app, WebView2 e arquivos
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
if (-not $Exe) {
  if ($inst -and $inst.InstallLocation) { $Exe = Join-Path ($inst.InstallLocation.Trim('"')) "agtn-cad.exe" }
  elseif ($inst -and $inst.DisplayIcon) { $Exe = $inst.DisplayIcon.Trim('"').Split(',')[0] }
}
if ($Exe -and -not (Test-Path $Exe) -and $inst -and $inst.InstallLocation) {
  $alt = Get-ChildItem -LiteralPath ($inst.InstallLocation.Trim('"')) -Filter *.exe -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "^uninstall" } | Select-Object -First 1
  if ($alt) { $Exe = $alt.FullName }
}
if (-not $Exe -or -not (Test-Path $Exe)) { Log "ERRO: app instalado não encontrado (informe -Exe)."; exit 2 }
if (-not $Fixtures) {
  $cands = @((Join-Path $here "fixtures"), (Join-Path $here "..\..\..\modules\sheet3d\src\fixtures"))
  foreach ($c in $cands) { if (Test-Path (Join-Path $c "etapa2_completo.agtncad")) { $Fixtures = (Resolve-Path $c).Path; break } }
}
$js = [IO.File]::ReadAllText((Join-Path $here "agtn_smoke.js"), [Text.Encoding]::UTF8)
$refAll = [IO.File]::ReadAllText((Join-Path $here "referencias.json"), [Text.Encoding]::UTF8) | ConvertFrom-Json
$wv2 = Get-WebView2Version
$exeVer = (Get-Item $Exe).VersionInfo
Log "App: $Exe (versão do arquivo $($exeVer.FileVersion); registro $($inst.DisplayVersion))"
Log "WebView2 Runtime: $(if ($wv2) { $wv2 } else { 'NÃO ENCONTRADO no registro' })"
Log "Projetos de referência: $Fixtures"

# pasta de trabalho com espaço, acento e símbolos (W5)
$pasta = Join-Path $Out "Projetos AGTN\Peça ção #1 (rev.2)"
New-Item -ItemType Directory -Force -Path $pasta | Out-Null

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
function Cdp-Call([string]$method, $params, [int]$ms = 30000) {
  $id = Cdp-Send $method $params
  $deadline = [DateTime]::UtcNow.AddMilliseconds($ms)
  while ($true) {
    $left = [int]($deadline - [DateTime]::UtcNow).TotalMilliseconds
    if ($left -le 0) { throw "CDP: sem resposta para $method em $ms ms" }
    $s = Cdp-Read $left
    if ($null -eq $s) { continue }
    $m = $s | ConvertFrom-Json
    if ($m.id -eq $id -and -not $m.sessionId) {
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

# ------------------------------------------------------------------ execução
$cspListener = "window.__agtnCsp = window.__agtnCsp || []; document.addEventListener('securitypolicyviolation', function (e) { window.__agtnCsp.push({ d: e.violatedDirective, u: e.blockedURI, s: e.sourceFile }); });"
$casos = New-Object System.Collections.ArrayList
foreach ($f in $Arquivos) { [void]$casos.Add(@{ arquivo = $f; origem = (Join-Path $Fixtures $f); cfg = @{ ref = $refAll.$f } }) }
$v311 = Join-Path $here "v311_desenho.agtncad"
if (-not (Test-Path $v311)) { $v311 = Join-Path $here "..\..\..\tests\regressao2d\v311_desenho.agtncad" }
if (Test-Path $v311) { [void]$casos.Add(@{ arquivo = "v311_desenho.agtncad"; origem = $v311; cfg = @{ objetos2D = 114; somente2D = $true } }) }

$resultados = New-Object System.Collections.ArrayList
for ($rep = 1; $rep -le $Repeticoes; $rep++) {
  foreach ($c in $casos) {
    $f = $c.arquivo
    $dst = Join-Path $pasta $f
    Copy-Item -LiteralPath $c.origem -Destination $dst -Force
    $script:events = New-Object System.Collections.ArrayList
    $udf = Join-Path $Out ("wv2data_" + $rep + "_" + ($f -replace '[^A-Za-z0-9]', '_'))
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --remote-allow-origins=*"
    $env:WEBVIEW2_USER_DATA_FOLDER = $udf
    Log "[$rep/$Repeticoes] $f — abrindo o app"
    $t0 = Get-Date
    $proc = Start-Process -FilePath $Exe -ArgumentList ('"' + $dst + '"') -PassThru
    Remove-Item Env:\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    Remove-Item Env:\WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
    $res = [ordered]@{ repeticao = $rep; arquivo = $f; pid = $proc.Id; testes = @(); medidas = [ordered]@{} }
    try {
      # 1) página do app aparece no CDP
      $page = $null
      $deadline = (Get-Date).AddSeconds(60)
      while (-not $page -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        if ($proc.HasExited) { throw "o app fechou sozinho (código $($proc.ExitCode))" }
        try { $list = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2 } catch { $list = $null }
        if ($list) { $page = @($list | Where-Object { $_.type -eq "page" -and $_.url -match "tauri\.localhost|^tauri:" }) | Select-Object -First 1 }
      }
      if (-not $page) { throw "a página do app não apareceu no WebView2 em 60 s (CDP na porta $Port)" }
      $res.medidas.janela_ms = [int]((Get-Date) - $t0).TotalMilliseconds
      $res.medidas.url = $page.url
      $ver = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 5
      $res.medidas.navegador = $ver.Browser
      $res.medidas.userAgent = $ver.'User-Agent'
      Cdp-Connect $page.webSocketDebuggerUrl
      Cdp-Call "Runtime.enable" @{} | Out-Null
      Cdp-Call "Log.enable" @{} | Out-Null
      Cdp-Call "Page.enable" @{} | Out-Null
      Cdp-Call "Target.setAutoAttach" @{ autoAttach = $true; waitForDebuggerOnStart = $false; flatten = $true } | Out-Null
      # 2) recarrega com o ouvinte de CSP instalado desde o primeiro script (o arquivo da linha de comando reabre)
      Cdp-Call "Page.addScriptToEvaluateOnNewDocument" @{ source = $cspListener } | Out-Null
      $tr = Get-Date
      Cdp-Call "Page.reload" @{ ignoreCache = $true } | Out-Null
      $ok = $false
      for ($i = 0; $i -lt 120 -and -not $ok; $i++) { Start-Sleep -Milliseconds 250; try { $ok = (Js-Eval "document.readyState === 'complete'" 5000) } catch { $ok = $false } }
      $res.medidas.recarga_ms = [int]((Get-Date) - $tr).TotalMilliseconds
      # 3) teste de fumaça dentro da página
      Js-Eval $js 30000 | Out-Null
      $cfg = @{ arquivo = $f; pastaSaida = $pasta; esperarTitulo = $true }
      foreach ($k in $c.cfg.Keys) { $cfg[$k] = $c.cfg[$k] }
      $cfgJson = $cfg | ConvertTo-Json -Depth 30 -Compress
      $r = Js-Eval ("window.__agtnSmoke(" + $cfgJson + ")") ($TimeoutS * 1000) $true
      $res.testes = @($r.testes)
      $res.medidas.app = $r.medidas
      # 4) eventos de console/segurança recolhidos (página + worker)
      Start-Sleep -Milliseconds 500
      while ($true) { $s = Cdp-Read 300; if ($null -eq $s) { break }; $m = $s | ConvertFrom-Json; if ($m.method) { Cdp-Event $m } }
      $sec = @($script:events | Where-Object {
          ($_.metodo -eq "Log.entryAdded" -and ($_.params.entry.source -match "security|violation" -or $_.params.entry.text -match "Content Security Policy|Refused to")) -or
          ($_.metodo -eq "Runtime.consoleAPICalled" -and (($_.params.args | ForEach-Object { $_.value }) -join " ") -match "Content Security Policy|Refused to") -or
          ($_.metodo -eq "Runtime.exceptionThrown" -and $_.params.exceptionDetails.exception.description -match "Content Security Policy|Refused|EvalError")
        })
      $workers = @($script:events | Where-Object { $_.metodo -eq "Target.attachedToTarget" } | ForEach-Object { $_.params.targetInfo.type + " " + $_.params.targetInfo.url })
      $exc = @($script:events | Where-Object { $_.metodo -eq "Runtime.exceptionThrown" })
      $res.testes += [ordered]@{ id = "S9-cdp"; nome = "console sem erro de segurança (página e worker, via CDP)"; ok = ($sec.Count -eq 0); detalhe = "$($script:events.Count) eventos; segurança $($sec.Count); exceções $($exc.Count); alvos: $($workers -join ' | ')"; ms = $null }
      $res.medidas.processo = Measure-Tree $proc.Id
      ($script:events | ConvertTo-Json -Depth 12) | Set-Content -Path (Join-Path $Out ("console_" + $rep + "_" + $f + ".json")) -Encoding UTF8
    } catch {
      $res.testes += [ordered]@{ id = "SX"; nome = "execução do teste"; ok = $false; detalhe = $_.Exception.Message; ms = $null }
      Log "  ERRO: $($_.Exception.Message)"
    } finally {
      Cdp-Close
      if (-not $proc.HasExited) {
        try { $null = $proc.CloseMainWindow(); $proc.WaitForExit(8000) | Out-Null } catch { }
        if (-not $proc.HasExited) { Get-Tree $proc.Id | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
      }
      Start-Sleep -Seconds 2
    }
    foreach ($t in $res.testes) { Log ("  {0} {1} {2} — {3}" -f $(if ($t.ok) { "PASS" } else { "FAIL" }), $t.id, $t.nome, ([string]$t.detalhe).Substring(0, [math]::Min(180, ([string]$t.detalhe).Length))) }
    [void]$resultados.Add($res)
  }
}

$todos = @($resultados | ForEach-Object { $_.testes })
$okN = @($todos | Where-Object { $_.ok }).Count
$resumo = [ordered]@{
  data = (Get-Date).ToString("s")
  app = $Exe
  versaoArquivo = $exeVer.FileVersion
  versaoRegistro = $inst.DisplayVersion
  webview2 = $wv2
  windows = (Get-CimInstance Win32_OperatingSystem).Caption + " " + (Get-CimInstance Win32_OperatingSystem).Version
  verificacoes = $todos.Count
  aprovadas = $okN
  resultado = $(if ($todos.Count -gt 0 -and $okN -eq $todos.Count) { "APROVADO" } else { "REPROVADO" })
  execucoes = $resultados
}
($resumo | ConvertTo-Json -Depth 14) | Set-Content -Path (Join-Path $Out "webview2_resultado.json") -Encoding UTF8
Log "WebView2: $okN/$($todos.Count) verificações OK — $($resumo.resultado)"
Log "Pasta: $Out"
if ($resumo.resultado -eq "APROVADO") { exit 0 } else { exit 1 }
