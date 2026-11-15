# AGTN ETAPA 6 - passo 04: W2 (auditoria do instalador), W3 (instalacao limpa), W4 (atualizacao sobre 3.1.1 e desinstalacao), W6 (sem ferramentas).
# Sem UAC (instalador em modo currentUser). Nao apaga dados pessoais. Estado final: nenhum AGTN instalado (como antes).
param([int]$Repeticoes = 3)
$ErrorActionPreference = "Continue"
$R = "D:\AGTN_DEV"; $H = "$R\homologacao"; $S = "$R\src\agtn"; $M = "$R\src\ref311"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"; $O = "$H\ciclo_$stamp"; New-Item -ItemType Directory -Force $O | Out-Null
$log = "$O\ciclo.log"
$RES = [ordered]@{ inicio = (Get-Date -Format s); itens = [ordered]@{}; dados = [ordered]@{} }
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format s), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
function Item($id, $status, $det) { $RES.itens[$id] = [ordered]@{ status = $status; detalhe = $det }; Log ("{0} {1} - {2}" -f $id, $status, $det) }
function Save { $RES.fim = (Get-Date -Format s); $RES | ConvertTo-Json -Depth 12 | Set-Content "$O\ciclo_resumo.json" -Encoding UTF8 }
function Hash($f) { if (Test-Path -LiteralPath $f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash } else { $null } }
function PeMachine($f) { $fs = [IO.File]::OpenRead($f); $b = New-Object byte[] 4096; [void]$fs.Read($b, 0, 4096); $fs.Close(); $pe = [BitConverter]::ToInt32($b, 0x3C); $m = [BitConverter]::ToUInt16($b, $pe + 4); switch ($m) { 0x8664 { "x64" } 0x14c { "x86" } 0xAA64 { "ARM64" } default { "0x{0:X}" -f $m } } }
function Find-Apps { $o = @(); foreach ($r in "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall") { Get-ChildItem $r -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; if ($p.DisplayName -like "AGTN Industrial CAD*") { $o += $p } } }; return ,$o }
function App-Dir($p) { if ($p.InstallLocation) { return $p.InstallLocation.Trim('"').TrimEnd('\') }; return (Split-Path -Parent ($p.UninstallString.Trim('"') -replace '"? /.*$', '')) }
function Shortcuts { @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", [Environment]::GetFolderPath("Desktop"), "$env:PUBLIC\Desktop", "$env:USERPROFILE\Desktop") | Select-Object -Unique | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -Filter "AGTN Industrial CAD*.lnk" -ErrorAction SilentlyContinue } | ForEach-Object { $_.FullName } }
function Assoc { [ordered]@{ agtncad = (Get-ItemProperty "HKCU:\Software\Classes\.agtncad" -ErrorAction SilentlyContinue).'(default)'; dxf = (Get-ItemProperty "HKCU:\Software\Classes\.dxf" -ErrorAction SilentlyContinue).'(default)'; dwg = (Get-ItemProperty "HKCU:\Software\Classes\.dwg" -ErrorAction SilentlyContinue).'(default)'; dxfUserChoice = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.dxf\UserChoice" -ErrorAction SilentlyContinue).ProgId; dwgUserChoice = (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.dwg\UserChoice" -ErrorAction SilentlyContinue).ProgId; prefAGTN = (Test-Path "HKCU:\Software\AGTN\AGTN Industrial CAD") } }
function Snap($dir) { $h = [ordered]@{}; if (Test-Path -LiteralPath $dir) { Get-ChildItem -LiteralPath $dir -Recurse -File -Force -ErrorAction SilentlyContinue | Sort-Object FullName | ForEach-Object { $h[$_.FullName.Substring($dir.Length)] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } }; return $h }
function Install($setup, $tag) { Log "instalando (/S): $setup"; $t0 = Get-Date; $p = Start-Process -FilePath $setup -ArgumentList "/S" -PassThru -Wait; Start-Sleep 3; $RES.dados["tempo_instalar_$tag"] = [int]((Get-Date) - $t0).TotalSeconds; return $p.ExitCode }
function Uninstall($app, $tag) {
  $u = $app.QuietUninstallString; if (-not $u) { $u = $app.UninstallString }
  $exe = $u.Trim(); if ($exe.StartsWith('"')) { $exe = $exe.Substring(1, $exe.IndexOf('"', 1) - 1) } else { $exe = $exe.Split(' ')[0] }
  Log "desinstalando (/S): $exe"; $t0 = Get-Date
  $p = Start-Process -FilePath $exe -ArgumentList "/S" -PassThru -Wait
  for ($i = 0; $i -lt 90 -and (Find-Apps).Count -gt 0; $i++) { Start-Sleep 1 }
  Start-Sleep 3; $RES.dados["tempo_desinstalar_$tag"] = [int]((Get-Date) - $t0).TotalSeconds
  return $p.ExitCode
}
# abre o app e devolve o processo com janela (ou $null)
function Open-App($file, $arg, $tag) {
  $t0 = Get-Date
  if ($arg) { $p = Start-Process -FilePath $file -ArgumentList ('"' + $arg + '"') -PassThru } else { $p = Start-Process -FilePath $file -PassThru }
  $app = $null
  for ($i = 0; $i -lt 120 -and -not $app; $i++) { Start-Sleep -Milliseconds 500; $app = Get-Process -Name "agtn-cad" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
  if ($app) { $RES.dados["janela_ms_$tag"] = [int]((Get-Date) - $t0).TotalMilliseconds }
  return $app
}
function Close-App($app) { if (-not $app) { return $true }; [void]$app.CloseMainWindow(); for ($i = 0; $i -lt 40 -and -not $app.HasExited; $i++) { Start-Sleep -Milliseconds 500; $app.Refresh() }; if (-not $app.HasExited) { Log "  app nao fechou pela janela; encerrando"; Stop-Process -Id $app.Id -Force; return $false }; return $true }
# --- CDP minimo: le o localStorage do PERFIL REAL do usuario (para provar que as preferencias/recentes sobrevivem a atualizacao)
function Read-Recents($exe, $tag) {
  $port = 9447
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --remote-allow-origins=*"
  $p = Start-Process -FilePath $exe -PassThru
  Remove-Item Env:\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  $page = $null
  for ($i = 0; $i -lt 120 -and -not $page; $i++) { Start-Sleep -Milliseconds 500; try { $page = @(Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 2) | Where-Object { $_.type -eq "page" -and $_.url -match "tauri\.localhost" } | Select-Object -First 1 } catch {} }
  $val = $null
  if ($page) {
    Start-Sleep 3
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait(15000) | Out-Null
    $msg = '{"id":1,"method":"Runtime.evaluate","params":{"expression":"localStorage.getItem(\"agtncad.recents.v1\")","returnByValue":true}}'
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $ws.SendAsync((New-Object 'System.ArraySegment[byte]' -ArgumentList (, $bytes)), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait() | Out-Null
    $buf = New-Object byte[] 1048576; $ms = New-Object IO.MemoryStream
    for ($k = 0; $k -lt 50; $k++) {
      $t = $ws.ReceiveAsync((New-Object 'System.ArraySegment[byte]' -ArgumentList (, $buf)), [Threading.CancellationToken]::None)
      if (-not $t.Wait(10000)) { break }
      $ms.Write($buf, 0, $t.Result.Count)
      if ($t.Result.EndOfMessage) { $j = [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json; $ms.SetLength(0); if ($j.id -eq 1) { $val = $j.result.result.value; break } }
    }
    $ws.Dispose()
  }
  $app = Get-Process -Name "agtn-cad" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  [void](Close-App $app)
  Get-Process -Name "agtn-cad" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Log "  recentes ($tag): $val"
  return $val
}

# ====================================================== W6: ambiente SEM ferramentas de desenvolvimento neste processo
$env:PATH = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
foreach ($v in "RUSTUP_HOME", "CARGO_HOME", "npm_config_cache") { Remove-Item "Env:\$v" -ErrorAction SilentlyContinue }
$env:TEMP = "$env:LOCALAPPDATA\Temp"; $env:TMP = $env:TEMP
$dev = [ordered]@{}; foreach ($t in "git", "node", "npm", "cargo", "rustc", "cl", "link") { $c = Get-Command $t -ErrorAction SilentlyContinue; $dev[$t] = $(if ($c) { $c.Source } else { $null }) }
$RES.dados.ferramentasNoPath = $dev
$semDev = -not ($dev.Values | Where-Object { $_ })
Log ("ferramentas de desenvolvimento no PATH deste processo: " + $(if ($semDev) { "nenhuma" } else { ($dev.GetEnumerator() | Where-Object { $_.Value } | ForEach-Object { $_.Key }) -join ", " }))

# ====================================================== W2: auditoria dos instaladores
$new = Get-ChildItem $H -Filter "*_3.2.0-1_x64-setup.exe" | Select-Object -First 1
$old = Get-ChildItem $H -Filter "*_3.1.1_x64-setup.exe" | Select-Object -First 1
if (-not $new -or -not $old) { Item "W2" "REPROVADO" "instalador ausente em $H (novo: $($new.Name); 3.1.1: $($old.Name))"; Save; exit 2 }
foreach ($i in @(@{ t = "novo"; f = $new }, @{ t = "311"; f = $old })) {
  $vi = $i.f.VersionInfo; $sig = Get-AuthenticodeSignature $i.f.FullName
  $RES.dados["instalador_$($i.t)"] = [ordered]@{ arquivo = $i.f.Name; bytes = $i.f.Length; sha256 = (Hash $i.f.FullName); pe = (PeMachine $i.f.FullName); produto = $vi.ProductName; empresa = $vi.CompanyName; versaoProduto = $vi.ProductVersion; versaoArquivo = $vi.FileVersion; descricao = $vi.FileDescription; copyright = $vi.LegalCopyright; assinatura = "$($sig.Status)" }
  Log ("instalador {0}: {1}" -f $i.t, ($RES.dados["instalador_$($i.t)"] | ConvertTo-Json -Compress))
}
$exeBuild = "$S\apps\desktop\src-tauri\target\release\agtn-cad.exe"; $exe311Build = "$M\apps\desktop\src-tauri\target\release\agtn-cad.exe"
$wasmBuild = "$S\node_modules\occt-wasm\dist\occt-wasm.wasm"
$dumpbin = Get-ChildItem "$R\BuildTools\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$deps = @(); if ($dumpbin) { $deps = @(& $dumpbin.FullName /nologo /dependents $exeBuild | Where-Object { $_ -match "\.dll\s*$" } | ForEach-Object { $_.Trim() }) }
$RES.dados.dependenciasExe = $deps
Log ("dependencias (DLL) do agtn-cad.exe: " + ($deps -join ", "))
$nv = $RES.dados.instalador_novo
$w2ok = ($nv.produto -eq "AGTN Industrial CAD") -and ($nv.versaoProduto -match "^3\.2\.0") -and ($nv.empresa -match "AGTN")
Item "W2-metadados" $(if ($w2ok) { "APROVADO" } else { "REPROVADO" }) "produto '$($nv.produto)', empresa '$($nv.empresa)', versao '$($nv.versaoProduto)', PE do instalador $($nv.pe) (stub NSIS), assinatura $($nv.assinatura), $($nv.bytes) bytes"

# ====================================================== estado inicial + backup
$pre = Find-Apps
$dataDir = "$env:LOCALAPPDATA\br.com.agtn.cad"
$RES.dados.estadoInicial = [ordered]@{ instalados = @($pre | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" }); atalhos = @(Shortcuts); assoc = (Assoc); dadosApp = (Test-Path $dataDir) }
$bk = "$O\backup_inicial"; New-Item -ItemType Directory -Force $bk | Out-Null
foreach ($k in "HKCU\Software\AGTN", "HKCU\Software\Classes\.agtncad", "HKCU\Software\Classes\.dxf", "HKCU\Software\Classes\.dwg", "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.dxf", "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.dwg") { $n = ($k -replace '[\\ ]', '_') + ".reg"; cmd /c "reg export `"$k`" `"$bk\$n`" /y >nul 2>&1" }
if (Test-Path $dataDir) { Copy-Item -LiteralPath $dataDir -Destination "$bk\br.com.agtn.cad" -Recurse -Force }
Log ("estado inicial: " + ($RES.dados.estadoInicial | ConvertTo-Json -Compress -Depth 5) + "; backup em $bk")
if ($pre.Count -gt 0) { Item "PRE" "INTERROMPIDO" "ja existe AGTN instalado ($($RES.dados.estadoInicial.instalados -join ', ')); nao mexo sem nova autorizacao"; Save; exit 3 }

# ====================================================== W3: instalacao limpa 3.2.0-1
$ec = Install $new.FullName "limpa"
$apps = Find-Apps; $app = $apps | Select-Object -First 1
if (-not $app) { Item "W3-instalacao" "REPROVADO" "instalador terminou com codigo $ec e o app nao esta no registro"; Save; exit 1 }
$dir = App-Dir $app; $exe = Join-Path $dir "agtn-cad.exe"; $wasm = Join-Path $dir "occt\occt-wasm.wasm"
$files = Snap $dir
$RES.dados.instalado = [ordered]@{ chave = $app.PSChildName; nome = $app.DisplayName; versao = $app.DisplayVersion; fabricante = $app.Publisher; pasta = $dir; tamanhoKB = $app.EstimatedSize; arquivos = $files; atalhos = @(Shortcuts); assoc = (Assoc); exePE = $(if (Test-Path $exe) { PeMachine $exe }) }
$exeIgual = (Hash $exe) -eq (Hash $exeBuild); $wasmIgual = (Hash $wasm) -eq (Hash $wasmBuild)
Item "W3-instalacao" $(if ($ec -eq 0 -and $apps.Count -eq 1 -and $exeIgual -and $wasmIgual -and $app.DisplayVersion -eq "3.2.0-1") { "APROVADO" } else { "REPROVADO" }) "codigo $ec; $($app.DisplayName) $($app.DisplayVersion) de '$($app.Publisher)' em $dir; $($files.Count) arquivos; exe $($RES.dados.instalado.exePE) igual ao build: $exeIgual; occt-wasm igual ao build: $wasmIgual; entradas no registro: $($apps.Count); atalhos: $(@(Shortcuts).Count)"
# abrir pelo atalho
$lnk = @(Shortcuts) | Where-Object { $_ -match "Start Menu" } | Select-Object -First 1
$a = $null; if ($lnk) { $a = Open-App $lnk $null "atalho" }
$mods = @(); $ttl = $null
if ($a) { $ttl = $a.MainWindowTitle; Start-Sleep 5; $a.Refresh(); $mods = @($a.Modules | ForEach-Object { $_.FileName }); }
$fora = @($mods | Where-Object { $_ -match "AGTN_DEV|\\src\\agtn|node_modules|\\.cargo|\\.rustup" })
$RES.dados.modulosCarregados = $mods
$f1 = Close-App $a
Item "W3-atalho" $(if ($a -and $fora.Count -eq 0) { "APROVADO" } else { "REPROVADO" }) "atalho '$lnk' abriu janela '$ttl' em $($RES.dados.janela_ms_atalho) ms; $($mods.Count) modulos carregados, $($fora.Count) fora do Windows/instalacao (ex.: pasta do repositorio); fechou pela janela: $f1"
# abrir direto pelo executavel, fechar e reabrir
$a = Open-App $exe $null "exe1"; $t1 = $(if ($a) { $a.MainWindowTitle }); $f2 = Close-App $a
$a = Open-App $exe $null "exe2"; $t2 = $(if ($a) { $a.MainWindowTitle }); $f3 = Close-App $a
Item "W3-executavel-reabrir" $(if ($t1 -and $t2) { "APROVADO" } else { "REPROVADO" }) "abriu '$t1' ($($RES.dados.janela_ms_exe1) ms), fechou: $f2; reabriu '$t2' ($($RES.dados.janela_ms_exe2) ms), fechou: $f3"
# teste funcional completo no app INSTALADO (WebView2 real, perfil isolado), sem ferramentas no PATH
$smokeDir = "$S\scripts\windows\smoke"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$smokeDir\webview2_smoke.ps1" -Exe $exe -Out "$O\w3_smoke" -Repeticoes $Repeticoes *> "$O\w3_smoke_console.txt"
$sc = $LASTEXITCODE
$sr = $null; if (Test-Path "$O\w3_smoke\webview2_resultado.json") { $sr = [IO.File]::ReadAllText("$O\w3_smoke\webview2_resultado.json", [Text.Encoding]::UTF8) | ConvertFrom-Json }
Item "W3-funcional" $(if ($sr -and $sr.verificacoes -eq $sr.aprovadas) { "APROVADO" } else { "REPROVADO" }) "app instalado: $($sr.aprovadas)/$($sr.verificacoes) verificacoes ($Repeticoes repeticoes x 6 projetos; codigo $sc)"
Item "W6" $(if (-not $semDev) { "PENDENTE" } elseif ($sr -and $sr.verificacoes -eq $sr.aprovadas -and $fora.Count -eq 0) { "APROVADO" } else { "REPROVADO" }) "processo sem git/node/npm/cargo/rustc/cl/link no PATH: $semDev; DLLs do exe: $($deps -join ', '); modulos fora do sistema/instalacao: $($fora.Count)"
# desinstalacao da instalacao limpa
$dataSnapA = Snap $dataDir
$ec = Uninstall $app "limpa"
$rest = Find-Apps; $sobra = @(); if (Test-Path -LiteralPath $dir) { $sobra = @(Get-ChildItem -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
$as = Assoc; $lk = @(Shortcuts)
Item "W4-desinstalacao-1" $(if ($rest.Count -eq 0 -and $sobra.Count -eq 0 -and $lk.Count -eq 0 -and -not $as.agtncad) { "APROVADO" } else { "REPROVADO" }) "codigo $ec; registro removido: $($rest.Count -eq 0); pasta do programa: $(if (Test-Path -LiteralPath $dir) { "ficou com $($sobra.Count) itens" } else { 'removida' }); atalhos restantes: $($lk.Count); associacao .agtncad: '$($as.agtncad)'; dados do app (perfil WebView2) mantidos: $(Test-Path $dataDir)"
Save

# ====================================================== W4: atualizacao 3.1.1 -> 3.2.0-1 com dados do usuario
$ec = Install $old.FullName "311"
$a311 = Find-Apps | Select-Object -First 1
if (-not $a311 -or $a311.DisplayVersion -ne "3.1.1") { Item "W4-base-311" "REPROVADO" "3.1.1 nao instalou (codigo $ec)"; Save; exit 1 }
$dir311 = App-Dir $a311; $exe311 = Join-Path $dir311 "agtn-cad.exe"
Item "W4-base-311" $(if ((Hash $exe311) -eq (Hash $exe311Build)) { "APROVADO" } else { "REPROVADO" }) "3.1.1 instalada em $dir311 (exe igual ao build da main: $((Hash $exe311) -eq (Hash $exe311Build)))"
# dados do usuario: projeto numa pasta propria + abrir na 3.1.1 (vira "recente" no perfil real)
$pu = "$O\projetos_usuario"; New-Item -ItemType Directory -Force $pu | Out-Null
$proj = "$pu\projeto_usuario_w4.agtncad"; Copy-Item -LiteralPath "$S\tests\regressao2d\v311_desenho.agtncad" -Destination $proj -Force
$projHash = Hash $proj
$a = Open-App $exe311 $proj "311_projeto"; Start-Sleep 8; $fz = Close-App $a
$rec311 = Read-Recents $exe311 "3.1.1"
$tem311 = [bool]($rec311 -and $rec311 -match "projeto_usuario_w4")
# backup e foto do perfil antes de atualizar
$bk2 = "$O\backup_antes_atualizar"; New-Item -ItemType Directory -Force $bk2 | Out-Null
Copy-Item -LiteralPath $dataDir -Destination "$bk2\br.com.agtn.cad" -Recurse -Force
cmd /c "reg export `"HKCU\Software\AGTN`" `"$bk2\HKCU_Software_AGTN.reg`" /y >nul 2>&1"
$snapAntes = Snap $dataDir
Log "perfil do app antes de atualizar: $($snapAntes.Count) arquivos; backup em $bk2; rollback: reinstalar $($old.Name)"
# atualizar por cima
$ec = Install $new.FullName "atualizacao"
$apps = Find-Apps; $up = $apps | Select-Object -First 1
$dirUp = App-Dir $up; $exeUp = Join-Path $dirUp "agtn-cad.exe"
$snapDepois = Snap $dataDir
$difs = @($snapAntes.Keys | Where-Object { $snapDepois[$_] -ne $snapAntes[$_] }) + @($snapDepois.Keys | Where-Object { -not $snapAntes.Contains($_) })
$okUp = ($ec -eq 0) -and ($apps.Count -eq 1) -and ($up.DisplayVersion -eq "3.2.0-1") -and ((Hash $exeUp) -eq (Hash $exeBuild)) -and ($dirUp -eq $dir311)
Item "W4-atualizacao" $(if ($okUp) { "APROVADO" } else { "REPROVADO" }) "codigo $ec; de 3.1.1 para $($up.DisplayVersion); entradas no registro: $($apps.Count); mesma pasta: $($dirUp -eq $dir311); exe novo igual ao build: $((Hash $exeUp) -eq (Hash $exeBuild)); occt-wasm presente: $(Test-Path (Join-Path $dirUp 'occt\occt-wasm.wasm'))"
Item "W4-dados-intactos" $(if ($difs.Count -eq 0 -and (Hash $proj) -eq $projHash) { "APROVADO" } else { "REPROVADO" }) "perfil do app: $($snapAntes.Count) arquivos, $($difs.Count) alterados pelo instalador; projeto do usuario intacto: $((Hash $proj) -eq $projHash)"
$recUp = Read-Recents $exeUp "3.2.0-1"
Item "W4-preferencias" $(if ($tem311 -and $recUp -match "projeto_usuario_w4") { "APROVADO" } else { "REPROVADO" }) "lista de recentes na 3.1.1 contem o projeto: $tem311; depois da atualizacao, a 3.2.0-1 le a mesma lista: $([bool]($recUp -match 'projeto_usuario_w4'))"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$smokeDir\webview2_smoke.ps1" -Exe $exeUp -Out "$O\w4_smoke" -Repeticoes 1 *> "$O\w4_smoke_console.txt"
$sr2 = $null; if (Test-Path "$O\w4_smoke\webview2_resultado.json") { $sr2 = [IO.File]::ReadAllText("$O\w4_smoke\webview2_resultado.json", [Text.Encoding]::UTF8) | ConvertFrom-Json }
Item "W4-funcional-pos-atualizacao" $(if ($sr2 -and $sr2.verificacoes -eq $sr2.aprovadas) { "APROVADO" } else { "REPROVADO" }) "app atualizado: $($sr2.aprovadas)/$($sr2.verificacoes) verificacoes"
Save

# ====================================================== W4: desinstalacao final
$ec = Uninstall $up "final"
$rest = Find-Apps; $sobra = @(); if (Test-Path -LiteralPath $dirUp) { $sobra = @(Get-ChildItem -LiteralPath $dirUp -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
$as = Assoc; $lk = @(Shortcuts)
$projOk = (Hash $proj) -eq $projHash
Item "W4-desinstalacao-final" $(if ($rest.Count -eq 0 -and $sobra.Count -eq 0 -and $lk.Count -eq 0 -and $projOk -and -not $as.agtncad) { "APROVADO" } else { "REPROVADO" }) "codigo $ec; registro removido: $($rest.Count -eq 0); pasta do programa: $(if (Test-Path -LiteralPath $dirUp) { "ficou com $($sobra.Count) itens: $($sobra -join '; ')" } else { 'removida' }); atalhos: $($lk.Count); associacoes depois: $($as | ConvertTo-Json -Compress); projeto do usuario intacto: $projOk; perfil do app mantido (comportamento esperado): $(Test-Path $dataDir)"
$RES.dados.estadoFinal = [ordered]@{ instalados = @(Find-Apps | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" }); atalhos = @(Shortcuts); assoc = (Assoc) }
Log ("estado final: " + ($RES.dados.estadoFinal | ConvertTo-Json -Compress -Depth 5))
$rep = @($RES.itens.Values | Where-Object { $_.status -eq "REPROVADO" }).Count
Log "FIM: $($RES.itens.Count) itens; reprovados $rep; pasta $O"
Save
Set-Content "$R\logs\04_FIM.txt" "ok reprovados=$rep pasta=$O"
