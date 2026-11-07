# Assina um arquivo (exe/msi/instalador) durante o build do Tauri.
# Chamado pelo `bundle.windows.signCommand` que o CI injeta SOMENTE quando há certificado configurado.
#
# Métodos (o primeiro configurado vence):
#   1) SIGN_COMMAND       — comando completo do fornecedor, com {file} no lugar do arquivo.
#                           Serve para assinatura em nuvem (SSL.com eSigner CodeSignTool, DigiCert
#                           KeyLocker smctl, Certum SimplySign...). Ex. em docs/ASSINATURA.md.
#   2) WINDOWS_CERT_PFX_BASE64 + WINDOWS_CERT_PASSWORD — certificado .pfx em base64, assinado com signtool.
# Variável opcional: SIGN_TIMESTAMP_URL (padrão: http://timestamp.digicert.com).
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $File)) { throw "Arquivo para assinar não existe: $File" }
$ts = if ($env:SIGN_TIMESTAMP_URL) { $env:SIGN_TIMESTAMP_URL } else { "http://timestamp.digicert.com" }

if ($env:SIGN_COMMAND) {
  $cmd = $env:SIGN_COMMAND.Replace("{file}", "`"$File`"")
  Write-Host "Assinando (comando do fornecedor): $([IO.Path]::GetFileName($File))"
  cmd.exe /d /s /c $cmd
  if ($LASTEXITCODE -ne 0) { throw "SIGN_COMMAND falhou ($LASTEXITCODE) para $File" }
  exit 0
}

if ($env:WINDOWS_CERT_PFX_BASE64) {
  $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName | Select-Object -Last 1
  if (-not $signtool) { throw "signtool.exe não encontrado (Windows SDK)." }
  $pfx = Join-Path ($env:RUNNER_TEMP ?? $env:TEMP) "agtn-codesign.pfx"
  if (-not (Test-Path $pfx)) { [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERT_PFX_BASE64)) }
  Write-Host "Assinando (PFX): $([IO.Path]::GetFileName($File))"
  & $signtool.FullName sign /fd sha256 /td sha256 /tr $ts /f $pfx /p $env:WINDOWS_CERT_PASSWORD /d "AGTN Industrial CAD" $File
  if ($LASTEXITCODE -ne 0) { throw "signtool falhou ($LASTEXITCODE) para $File" }
  exit 0
}

Write-Host "Nenhum certificado configurado: $([IO.Path]::GetFileName($File)) fica sem assinatura."
exit 0
