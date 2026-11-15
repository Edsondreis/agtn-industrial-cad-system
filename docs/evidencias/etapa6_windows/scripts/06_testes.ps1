# AGTN ETAPA 6 - passo 06: rodada final dos testes automatizados no Windows nativo, no commit final da branch.
param([string]$Esperado = "56dee72b6921e7afec133354709c0cca09e12399")
$ErrorActionPreference = "Continue"
$R = "D:\AGTN_DEV"; $S = "$R\src\agtn"; $B = "$R\src\agtn_etapa6.bundle"
$env:RUSTUP_HOME = "$R\rust\rustup"; $env:CARGO_HOME = "$R\rust\cargo"; $env:npm_config_cache = "$R\cache\npm"; $env:TEMP = "$R\tmp"; $env:TMP = $env:TEMP
$env:PATH = "$R\tools\node;$R\tools\git\cmd;$R\rust\cargo\bin;" + $env:PATH
$log = "$R\logs\06_testes.log"
function Log($m) { $l = "[{0}] {1}" -f (Get-Date -Format s), $m; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
function Step($name, $dir, $cmd) { Log "== $name ($cmd)"; $t0 = Get-Date; Push-Location $dir; cmd /c "$cmd > `"$R\logs\w1_$name`_final.log`" 2>&1"; $c = $LASTEXITCODE; Pop-Location; Log ("   -> codigo {0}, {1} s" -f $c, [int]((Get-Date) - $t0).TotalSeconds) }
git -C $S fetch $B feature/agtn-3d-ia 2>&1 | ForEach-Object { Log "  fetch: $_" }
git -C $S merge --ff-only FETCH_HEAD 2>&1 | ForEach-Object { Log "  ff: $_" }
$h = git -C $S rev-parse HEAD; Log "HEAD $h (esperado $Esperado); alteracoes locais: $((git -C $S status --porcelain | Measure-Object).Count)"
if ($h -ne $Esperado) { Log "ERRO: commit divergente"; Set-Content "$R\logs\06_FIM.txt" "divergente"; exit 3 }
Step "typecheck" $S "npm run typecheck"
Step "vitest" $S "npx vitest run"
Step "sem_eval" $S "npm run test:sem-eval"
Set-Content "$R\logs\06_FIM.txt" "ok $(Get-Date -Format s)"
