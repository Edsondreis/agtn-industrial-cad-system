# AGTN FASE 5 - passo 12: ciclo real do instalador 3.2.0-2 (Windows nativo, sem UAC: instalador currentUser).
# Instalacao limpa, atalho, executavel, fechar/reabrir, regressao 2D/3D/planificacao/DXF/DWG (webview2_smoke),
# DXF e STEP abertos no app instalado (webview2_step_smoke), memoria, desinstalacao; depois atualizacao 3.2.0-1 -> 3.2.0-2
# com backup e rollback, dados do usuario preservados, e desinstalacao final. Estado final: nenhum AGTN instalado (como antes).
# Nao apaga dados pessoais. Nao toca na 3.1.1. Para em qualquer estado inesperado.
param([int]$Repeticoes = 1)
$ErrorActionPreference = "Continue"
$R = "D:\AGTN_DEV"; $H = "$R\homologacao"; $S = "$R\src\agtn"; $V = "3.2.0-2"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"; $O = "$H\fase5_ciclo_$stamp"; New-Item -ItemType Directory -Force $O | Out-Null
$log = "$O\ciclo.log"
$RES = [ordered]@{ inicio = (Get-Date -Format s); itens = [ordered]@{}; dados = [ordered]@{} }
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format s), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
function Item($id, $status, $det) { $RES.itens[$id] = [ordered]@{ status = $status; detalhe = $det }; Log ("{0} {1} - {2}" -f $id, $status, $det) }
function Save { $RES.fim = (Get-Date -Format s); $RES | ConvertTo-Json -Depth 12 | Set-Content "$O\ciclo_resumo.json" -Encoding UTF8 }
function Hash($f) { if (Test-Path -LiteralPath $f) { (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash } else { $null } }
function PeMachine($f) { $fs = [IO.File]::OpenRead($f); $b = New-Object byte[] 4096; [void]$fs.Read($b, 0, 4096); $fs.Close(); $pe = [BitConverter]::ToInt32($b, 0x3C); $m = [BitConverter]::ToUInt16($b, $pe + 4); switch ($m) { 0x8664 { "x64" } 0x14c { "x86" } 0xAA64 { "ARM64" } default { "0x{0:X}" -f $m } } }
function Same-But-Marker($inst, $build) {
  # o bundler do Tauri grava o tipo de pacote numa COPIA do binario: __TAURI_BUNDLE_TYPE_VAR_UNK -> _NSS
  $a = [IO.File]::ReadAllBytes($inst); $b = [IO.File]::ReadAllBytes($build)
  if ($a.Length -ne $b.Length) { return "tamanhos diferentes ($($a.Length) x $($b.Length))" }
  $tb = [Text.Encoding]::ASCII.GetString($b); $i = $tb.IndexOf("__TAURI_BUNDLE_TYPE_VAR_UNK")
  if ($i -lt 0) { return "marcador nao encontrado no build" }
  $p = $b.Clone(); $nss = [Text.Encoding]::ASCII.GetBytes("NSS"); [Array]::Copy($nss, 0, $p, $i + 24, 3)
  $sha = [Security.Cryptography.SHA256]::Create()
  $ha = [BitConverter]::ToString($sha.ComputeHash($a)); $hp = [BitConverter]::ToString($sha.ComputeHash($p))
  if ($ha -eq $hp) { return "IGUAL (so o marcador UNK->NSS no offset $i difere)" } else { return "DIFERENTE alem do marcador" }
}
function RegDump($tag) {
  $f = "$O\registro_$tag.txt"
  foreach ($k in "HKCU\Software\Classes\.agtncad", "HKCU\Software\Classes\.dxf", "HKCU\Software\Classes\.dwg", "HKCU\Software\Classes\Projeto AGTN Industrial CAD", "HKCU\Software\Classes\AGTNCAD.DXF", "HKCU\Software\Classes\AGTNCAD.DWG", "HKCU\Software\AGTN") { Add-Content $f "### $k"; cmd /c "reg query `"$k`" /s >> `"$f`" 2>&1" }
  return $f
}
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


# ====================================================== ambiente SEM ferramentas de desenvolvimento neste processo
$env:PATH = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
foreach ($ev in "RUSTUP_HOME", "CARGO_HOME", "npm_config_cache") { Remove-Item "Env:\$ev" -ErrorAction SilentlyContinue }
$env:TEMP = "$env:LOCALAPPDATA\Temp"; $env:TMP = $env:TEMP
$dev = [ordered]@{}; foreach ($t in "git", "node", "npm", "cargo", "rustc", "cl", "link") { $c = Get-Command $t -ErrorAction SilentlyContinue; $dev[$t] = $(if ($c) { $c.Source } else { $null }) }
$semDev = -not ($dev.Values | Where-Object { $_ })
$RES.dados.ferramentasNoPath = $dev

# ====================================================== instaladores
$new = Get-ChildItem $H -Filter "*_${V}_x64-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$prev = Get-ChildItem $H -Filter "*_3.2.0-1_x64-setup.exe" | Select-Object -First 1
if (-not $new -or -not $prev) { Item "W2" "REPROVADO" "instalador ausente em $H (novo: $($new.Name); 3.2.0-1: $($prev.Name))"; Save; exit 2 }
$vi = $new.VersionInfo; $sig = Get-AuthenticodeSignature $new.FullName
$RES.dados.instalador = [ordered]@{ arquivo = $new.Name; bytes = $new.Length; sha256 = (Hash $new.FullName); pe = (PeMachine $new.FullName); produto = $vi.ProductName; versaoProduto = $vi.ProductVersion; versaoArquivo = $vi.FileVersion; assinatura = "$($sig.Status)" }
$exeBuild = "$S\apps\desktop\src-tauri\target\release\agtn-cad.exe"; $wasmBuild = "$S\node_modules\occt-wasm\dist\occt-wasm.wasm"
Item "W2-metadados" $(if ($vi.ProductName -eq "AGTN Industrial CAD" -and $vi.ProductVersion -eq $V) { "APROVADO" } else { "REPROVADO" }) "produto '$($vi.ProductName)', versao '$($vi.ProductVersion)', PE do instalador $($RES.dados.instalador.pe) (stub NSIS), assinatura $($sig.Status), $($new.Length) bytes, SHA-256 $($RES.dados.instalador.sha256)"

# ====================================================== estado inicial + backup
$pre = Find-Apps
$dataDir = "$env:LOCALAPPDATA\br.com.agtn.cad"
$RES.dados.estadoInicial = [ordered]@{ instalados = @($pre | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" }); atalhos = @(Shortcuts); assoc = (Assoc); dadosApp = (Test-Path $dataDir) }
[void](RegDump "0_inicial")
$bk = "$O\backup_inicial"; New-Item -ItemType Directory -Force $bk | Out-Null
foreach ($k in "HKCU\Software\AGTN", "HKCU\Software\Classes\.agtncad", "HKCU\Software\Classes\.dxf", "HKCU\Software\Classes\.dwg", "HKCU\Software\Classes\.step", "HKCU\Software\Classes\.stp") { $n = ($k -replace '[\\ ]', '_') + ".reg"; cmd /c "reg export `"$k`" `"$bk\$n`" /y >nul 2>&1" }
if (Test-Path $dataDir) { Copy-Item -LiteralPath $dataDir -Destination "$bk\br.com.agtn.cad" -Recurse -Force }
$stepAssocAntes = [ordered]@{ step = (Get-ItemProperty "HKCU:\Software\Classes\.step" -ErrorAction SilentlyContinue).'(default)'; stp = (Get-ItemProperty "HKCU:\Software\Classes\.stp" -ErrorAction SilentlyContinue).'(default)' }
Log ("estado inicial: " + ($RES.dados.estadoInicial | ConvertTo-Json -Compress -Depth 5) + "; .step/.stp: " + ($stepAssocAntes | ConvertTo-Json -Compress) + "; backup em $bk")
if ($pre.Count -gt 0) { Item "PRE" "INTERROMPIDO" "ja existe AGTN instalado ($($RES.dados.estadoInicial.instalados -join ', ')); nao mexo sem nova autorizacao"; Save; exit 3 }

# ====================================================== instalacao limpa 3.2.0-2
$ec = Install $new.FullName "limpa"
$apps = Find-Apps; $app = $apps | Select-Object -First 1
if (-not $app) { Item "I1-instalacao" "REPROVADO" "codigo $ec e o app nao esta no registro"; Save; exit 1 }
$dir = App-Dir $app; $exe = Join-Path $dir "agtn-cad.exe"; $wasm = Join-Path $dir "occt\occt-wasm.wasm"
$files = Snap $dir
$cmp = Same-But-Marker $exe $exeBuild; $wasmIgual = (Hash $wasm) -eq (Hash $wasmBuild)
[void](RegDump "1_instalado_limpo")
$stepAssoc = [ordered]@{ step = (Get-ItemProperty "HKCU:\Software\Classes\.step" -ErrorAction SilentlyContinue).'(default)'; stp = (Get-ItemProperty "HKCU:\Software\Classes\.stp" -ErrorAction SilentlyContinue).'(default)' }
$RES.dados.instalado = [ordered]@{ nome = $app.DisplayName; versao = $app.DisplayVersion; pasta = $dir; arquivos = $files; atalhos = @(Shortcuts); assoc = (Assoc); stepAssoc = $stepAssoc; exePE = $(if (Test-Path $exe) { PeMachine $exe }) }
Item "I1-instalacao" $(if ($ec -eq 0 -and $apps.Count -eq 1 -and $cmp -like "IGUAL*" -and $wasmIgual -and $app.DisplayVersion -eq $V -and $RES.dados.instalado.exePE -eq "x64") { "APROVADO" } else { "REPROVADO" }) "codigo $ec; $($app.DisplayName) $($app.DisplayVersion) em $dir; $($files.Count) arquivos ($(($files.Keys) -join ', ')); exe $($RES.dados.instalado.exePE) x build: $cmp; WASM do motor incluido e igual ao build: $wasmIgual; atalhos: $(@(Shortcuts).Count)"
Item "I1-sem-associacao-step" $(if ($stepAssoc.step -eq $stepAssocAntes.step -and $stepAssoc.stp -eq $stepAssocAntes.stp) { "APROVADO" } else { "REPROVADO" }) "o instalador nao cria associacao de .step/.stp (antes $($stepAssocAntes | ConvertTo-Json -Compress); depois $($stepAssoc | ConvertTo-Json -Compress))"
$lnk = @(Shortcuts) | Where-Object { $_ -match "Start Menu" } | Select-Object -First 1
$a = $null; if ($lnk) { $a = Open-App $lnk $null "atalho" }
$mods = @(); $ttl = $null
if ($a) { $ttl = $a.MainWindowTitle; Start-Sleep 5; $a.Refresh(); $mods = @($a.Modules | ForEach-Object { $_.FileName }) }
$fora = @($mods | Where-Object { $_ -match "AGTN_DEV|\\src\\agtn|node_modules|\\.cargo|\\.rustup" })
$f1 = Close-App $a
Item "I2-atalho" $(if ($a -and $fora.Count -eq 0) { "APROVADO" } else { "REPROVADO" }) "atalho '$lnk' abriu '$ttl' em $($RES.dados.janela_ms_atalho) ms; $($mods.Count) modulos, $($fora.Count) fora do Windows/instalacao; fechou: $f1"
$a = Open-App $exe $null "exe1"; $t1 = $(if ($a) { $a.MainWindowTitle }); $f2 = Close-App $a
$a = Open-App $exe $null "exe2"; $t2 = $(if ($a) { $a.MainWindowTitle }); $f3 = Close-App $a
Item "I3-executavel-reabrir" $(if ($t1 -and $t2) { "APROVADO" } else { "REPROVADO" }) "abriu '$t1' ($($RES.dados.janela_ms_exe1) ms), fechou: $f2; reabriu '$t2' ($($RES.dados.janela_ms_exe2) ms), fechou: $f3"
$smokeDir = "$S\scripts\windows\smoke"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$smokeDir\webview2_smoke.ps1" -Exe $exe -Out "$O\regressao_smoke" -Repeticoes $Repeticoes *> "$O\regressao_smoke_console.txt"
$sr = $null; if (Test-Path "$O\regressao_smoke\webview2_resultado.json") { $sr = [IO.File]::ReadAllText("$O\regressao_smoke\webview2_resultado.json", [Text.Encoding]::UTF8) | ConvertFrom-Json }
Item "I4-regressao-2D-3D-planificacao" $(if ($sr -and $sr.verificacoes -gt 0 -and $sr.verificacoes -eq $sr.aprovadas) { "APROVADO" } else { "REPROVADO" }) "app instalado (WebView2): $($sr.aprovadas)/$($sr.verificacoes) verificacoes (projetos 2D/3D/chapa, planificacao, DXF R12/R2000 com SHA-256, DWG, .agtncad, CSP)"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$smokeDir\webview2_step_smoke.ps1" -Exe $exe -Out "$O\step_smoke" *> "$O\step_smoke_console.txt"
$st = $null; if (Test-Path "$O\step_smoke\step_resultado.json") { $st = [IO.File]::ReadAllText("$O\step_smoke\step_resultado.json", [Text.Encoding]::UTF8) | ConvertFrom-Json }
Item "I5-dxf-step-instalado" $(if ($st -and $st.verificacoes -gt 0 -and $st.verificacoes -eq $st.aprovadas) { "APROVADO" } else { "REPROVADO" }) "app instalado (WebView2): $($st.aprovadas)/$($st.verificacoes) verificacoes; falhas: $((@($st.execucoes | ForEach-Object { $a0 = $_.arquivo; $_.testes | Where-Object { -not $_.ok } | ForEach-Object { "$a0 $($_.id)" } })) -join ', ')"
Item "W6-sem-ferramentas" $(if (-not $semDev) { "PENDENTE" } elseif ($sr -and $st -and $fora.Count -eq 0) { "APROVADO" } else { "REPROVADO" }) "processo sem git/node/npm/cargo/rustc/cl/link no PATH: $semDev; modulos fora do sistema/instalacao: $($fora.Count)"
$ec = Uninstall $app "limpa"
$rest = Find-Apps; $sobra = @(); if (Test-Path -LiteralPath $dir) { $sobra = @(Get-ChildItem -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
[void](RegDump "2_desinstalado_limpo")
Item "I6-desinstalacao" $(if ($rest.Count -eq 0 -and $sobra.Count -eq 0 -and @(Shortcuts).Count -eq 0) { "APROVADO" } else { "REPROVADO" }) "codigo $ec; registro removido: $($rest.Count -eq 0); pasta do programa: $(if (Test-Path -LiteralPath $dir) { "ficou com $($sobra.Count) itens" } else { 'removida' }); atalhos: $(@(Shortcuts).Count); perfil do app (dados do usuario) mantido: $(Test-Path $dataDir)"
Save

# ====================================================== atualizacao 3.2.0-1 -> 3.2.0-2 com dados do usuario (backup + rollback)
$ec = Install $prev.FullName "anterior"
$aPrev = Find-Apps | Select-Object -First 1
if (-not $aPrev -or $aPrev.DisplayVersion -ne "3.2.0-1") { Item "U1-base" "REPROVADO" "3.2.0-1 nao instalou (codigo $ec)"; Save; exit 1 }
$dirPrev = App-Dir $aPrev; $exePrev = Join-Path $dirPrev "agtn-cad.exe"
Item "U1-base" "APROVADO" "3.2.0-1 instalada em $dirPrev (codigo $ec)"
$pu = "$O\projetos_usuario"; New-Item -ItemType Directory -Force $pu | Out-Null
$proj = "$pu\projeto_usuario_fase5.agtncad"; Copy-Item -LiteralPath "$S\tests\regressao2d\v311_desenho.agtncad" -Destination $proj -Force
$projHash = Hash $proj
$a = Open-App $exePrev $proj "anterior_projeto"; Start-Sleep 8; $fz = Close-App $a
$recPrev = Read-Recents $exePrev "3.2.0-1"
$temPrev = [bool]($recPrev -and $recPrev -match "projeto_usuario_fase5")
$bk2 = "$O\backup_antes_atualizar"; New-Item -ItemType Directory -Force $bk2 | Out-Null
Copy-Item -LiteralPath $dataDir -Destination "$bk2\br.com.agtn.cad" -Recurse -Force
cmd /c "reg export `"HKCU\Software\AGTN`" `"$bk2\HKCU_Software_AGTN.reg`" /y >nul 2>&1"
$snapAntes = Snap $dataDir
Log "perfil antes de atualizar: $($snapAntes.Count) arquivos; backup em $bk2; rollback: reinstalar $($prev.Name)"
$ec = Install $new.FullName "atualizacao"
$apps = Find-Apps; $up = $apps | Select-Object -First 1
$dirUp = App-Dir $up; $exeUp = Join-Path $dirUp "agtn-cad.exe"
$snapDepois = Snap $dataDir
$difs = @($snapAntes.Keys | Where-Object { $snapDepois[$_] -ne $snapAntes[$_] }) + @($snapDepois.Keys | Where-Object { -not $snapAntes.Contains($_) })
$cmpUp = Same-But-Marker $exeUp $exeBuild
[void](RegDump "3_atualizado")
Item "U2-atualizacao" $(if ($ec -eq 0 -and $apps.Count -eq 1 -and $up.DisplayVersion -eq $V -and $cmpUp -like "IGUAL*" -and $dirUp -eq $dirPrev) { "APROVADO" } else { "REPROVADO" }) "codigo $ec; de 3.2.0-1 para $($up.DisplayVersion); entradas: $($apps.Count); mesma pasta: $($dirUp -eq $dirPrev); exe x build: $cmpUp"
Item "U3-dados-preservados" $(if ($difs.Count -eq 0 -and (Hash $proj) -eq $projHash) { "APROVADO" } else { "REPROVADO" }) "perfil do app: $($snapAntes.Count) arquivos, $($difs.Count) alterados pelo instalador; projeto do usuario intacto: $((Hash $proj) -eq $projHash)"
$recUp = Read-Recents $exeUp $V
Item "U4-recentes" $(if ($temPrev -and $recUp -match "projeto_usuario_fase5") { "APROVADO" } else { "REPROVADO" }) "recentes na 3.2.0-1 contem o projeto: $temPrev; a $V le a mesma lista: $([bool]($recUp -match 'projeto_usuario_fase5'))"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$smokeDir\webview2_step_smoke.ps1" -Exe $exeUp -Out "$O\step_smoke_pos_atualizacao" -Arquivos "box_100x50x20.step,cobertura_r2000.dxf" *> "$O\step_smoke_pos_atualizacao_console.txt"
$st2 = $null; if (Test-Path "$O\step_smoke_pos_atualizacao\step_resultado.json") { $st2 = [IO.File]::ReadAllText("$O\step_smoke_pos_atualizacao\step_resultado.json", [Text.Encoding]::UTF8) | ConvertFrom-Json }
Item "U5-funcional-pos-atualizacao" $(if ($st2 -and $st2.verificacoes -gt 0 -and $st2.verificacoes -eq $st2.aprovadas) { "APROVADO" } else { "REPROVADO" }) "STEP+DXF no app atualizado: $($st2.aprovadas)/$($st2.verificacoes)"
Save
$ec = Uninstall $up "final"
$rest = Find-Apps; $sobra = @(); if (Test-Path -LiteralPath $dirUp) { $sobra = @(Get-ChildItem -LiteralPath $dirUp -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
[void](RegDump "4_desinstalado_final")
$projOk = (Hash $proj) -eq $projHash
Item "U6-desinstalacao-final" $(if ($rest.Count -eq 0 -and $sobra.Count -eq 0 -and @(Shortcuts).Count -eq 0 -and $projOk) { "APROVADO" } else { "REPROVADO" }) "codigo $ec; registro removido: $($rest.Count -eq 0); pasta: $(if (Test-Path -LiteralPath $dirUp) { "ficou com $($sobra.Count) itens" } else { 'removida' }); atalhos: $(@(Shortcuts).Count); projeto do usuario intacto: $projOk; perfil do app mantido: $(Test-Path $dataDir)"
$fa = Find-Apps
$RES.dados.estadoFinal = [ordered]@{ instalados = @($fa | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" }); atalhos = @(Shortcuts); assoc = (Assoc) }
Log ("estado final: " + ($RES.dados.estadoFinal | ConvertTo-Json -Compress -Depth 5))
$rep = @($RES.itens.Values | Where-Object { $_.status -eq "REPROVADO" }).Count
Log "FIM: $($RES.itens.Count) itens; reprovados $rep; pasta $O"
Save
Set-Content "$R\logs\fase5\12_FIM.txt" "ok reprovados=$rep pasta=$O"
