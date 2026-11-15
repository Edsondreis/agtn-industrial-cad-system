# AGTN ETAPA 6 - auditoria SOMENTE LEITURA do ambiente (nao instala, nao altera nada)
$ErrorActionPreference = "Continue"
$out = Join-Path $PSScriptRoot "auditoria_ambiente.txt"
$r = New-Object System.Collections.Generic.List[string]
function S($t) { $r.Add(""); $r.Add("== $t") }
function A($v) { if ($null -eq $v) { $r.Add("(nada)") } else { ($v | Out-String -Width 220).TrimEnd().Split("`n") | ForEach-Object { $r.Add($_.TrimEnd()) } } }
function T($b) { try { A (& $b) } catch { $r.Add("ERRO: " + $_.Exception.Message) } }
$r.Add("AGTN ETAPA 6 auditoria " + (Get-Date -Format s))
S "sistema"; T { $o = Get-CimInstance Win32_OperatingSystem; "{0} {1} build {2} arq {3}" -f $o.Caption, $o.Version, $o.BuildNumber, $o.OSArchitecture }
T { "PROCESSOR_ARCHITECTURE=$env:PROCESSOR_ARCHITECTURE; CPU=" + (Get-CimInstance Win32_Processor).Name + "; nucleos=" + (Get-CimInstance Win32_Processor).NumberOfLogicalProcessors + "; RAM_GB=" + [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,1) }
T { $c = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"; "DisplayVersion=" + $c.DisplayVersion + " UBR=" + $c.UBR + " Edition=" + $c.EditionID }
S "discos"; T { Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, VolumeName, FileSystem, @{n="LivreGB";e={[math]::Round($_.FreeSpace/1GB,1)}}, @{n="TotalGB";e={[math]::Round($_.Size/1GB,1)}} | Format-Table -AutoSize }
S "usuario e privilegios"; T { whoami }
T { $id = [Security.Principal.WindowsIdentity]::GetCurrent(); $p = New-Object Security.Principal.WindowsPrincipal($id); "processo elevado agora: " + $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
T { "membro do grupo Administradores: " + [bool](whoami /groups | Select-String "S-1-5-32-544") }
T { $u = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"; "UAC EnableLUA=" + $u.EnableLUA + " ConsentPromptBehaviorAdmin=" + $u.ConsentPromptBehaviorAdmin + " PromptOnSecureDesktop=" + $u.PromptOnSecureDesktop }
S "reinicializacao pendente"; T { @("HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending","HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired") | ForEach-Object { "$_ -> " + (Test-Path $_) } }
T { "PendingFileRenameOperations: " + [bool]((Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager" -ErrorAction SilentlyContinue).PendingFileRenameOperations) }
S "caminhos longos"; T { "LongPathsEnabled=" + (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem").LongPathsEnabled }
S "PowerShell"; T { "PS " + $PSVersionTable.PSVersion + "; pwsh: " + [bool](Get-Command pwsh -ErrorAction SilentlyContinue) }; T { Get-ExecutionPolicy -List | Format-Table -AutoSize }
S "winget"; T { $w = Get-Command winget -ErrorAction SilentlyContinue; if ($w) { "winget " + (winget --version) } else { "winget AUSENTE" } }
T { Get-AppxPackage Microsoft.DesktopAppInstaller | Select-Object Name, Version | Format-Table -AutoSize }
S "ferramentas no PATH"; foreach ($c in "git","node","npm","npx","cargo","rustc","rustup","cl","link","makensis","candle","python","py") { T { $g = Get-Command $c -ErrorAction SilentlyContinue; if ($g) { "$c -> " + $g.Source } else { "$c -> AUSENTE" } } }
S "rust (pastas padrao)"; T { foreach ($p in "$env:USERPROFILE\.cargo","$env:USERPROFILE\.rustup","D:\.cargo","D:\.rustup") { "$p existe=" + (Test-Path $p) } }
T { "RUSTUP_HOME=$env:RUSTUP_HOME CARGO_HOME=$env:CARGO_HOME CARGO_TARGET_DIR=$env:CARGO_TARGET_DIR" }
S "Visual Studio / Build Tools"; T { $vw = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"; if (Test-Path $vw) { & $vw -all -products * -format text } else { "vswhere ausente (nenhum Visual Studio / Build Tools)" } }
T { foreach ($p in "C:\Program Files\Microsoft Visual Studio","C:\Program Files (x86)\Microsoft Visual Studio","D:\BuildTools","C:\ProgramData\Microsoft\VisualStudio\Packages") { "$p existe=" + (Test-Path $p) } }
S "Windows SDK"; T { $k = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SDKs\Windows\v10.0"; if (Test-Path $k) { Get-ItemProperty $k | Select-Object InstallationFolder, ProductVersion | Format-List } else { "Windows 10/11 SDK: AUSENTE" } }
T { $kf = "${env:ProgramFiles(x86)}\Windows Kits\10\Include"; if (Test-Path $kf) { (Get-ChildItem $kf -Directory).Name } else { "pasta Windows Kits\10\Include ausente" } }
S "VC++ Redistributable"; T { Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" -ErrorAction SilentlyContinue | Select-Object Installed, Version | Format-List }
S ".NET Framework / recursos opcionais"; T { "NET4 Release=" + (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" -ErrorAction SilentlyContinue).Release }
T { "vbscript.dll presente=" + (Test-Path "$env:WINDIR\System32\vbscript.dll") }
S "WebView2 Runtime"; foreach ($k in "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}","HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}") { T { "$k -> " + (Get-ItemProperty $k -ErrorAction SilentlyContinue).pv } }
S "AGTN instalado (desinstaladores)"; T { $o = foreach ($root in "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall","HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall","HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall") { Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -like "*AGTN*" } | Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation, UninstallString, PSPath }; if ($o) { $o | Format-List } else { "nenhuma instalacao do AGTN encontrada" } }
S "dados do AGTN no perfil"; T { foreach ($p in "$env:LOCALAPPDATA\br.com.agtn.cad","$env:APPDATA\br.com.agtn.cad","$env:LOCALAPPDATA\AGTN Industrial CAD","$env:LOCALAPPDATA\Programs\AGTN Industrial CAD") { if (Test-Path $p) { "$p existe; " + ((Get-ChildItem $p -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1MB).ToString("0.0") + " MB" } else { "$p ausente" } } }
T { $k = "HKCU:\Software\AGTN\AGTN Industrial CAD"; if (Test-Path $k) { Get-ItemProperty $k | Format-List } else { "$k ausente" } }
T { "associacoes .agtncad/.dxf/.dwg (HKCU Classes): " + ((".agtncad",".dxf",".dwg" | ForEach-Object { $_ + "=" + (Get-ItemProperty "HKCU:\Software\Classes\$_" -ErrorAction SilentlyContinue).'(default)' }) -join "; ") }
T { "programa padrao (UserChoice) .dxf=" + (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.dxf\UserChoice" -ErrorAction SilentlyContinue).ProgId + " .dwg=" + (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.dwg\UserChoice" -ErrorAction SilentlyContinue).ProgId }
S "projetos .agtncad do usuario (contagem em Documents/Desktop/OneDrive)"; T { foreach ($p in [Environment]::GetFolderPath("MyDocuments"), [Environment]::GetFolderPath("Desktop"), "$env:USERPROFILE\OneDrive") { if (Test-Path $p) { "$p -> " + @(Get-ChildItem $p -Recurse -Filter *.agtncad -File -ErrorAction SilentlyContinue).Count + " arquivo(s)" } } }
S "variaveis de ambiente"; T { "TEMP=$env:TEMP"; "PATH (usuario)=" + [Environment]::GetEnvironmentVariable("Path","User"); "PATH (maquina)=" + [Environment]::GetEnvironmentVariable("Path","Machine") }
T { Get-ChildItem env: | Where-Object { $_.Name -match "^(npm_|NODE|RUST|CARGO|VS|VCINSTALL|WindowsSdk|TAURI|WEBVIEW2)" } | Format-Table -AutoSize }
S "antivirus (somente leitura)"; T { $m = Get-MpComputerStatus -ErrorAction SilentlyContinue; if ($m) { "Defender tempo real=" + $m.RealTimeProtectionEnabled + "; antimalware=" + $m.AMServiceEnabled } else { "Get-MpComputerStatus indisponivel" } }
T { Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Select-Object displayName | Format-Table -AutoSize }
S "Smart App Control"; T { "VerifiedAndReputablePolicyState=" + (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy" -ErrorAction SilentlyContinue).VerifiedAndReputablePolicyState }
S "rede (HEAD, sem download)"; foreach ($u in "https://github.com","https://static.rust-lang.org","https://win.rustup.rs","https://nodejs.org","https://registry.npmjs.org","https://index.crates.io/config.json","https://static.crates.io","https://aka.ms/vs/17/release/vs_buildtools.exe","https://download.visualstudio.microsoft.com","https://cdn.winget.microsoft.com/cache") { T { try { $x = Invoke-WebRequest -Uri $u -Method Head -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 0 -ErrorAction Stop; "$u -> " + $x.StatusCode } catch { $s = $_.Exception.Response.StatusCode.value__; if ($s) { "$u -> HTTP $s (alcancavel)" } else { "$u -> FALHOU: " + $_.Exception.Message } } } }
S "pasta de teste da ETAPA 5"; T { Get-ChildItem "$env:USERPROFILE\Desktop\AGTN_HOMOLOGACAO_ETAPA5" -ErrorAction SilentlyContinue | Select-Object Name, Length | Format-Table -AutoSize }
S "FIM"
[IO.File]::WriteAllLines($out, $r, (New-Object Text.UTF8Encoding($true)))
