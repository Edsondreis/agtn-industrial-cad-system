# AGTN ETAPA 6 - passo 03 (W1): clona do bundle, testes e build NATIVO MSVC + instalador NSIS (branch 3.2.0-1 e main 3.1.1).
param([switch]$SoMain, [switch]$SemTestes, [switch]$SemMain, [string]$EsperadoBranch = "c35c0a001815c3237a838cfdb6a0034dec789534")
$ErrorActionPreference = "Continue"
$R = "D:\AGTN_DEV"; $S = "$R\src\agtn"; $M = "$R\src\ref311"; $B = "$R\src\agtn_etapa6.bundle"
$env:RUSTUP_HOME = "$R\rust\rustup"; $env:CARGO_HOME = "$R\rust\cargo"; $env:npm_config_cache = "$R\cache\npm"
$env:TEMP = "$R\tmp"; $env:TMP = $env:TEMP
$env:PATH = "$R\tools\node;$R\tools\git\cmd;$R\rust\cargo\bin;" + $env:PATH
$log = "$R\logs\03_w1.log"; if ($SemMain) { $log = "$R\logs\03b_w1.log" }
$res = [ordered]@{ inicio = (Get-Date -Format s); etapas = [ordered]@{} }
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format s), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
function Step($name, $dir, $cmd) {
  Log "== $name  ($dir> $cmd)"
  $t0 = Get-Date; Push-Location $dir
  $sfx = $(if ($SemMain) { "_b2" } else { "" }); cmd /c "$cmd > `"$R\logs\w1_$name$sfx.log`" 2>&1"
  $code = $LASTEXITCODE; Pop-Location
  $s = [int]((Get-Date) - $t0).TotalSeconds
  $res.etapas[$name] = [ordered]@{ codigo = $code; segundos = $s }
  Log ("   -> codigo {0}, {1} s; ultimas linhas: {2}" -f $code, $s, ((Get-Content "$R\logs\w1_$name$sfx.log" -Tail 3) -join " | "))
  return ($code -eq 0)
}
function Save { $res.fim = (Get-Date -Format s); $res | ConvertTo-Json -Depth 5 | Set-Content $(if ($SemMain) { "$R\logs\03b_w1_resumo.json" } else { "$R\logs\03_w1_resumo.json" }) -Encoding UTF8 }
Log ("inicio; node " + (node --version) + "; " + (rustc --version) + "; " + (git --version) + "; C livre GB=$([math]::Round((Get-PSDrive C).Free/1GB,1)); D livre GB=$([math]::Round((Get-PSDrive D).Free/1GB,1))")
# ---------- repositorio (do bundle; sem credenciais do GitHub no PC)
if (-not (Test-Path "$S\.git")) { git -c core.autocrlf=false clone --branch feature/agtn-3d-ia $B $S 2>&1 | ForEach-Object { Log "  $_" } }
if (Test-Path "$S\.git") { git -C $S fetch $B feature/agtn-3d-ia 2>&1 | ForEach-Object { Log "  fetch: $_" }; git -C $S merge --ff-only FETCH_HEAD 2>&1 | ForEach-Object { Log "  ff: $_" } }
if (-not (Test-Path "$M\.git")) { git -c core.autocrlf=false clone --branch main $B $M 2>&1 | ForEach-Object { Log "  $_" } }
$hb = (git -C $S rev-parse HEAD); $hm = (git -C $M rev-parse HEAD)
$res.commitBranch = $hb; $res.commitMain = $hm
Log "branch HEAD $hb (esperado $EsperadoBranch); alteracoes: $((git -C $S status --porcelain | Measure-Object).Count)"
Log "main   HEAD $hm (esperado 23a25404e9cc49e6eca10f84d85fffceb2014650); alteracoes: $((git -C $M status --porcelain | Measure-Object).Count)"
if ($hb -ne $EsperadoBranch -or $hm -ne "23a25404e9cc49e6eca10f84d85fffceb2014650") { Log "ERRO: commits divergentes, parando"; Save; Set-Content "$R\logs\03_FIM.txt" "divergente"; exit 3 }
if (-not $SoMain) {
  # ---------- branch 3.2.0-1
  Step "b_npm_ci" $S "npm ci --no-audit --no-fund" | Out-Null
  if (-not $SemTestes) {
    Step "b_typecheck" $S "npm run typecheck" | Out-Null
    Step "b_vitest" $S "npx vitest run" | Out-Null
    Step "b_sem_eval" $S "npm run test:sem-eval" | Out-Null
    $env:AGTN_DWG_SAMPLES = "$S\tests\dwg"
    Step "b_cargo_test" "$S\apps\desktop\src-tauri" "cargo test --release" | Out-Null
  }
  Step "b_tauri_build" $S "npm run tauri build -- --bundles nsis" | Out-Null
  Save
}
# ---------- main 3.1.1 (so build, para o teste de atualizacao)
if (-not $SemMain) {
  Step "m_npm_ci" $M "npm ci --no-audit --no-fund" | Out-Null
  Step "m_tauri_build" $M "npm run tauri build -- --bundles nsis" | Out-Null
}
# ---------- artefatos
$H = "$R\homologacao"; New-Item -ItemType Directory -Force $H | Out-Null
$hash = @()
foreach ($src in @("$S\apps\desktop\src-tauri\target\release\bundle\nsis", "$M\apps\desktop\src-tauri\target\release\bundle\nsis")) {
  Get-ChildItem $src -Filter *.exe -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName $H -Force; $hash += "{0}  {1}  {2} bytes" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Name, $_.Length }
}
foreach ($f in @("$S\apps\desktop\src-tauri\target\release\agtn-cad.exe", "$M\apps\desktop\src-tauri\target\release\agtn-cad.exe", "$S\node_modules\occt-wasm\dist\occt-wasm.wasm")) { if (Test-Path $f) { $hash += "{0}  {1}  {2} bytes" -f (Get-FileHash $f -Algorithm SHA256).Hash, $f, (Get-Item $f).Length } }
$hash | Set-Content "$H\SHA256SUMS.txt" -Encoding UTF8
$hash | ForEach-Object { Log "  $_" }
Log ("fim; C livre GB=$([math]::Round((Get-PSDrive C).Free/1GB,1)); D livre GB=$([math]::Round((Get-PSDrive D).Free/1GB,1))")
Save
Set-Content "$R\logs\03_FIM.txt" "ok $(Get-Date -Format s) semMain=$SemMain"
