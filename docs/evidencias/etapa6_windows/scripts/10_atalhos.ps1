# AGTN ETAPA 6 - passo 10: lista atalhos "AGTN" nas areas de trabalho e no menu Iniciar (SOMENTE LEITURA)
$o = "D:\AGTN_DEV\logs\10_atalhos.txt"; $r = @()
$sh = New-Object -ComObject WScript.Shell
foreach ($d in @([Environment]::GetFolderPath("Desktop"), "$env:USERPROFILE\Desktop", "$env:USERPROFILE\OneDrive\Desktop", "$env:PUBLIC\Desktop", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs") | Select-Object -Unique) {
  $r += "### $d"
  Get-ChildItem -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "AGTN" } | ForEach-Object {
    $t = ""; if ($_.Extension -eq ".lnk") { $l = $sh.CreateShortcut($_.FullName); $t = " -> " + $l.TargetPath + " (alvo existe: " + (Test-Path -LiteralPath $l.TargetPath) + ")" }
    $r += ("{0} | {1} | {2}{3}" -f $_.FullName, $_.LastWriteTime.ToString("s"), $(if ($_.PSIsContainer) { "pasta" } else { $_.Length }), $t)
  }
}
$r | Set-Content $o -Encoding UTF8
