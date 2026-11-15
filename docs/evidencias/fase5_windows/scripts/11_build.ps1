# AGTN FASE 5 - passo 11: fast-forward do bundle, testes nativos e build MSVC + instalador NSIS 3.2.0-2.
param([Parameter(Mandatory = $true)][string]$Esperado, [switch]$SemTestes)
$ErrorActionPreference = "Continue"
$R = "D:\AGTN_DEV"; $S = "$R\src\agtn"; $B = "$R\src\agtn_fase5.bundle"; $V = "3.2.0-2"
$env:RUSTUP_HOME = "$R\rust\rustup"; $env:CARGO_HOME = "$R\rust\cargo"; $env:npm_config_cache = "$R\cache\npm"
$env:TEMP = "$R\tmp"; $env:TMP = $env:TEMP
$env:PATH = "$R\tools\node;$R\tools\git\cmd;$R\rust\cargo\bin;" + $env:PATH
$L = "$R\logs\fase5"; New-Item -ItemType Directory -Force $L | Out-Null
$log = "$L\11_build.log"
$res = [ordered]@{ inicio = (Get-Date -Format s); etapas = [ordered]@{} }
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format s), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
function Save { $res.fim = (Get-Date -Format s); $res | ConvertTo-Json -Depth 6 | Set-Content "$L\11_build_resumo.json" -Encoding UTF8 }
function Step($name, $dir, $cmd) {
  Log "== $name  ($dir> $cmd)"
  $t0 = Get-Date; Push-Location $dir
  cmd /c "$cmd > `"$L\11_$name.log`" 2>&1"
  $code = $LASTEXITCODE; Pop-Location
  $res.etapas[$name] = [ordered]@{ codigo = $code; segundos = [int]((Get-Date) - $t0).TotalSeconds; fim = ((Get-Content "$L\11_$name.log" -Tail 6) -join " | ") }
  Log ("   -> codigo {0}, {1} s; {2}" -f $code, $res.etapas[$name].segundos, ((Get-Content "$L\11_$name.log" -Tail 3) -join " | "))
  return ($code -eq 0)
}
Log ("inicio; node " + (node --version) + "; " + (rustc --version) + "; " + (git --version) + "; C livre GB=$([math]::Round((Get-PSDrive C).Free/1GB,1)); D livre GB=$([math]::Round((Get-PSDrive D).Free/1GB,1))")
git -C $S fetch $B feature/agtn-3d-ia 2>&1 | ForEach-Object { Log "  fetch: $_" }
git -C $S merge --ff-only FETCH_HEAD 2>&1 | ForEach-Object { Log "  ff: $_" }
$h = git -C $S rev-parse HEAD; $res.commit = $h
Log "HEAD $h (esperado $Esperado); alteracoes locais: $((git -C $S status --porcelain | Measure-Object).Count)"
if ($h -ne $Esperado) { Log "ERRO: commit divergente, parando"; Save; Set-Content "$L\11_FIM.txt" "divergente"; exit 3 }
$ver = (Get-Content "$S\apps\desktop\src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
Log "versao tauri.conf.json: $ver"; if ($ver -ne $V) { Log "ERRO: versao $ver <> $V"; Save; Set-Content "$L\11_FIM.txt" "versao"; exit 4 }
Step "npm_ci" $S "npm ci --no-audit --no-fund" | Out-Null
if (-not $SemTestes) {
  Step "typecheck" $S "npm run typecheck" | Out-Null
  Step "vitest" $S "npx vitest run" | Out-Null
  Step "sem_eval" $S "npm run test:sem-eval" | Out-Null
  $env:AGTN_DWG_SAMPLES = "$S\tests\dwg"
  Step "cargo_test" "$S\apps\desktop\src-tauri" "cargo test --release" | Out-Null
}
Step "tauri_build" $S "npm run tauri build -- --bundles nsis" | Out-Null
# ---------- artefato: novo nome, nunca substitui instalador anterior
$H = "$R\homologacao"; New-Item -ItemType Directory -Force $H | Out-Null
$src = Get-ChildItem "$S\apps\desktop\src-tauri\target\release\bundle\nsis" -Filter "*_${V}_x64-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $src) { Log "ERRO: instalador $V nao gerado"; Save; Set-Content "$L\11_FIM.txt" "sem instalador"; exit 5 }
$dst = Join-Path $H $src.Name
if (Test-Path -LiteralPath $dst) { $old = $src.BaseName + "_superado_" + (Get-Item -LiteralPath $dst).LastWriteTime.ToString("yyyyMMdd_HHmmss") + ".exe"; Rename-Item -LiteralPath $dst -NewName $old; Log "ja havia um instalador $V de build anterior: guardado como $old (nao apagado); o novo fica com o nome padrao" }
Copy-Item -LiteralPath $src.FullName -Destination $dst
$vi = (Get-Item -LiteralPath $dst).VersionInfo
$lin = @()
foreach ($f in @($dst, "$S\apps\desktop\src-tauri\target\release\agtn-cad.exe", "$S\node_modules\occt-wasm\dist\occt-wasm.wasm")) { $lin += "{0}  {1}  {2} bytes" -f (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash, $f, (Get-Item -LiteralPath $f).Length }
$lin += "versao produto: $($vi.ProductVersion); versao arquivo: $($vi.FileVersion); produto: $($vi.ProductName); commit: $h; data: $(Get-Date -Format s)"
$lin | Set-Content "$H\SHA256SUMS_$V.txt" -Encoding UTF8
$lin | ForEach-Object { Log "  $_" }
$res.instalador = [ordered]@{ caminho = $dst; sha256 = (Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash; bytes = (Get-Item -LiteralPath $dst).Length; versaoProduto = $vi.ProductVersion }
Log ("instaladores na pasta: " + ((Get-ChildItem $H -Filter *.exe | ForEach-Object { "$($_.Name) ($($_.Length))" }) -join "; "))
Log ("fim; C livre GB=$([math]::Round((Get-PSDrive C).Free/1GB,1)); D livre GB=$([math]::Round((Get-PSDrive D).Free/1GB,1))")
Save
Set-Content "$L\11_FIM.txt" "ok $(Get-Date -Format s)"
