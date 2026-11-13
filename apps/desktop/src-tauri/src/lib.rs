//! AGTN CAD — camada nativa.
//!
//! Responsabilidades (mínimas por decisão de arquitetura):
//! - E/S de arquivos com gravação atômica (arquivo temporário + rename), evitando corrupção
//!   de projetos em caso de queda de energia ou falha durante o salvamento.
//! - Arquivo de recuperação automática em `%LOCALAPPDATA%\br.com.agtn.cad\`.
//! - Arquivo passado na linha de comando (associação de `.agtncad`/`.dxf`/`.dwg` no Windows) e
//!   instância única (o 2º duplo clique abre o arquivo na janela já aberta).
//! - DWG ↔ DXF com conversor próprio (`cadconv`, motor acadrust embutido) — nada para instalar.
//! O motor geométrico, o documento e o DXF ficam no núcleo TypeScript (independente de UI).

pub mod cadconv;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Emitter, Manager};

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("Caminho inválido")?;
    if !dir.as_os_str().is_empty() {
        fs::create_dir_all(dir).map_err(|e| format!("Não foi possível criar a pasta: {e}"))?;
    }
    let file_name = path
        .file_name()
        .ok_or("Nome de arquivo inválido")?
        .to_string_lossy()
        .to_string();
    let tmp = dir.join(format!(".{file_name}.agtn-tmp"));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Erro ao gravar: {e}"))?;
        f.write_all(data).map_err(|e| format!("Erro ao gravar: {e}"))?;
        f.sync_all().map_err(|e| format!("Erro ao gravar: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Erro ao substituir o arquivo: {e}")
    })
}

/// Lê um arquivo e devolve os bytes crus (ArrayBuffer no front-end).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Não foi possível abrir \"{path}\": {e}"))
}

/// Binários do motor 3D permitidos (lista fechada: nada de caminho vindo do front-end).
const ENGINE_FILES: &[&str] = &["occt-wasm.wasm"];

/// Lê o motor geométrico 3D (OCCT em WebAssembly) dos recursos do instalador (`occt/`).
/// Fica fora do executável de propósito: é LGPL e o usuário pode substituí-lo por outra compilação.
#[tauri::command]
fn read_engine(app: tauri::AppHandle, name: String) -> Result<Response, String> {
    if !ENGINE_FILES.contains(&name.as_str()) {
        return Err(format!("Arquivo de motor desconhecido: {name}"));
    }
    let path = app
        .path()
        .resolve(format!("occt/{name}"), tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Pasta de recursos não encontrada: {e}"))?;
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Motor 3D ausente ou ilegível em \"{}\": {e}. Reinstale o AGTN Industrial CAD.", path.display()))
}

/// Grava bytes crus recebidos no corpo da requisição; o caminho vem no cabeçalho `x-path` (URI-encoded).
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let raw = request
        .headers()
        .get("x-path")
        .ok_or("Cabeçalho x-path ausente")?
        .to_str()
        .map_err(|_| "Cabeçalho x-path inválido")?;
    let path = percent_decode(raw)?;
    match request.body() {
        InvokeBody::Raw(bytes) => write_atomic(Path::new(&path), bytes),
        _ => Err("Corpo da requisição deve ser binário".into()),
    }
}

/// Grava texto UTF-8 (projetos .agtncad).
#[tauri::command]
fn write_text(path: String, contents: String) -> Result<(), String> {
    write_atomic(Path::new(&path), contents.as_bytes())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

fn recovery_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Pasta de dados indisponível: {e}"))?;
    Ok(dir.join("recuperacao.agtncad"))
}

#[tauri::command]
fn recovery_save(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    write_atomic(&recovery_file(&app)?, contents.as_bytes())
}

#[tauri::command]
fn recovery_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = recovery_file(&app)?;
    if !p.is_file() {
        return Ok(None);
    }
    fs::read_to_string(&p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn recovery_clear(app: tauri::AppHandle) -> Result<(), String> {
    let p = recovery_file(&app)?;
    if p.is_file() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Abre a pasta do arquivo no gerenciador do sistema, com o arquivo selecionado (Explorer no Windows).
#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Arquivo não encontrado: {path}"));
    }
    #[cfg(target_os = "windows")]
    let res = std::process::Command::new("explorer")
        .arg(format!("/select,{}", p.display()))
        .spawn();
    #[cfg(target_os = "macos")]
    let res = std::process::Command::new("open").arg("-R").arg(p).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let res = std::process::Command::new("xdg-open")
        .arg(p.parent().unwrap_or(p))
        .spawn();
    res.map(|_| ()).map_err(|e| format!("Não foi possível abrir a pasta: {e}"))
}

/// Arquivo informado na linha de comando (duplo clique em um .agtncad / .dxf).
#[tauri::command]
fn startup_file() -> Option<String> {
    file_from_args(&std::env::args().collect::<Vec<_>>())
}

/* ------------------------------------------------------------------------------------------
 * DWG ↔ DXF — conversor PRÓPRIO (módulo `cadconv`, motor acadrust embutido; nada para instalar).
 * Cada conversão roda num processo filho (o próprio executável com `--agtn-cadconv`) para que um
 * arquivo corrompido nunca derrube a janela. Reforço opcional e silencioso: se o motor próprio
 * falhar e o ODA File Converter já estiver instalado no PC, tenta por ele.
 * ------------------------------------------------------------------------------------------ */

const ODA_EXE: &str = if cfg!(windows) { "ODAFileConverter.exe" } else { "ODAFileConverter" };

/// Versões aceitas pelo ODA File Converter (texto exato da linha de comando).
const ODA_VERSIONS: [&str; 11] = [
    "ACAD9", "ACAD10", "ACAD12", "ACAD13", "ACAD14", "ACAD2000", "ACAD2004", "ACAD2007", "ACAD2010", "ACAD2013",
    "ACAD2018",
];

/// Ordena "ODAFileConverter 26.10.0" > "ODAFileConverter 25.4.0" numericamente.
fn version_key(name: &str) -> Vec<u64> {
    name.split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.parse().ok())
        .collect()
}

/// Procura o ODAFileConverter: caminho configurado → pastas padrão da ODA (versão mais nova) → PATH.
fn find_oda(custom: Option<&str>) -> Option<PathBuf> {
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        if p.is_file() {
            return Some(p);
        }
        if p.join(ODA_EXE).is_file() {
            return Some(p.join(ODA_EXE));
        }
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(v) = std::env::var(var) {
            roots.push(PathBuf::from(&v).join("ODA"));
            if var == "LOCALAPPDATA" {
                roots.push(PathBuf::from(&v).join("Programs").join("ODA"));
            }
        }
    }
    if cfg!(windows) {
        roots.push(PathBuf::from(r"C:\Program Files\ODA"));
    } else {
        roots.push(PathBuf::from("/usr/bin"));
        roots.push(PathBuf::from("/opt/ODAFileConverter"));
    }
    let mut found: Vec<(Vec<u64>, PathBuf)> = Vec::new();
    for r in &roots {
        if r.join(ODA_EXE).is_file() {
            found.push((vec![0], r.join(ODA_EXE)));
        }
        if let Ok(rd) = fs::read_dir(r) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if !name.to_ascii_lowercase().starts_with("odafileconverter") {
                    continue;
                }
                let exe = e.path().join(ODA_EXE);
                if exe.is_file() {
                    found.push((version_key(&name), exe));
                }
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    if let Some((_, p)) = found.into_iter().next() {
        return Some(p);
    }
    if let Ok(path) = std::env::var("PATH") {
        for d in std::env::split_paths(&path) {
            if d.join(ODA_EXE).is_file() {
                return Some(d.join(ODA_EXE));
            }
        }
    }
    None
}

fn unique_temp_dir(app: Option<&tauri::AppHandle>, tag: &str) -> Result<PathBuf, String> {
    let base = app
        .and_then(|a| a.path().app_local_data_dir().ok())
        .map(|d| d.join("conversao"))
        .unwrap_or_else(|| std::env::temp_dir().join("agtn-cad-conversao"));
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let d = base.join(format!("{tag}-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&d).map_err(|e| format!("Pasta temporária indisponível: {e}"))?;
    Ok(d)
}

/// Converte UM arquivo DWG/DXF com o ODA File Converter.
/// O ODA trabalha por pastas: o arquivo é copiado sozinho para uma pasta temporária (nome ASCII),
/// convertido para outra pasta temporária e o resultado é movido para `output` (gravação atômica).
fn oda_convert_one(
    exe: &Path,
    input: &Path,
    output: &Path,
    format: &str,
    version: &str,
    overwrite: bool,
    work: &Path,
) -> Result<(), String> {
    let format = format.to_ascii_uppercase();
    if format != "DXF" && format != "DWG" {
        return Err(format!("Formato de saída inválido: {format}"));
    }
    if !ODA_VERSIONS.contains(&version) {
        return Err(format!("Versão inválida: {version}"));
    }
    let ext = input
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if ext != "dwg" && ext != "dxf" {
        return Err(format!("\"{}\" não é DWG nem DXF.", input.display()));
    }
    if !input.is_file() {
        return Err(format!("Arquivo não encontrado: {}", input.display()));
    }
    if output.exists() && !overwrite {
        return Err(format!("Já existe: {}", output.display()));
    }
    let din = work.join("entrada");
    let dout = work.join("saida");
    let _ = fs::remove_dir_all(&din);
    let _ = fs::remove_dir_all(&dout);
    fs::create_dir_all(&din).map_err(|e| e.to_string())?;
    fs::create_dir_all(&dout).map_err(|e| e.to_string())?;
    let src_name = format!("desenho.{ext}");
    fs::copy(input, din.join(&src_name)).map_err(|e| format!("Não foi possível ler \"{}\": {e}", input.display()))?;

    let mut cmd = std::process::Command::new(exe);
    cmd.arg(&din)
        .arg(&dout)
        .arg(version)
        .arg(&format)
        .arg("0") // recursivo: não
        .arg("1") // auditar e reparar ao carregar
        .arg(&src_name)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("Não foi possível executar o ODA File Converter ({}): {e}", exe.display()))?;

    let result = dout.join(format!("desenho.{}", format.to_ascii_lowercase()));
    if !result.is_file() {
        // o ODA grava um .err com o motivo quando a conversão falha
        let mut why = String::new();
        if let Ok(rd) = fs::read_dir(&dout) {
            for e in rd.flatten() {
                if e.path().extension().map(|x| x.eq_ignore_ascii_case("err")).unwrap_or(false) {
                    why = fs::read_to_string(e.path()).unwrap_or_default();
                }
            }
        }
        if why.trim().is_empty() {
            why = String::from_utf8_lossy(&out.stderr).to_string();
        }
        let why = why.trim();
        return Err(if why.is_empty() {
            format!("O ODA File Converter não gerou o arquivo (código {:?}). O arquivo pode estar corrompido ou protegido.", out.status.code())
        } else {
            format!("Falha na conversão: {why}")
        });
    }
    let bytes = fs::read(&result).map_err(|e| e.to_string())?;
    write_atomic(output, &bytes)
}

/// Executável que faz a conversão (o próprio app). Em testes, a conversão roda no mesmo processo.
fn run_native(input: &Path, tmp_out: &Path, format: cadconv::Format, version: &str, err_file: &Path) -> Result<(), String> {
    let args = vec![
        cadconv::CLI_FLAG.to_string(),
        input.display().to_string(),
        tmp_out.display().to_string(),
        format.ext().to_ascii_uppercase(),
        version.to_string(),
        err_file.display().to_string(),
    ];
    let code = if cfg!(test) {
        cadconv::cli_main(&args)
    } else {
        let exe = std::env::current_exe().map_err(|e| format!("Executável não encontrado: {e}"))?;
        let mut cmd = std::process::Command::new(exe);
        cmd.args(&args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| format!("Não foi possível iniciar o conversor: {e}"))?;
        // limite de 10 min por arquivo (arquivo patológico não trava o lote)
        let t0 = std::time::Instant::now();
        loop {
            match child.try_wait().map_err(|e| e.to_string())? {
                Some(st) => break st.code().unwrap_or(-1),
                None if t0.elapsed() > std::time::Duration::from_secs(600) => {
                    let _ = child.kill();
                    return Err("Tempo esgotado (10 min) — arquivo grande demais ou corrompido.".into());
                }
                None => std::thread::sleep(std::time::Duration::from_millis(25)),
            }
        }
    };
    if code == 0 && tmp_out.is_file() {
        return Ok(());
    }
    let why = fs::read_to_string(err_file).unwrap_or_default();
    Err(if why.trim().is_empty() {
        "O conversor parou ao ler este arquivo (corrompido ou com objetos não suportados).".into()
    } else {
        why.trim().to_string()
    })
}

/// Converte UM arquivo DWG/DXF → `output`. Motor próprio; ODA só como reforço se já instalado.
fn convert_one(input: &Path, output: &Path, format: &str, version: &str, overwrite: bool, work: &Path) -> Result<(), String> {
    let fmt = cadconv::Format::parse(format)?;
    cadconv::version_from_id(version)?;
    cadconv::Format::of_path(input)?;
    if !input.is_file() {
        return Err(format!("Arquivo não encontrado: {}", input.display()));
    }
    if output.exists() && !overwrite {
        return Err(format!("Já existe: {}", output.display()));
    }
    fs::create_dir_all(work).map_err(|e| e.to_string())?;
    let tmp = work.join(format!("resultado.{}", fmt.ext()));
    let err = work.join("erro.txt");
    let _ = fs::remove_file(&tmp);
    let _ = fs::remove_file(&err);
    match run_native(input, &tmp, fmt, version, &err) {
        Ok(()) => {
            let bytes = fs::read(&tmp).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(&tmp);
            write_atomic(output, &bytes)
        }
        Err(native_err) => match find_oda(None) {
            Some(exe) => {
                oda_convert_one(&exe, input, output, format, version, overwrite, &work.join("oda")).map_err(|_| native_err)
            }
            _ => Err(native_err),
        },
    }
}

/// Converte uma lista de arquivos. Cada item volta com o caminho gerado ou o erro (não para no 1º erro).
#[derive(serde::Deserialize)]
struct ConvertJob {
    input: String,
    output: String,
}
#[derive(serde::Serialize)]
struct ConvertResult {
    input: String,
    output: String,
    ok: bool,
    error: Option<String>,
}

#[tauri::command]
async fn convert_cad(
    app: tauri::AppHandle,
    jobs: Vec<ConvertJob>,
    format: String,
    version: String,
    overwrite: bool,
) -> Result<Vec<ConvertResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let work = unique_temp_dir(Some(&app), "lote")?;
        let res = jobs
            .into_iter()
            .map(|j| {
                let r = convert_one(Path::new(&j.input), Path::new(&j.output), &format, &version, overwrite, &work);
                ConvertResult { ok: r.is_ok(), error: r.err(), input: j.input, output: j.output }
            })
            .collect::<Vec<_>>();
        let _ = fs::remove_dir_all(&work);
        Ok(res)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre um DWG: converte para DXF 2018 (mesmo resultado do DXF do AutoCAD) e devolve os bytes do DXF.
#[tauri::command]
async fn dwg_read_as_dxf(app: tauri::AppHandle, path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let work = unique_temp_dir(Some(&app), "abrir")?;
        let out = work.join("aberto.dxf");
        let r = convert_one(Path::new(&path), &out, "DXF", "ACAD2018", true, &work.join("c")).and_then(|_| fs::read(&out).map_err(|e| e.to_string()));
        let _ = fs::remove_dir_all(&work);
        r.map(Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Grava um DWG a partir de bytes DXF (o caminho de destino vem no cabeçalho `x-path`,
/// versão em `x-version`, conversor opcional em `x-converter`).
#[tauri::command]
async fn dwg_write_from_dxf(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> {
    let h = |k: &str| -> Result<Option<String>, String> {
        match request.headers().get(k) {
            None => Ok(None),
            Some(v) => percent_decode(v.to_str().map_err(|_| format!("Cabeçalho {k} inválido"))?).map(Some),
        }
    };
    let path = h("x-path")?.ok_or("Cabeçalho x-path ausente")?;
    let version = h("x-version")?.unwrap_or_else(|| "ACAD2018".into());
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        _ => return Err("Corpo da requisição deve ser binário".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let work = unique_temp_dir(Some(&app), "salvar")?;
        let tmp = work.join("origem.dxf");
        let r = fs::write(&tmp, &bytes)
            .map_err(|e| e.to_string())
            .and_then(|_| convert_one(&tmp, Path::new(&path), "DWG", &version, true, &work.join("w")));
        let _ = fs::remove_dir_all(&work);
        r
    })
    .await
    .map_err(|e| e.to_string())?
}

/* ----------------------------- programa padrão (.dwg / .dxf) ----------------------------- */

fn progid(ext: &str) -> Result<&'static str, String> {
    match ext.trim_start_matches('.').to_ascii_lowercase().as_str() {
        "dwg" => Ok("AGTNCAD.DWG"),
        "dxf" => Ok("AGTNCAD.DXF"),
        _ => Err("Extensão não suportada".into()),
    }
}

#[cfg(windows)]
mod default_app {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const FILEEXTS: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts";

    /// ProgID que o Explorer usa hoje para a extensão (escolha do usuário > classe padrão).
    pub fn current(ext: &str) -> Option<String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for sub in ["UserChoiceLatest", "UserChoice"] {
            if let Ok(k) = hkcu.open_subkey(format!(r"{FILEEXTS}\.{ext}\{sub}")) {
                if let Ok(v) = k.get_value::<String, _>("ProgId") {
                    return Some(v);
                }
            }
        }
        let hkcr = RegKey::predef(winreg::enums::HKEY_CLASSES_ROOT);
        hkcr.open_subkey(format!(".{ext}")).ok()?.get_value::<String, _>("").ok()
    }

    /// Registra a classe (também no executável portátil), define como padrão e remove a escolha
    /// anterior guardada pelo Windows para a extensão.
    pub fn apply(ext: &str, progid: &str, description: &str) -> std::io::Result<()> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let exe = std::env::current_exe()?.display().to_string();
        let (cls, _) = hkcu.create_subkey(format!(r"Software\Classes\{progid}"))?;
        cls.set_value("", &description)?;
        let (icon, _) = hkcu.create_subkey(format!(r"Software\Classes\{progid}\DefaultIcon"))?;
        icon.set_value("", &format!("\"{exe}\",0"))?;
        let (cmd, _) = hkcu.create_subkey(format!(r"Software\Classes\{progid}\shell\open\command"))?;
        cmd.set_value("", &format!("\"{exe}\" \"%1\""))?;
        let (e, _) = hkcu.create_subkey(format!(r"Software\Classes\.{ext}"))?;
        e.set_value("", &progid)?;
        let (owp, _) = hkcu.create_subkey(format!(r"Software\Classes\.{ext}\OpenWithProgids"))?;
        owp.set_value(progid, &"")?;
        for sub in ["UserChoiceLatest", "UserChoice"] {
            let _ = hkcu.delete_subkey_all(format!(r"{FILEEXTS}\.{ext}\{sub}"));
        }
        notify();
        Ok(())
    }

    pub fn notify() {
        use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
    }
}

/// O AGTN Industrial CAD já é o programa padrão da extensão?
#[tauri::command]
fn is_default_app(ext: String) -> Result<bool, String> {
    let id = progid(&ext)?;
    #[cfg(windows)]
    {
        Ok(default_app::current(ext.trim_start_matches('.')).map(|p| p.eq_ignore_ascii_case(id)).unwrap_or(false))
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        Ok(false)
    }
}

/// Torna o AGTN Industrial CAD o padrão da extensão. Retorna "direto" se aplicado; se o Windows
/// recusar (política da empresa, proteção do sistema), abre "Abrir com" e retorna "abrir-com".
#[tauri::command]
fn make_default_app(app: tauri::AppHandle, ext: String) -> Result<String, String> {
    let id = progid(&ext)?;
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    #[cfg(windows)]
    {
        let desc = if ext == "dwg" { "Desenho DWG (AutoCAD)" } else { "Desenho DXF" };
        if default_app::apply(&ext, id, desc).is_ok()
            && default_app::current(&ext).map(|p| p.eq_ignore_ascii_case(id)).unwrap_or(false)
        {
            return Ok("direto".into());
        }
        let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("associacao");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let sample = dir.join(format!("exemplo.{ext}"));
        if !sample.is_file() {
            fs::write(&sample, b"").map_err(|e| e.to_string())?;
        }
        std::process::Command::new("rundll32.exe")
            .arg("shell32.dll,OpenAs_RunDLL")
            .arg(&sample)
            .spawn()
            .map_err(|e| format!("Não foi possível abrir \"Abrir com\": {e}"))?;
        Ok("abrir-com".into())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, id, ext);
        Err("Disponível no Windows.".into())
    }
}

/// Arquivo da linha de comando de uma 2ª instância (duplo clique com o app já aberto).
fn file_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
        .cloned()
}

fn percent_decode(s: &str) -> Result<String, String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|_| "x-path inválido")?;
            out.push(u8::from_str_radix(h, 16).map_err(|_| "x-path inválido")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "x-path não é UTF-8".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // instância única: duplo clique em .agtncad/.dxf/.dwg com o app aberto abre no app aberto
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if let Some(f) = file_from_args(&args) {
                let _ = app.emit("open-file", f);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_engine,
            write_file,
            write_text,
            file_exists,
            reveal_in_folder,
            recovery_save,
            recovery_load,
            recovery_clear,
            startup_file,
            convert_cad,
            dwg_read_as_dxf,
            dwg_write_from_dxf,
            is_default_app,
            make_default_app
        ])
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o AGTN CAD");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_path() {
        assert_eq!(percent_decode("C%3A%5CPe%C3%A7as%5Ca.dxf").unwrap(), "C:\\Peças\\a.dxf");
        assert_eq!(percent_decode("abc").unwrap(), "abc");
    }

    #[test]
    fn progids() {
        assert_eq!(progid(".DWG").unwrap(), "AGTNCAD.DWG");
        assert_eq!(progid("dxf").unwrap(), "AGTNCAD.DXF");
        assert!(progid("agtncad").is_err());
    }

    #[test]
    fn oda_version_order() {
        assert!(version_key("ODAFileConverter 26.10.0") > version_key("ODAFileConverter 25.4.0"));
        assert!(version_key("ODAFileConverter 27.1.0") > version_key("ODAFileConverter 26.12.0"));
    }

    #[test]
    fn args_file() {
        let me = std::env::current_exe().unwrap().display().to_string();
        assert_eq!(file_from_args(&["app".into(), "--flag".into(), me.clone()]), Some(me));
        assert_eq!(file_from_args(&["app".into(), "naoexiste.dwg".into()]), None);
    }

    #[test]
    fn convert_rejects_bad_input() {
        let dir = std::env::temp_dir().join("agtn-cad-conv-test");
        fs::create_dir_all(&dir).unwrap();
        let txt = dir.join("a.txt");
        fs::write(&txt, b"x").unwrap();
        assert!(convert_one(&txt, &dir.join("o.dxf"), "DXF", "ACAD2018", true, &dir).is_err());
        assert!(convert_one(&dir.join("x.dwg"), &dir.join("o.dxf"), "PDF", "ACAD2018", true, &dir).is_err());
        assert!(convert_one(&dir.join("x.dwg"), &dir.join("o.dxf"), "DXF", "ACAD1999", true, &dir).is_err());
        assert!(convert_one(&dir.join("naoexiste.dwg"), &dir.join("o.dxf"), "DXF", "ACAD2018", true, &dir).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    /// ODA falso: imita a linha de comando (pasta_in pasta_out VERSÃO TIPO rec audit filtro).
    #[cfg(unix)]
    #[test]
    fn oda_fallback_with_fake_oda() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("agtn-fake-oda-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("ODAFileConverter");
        fs::write(
            &exe,
            "#!/bin/sh\nin=\"$1\"; out=\"$2\"; ver=\"$3\"; ty=$(echo \"$4\" | tr A-Z a-z); f=\"$7\"\n\
             if grep -q RUIM \"$in/$f\"; then echo 'arquivo invalido' > \"$out/${f%.*}.err\"; exit 0; fi\n\
             { echo \"$ver $4\"; cat \"$in/$f\"; } > \"$out/${f%.*}.$ty\"\n",
        )
        .unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();
        let src = dir.join("Peça 01.dwg");
        fs::write(&src, b"CONTEUDO").unwrap();
        let out = dir.join("saída").join("Peça 01.dxf");
        oda_convert_one(&exe, &src, &out, "DXF", "ACAD2018", false, &dir.join("w")).unwrap();
        assert_eq!(fs::read_to_string(&out).unwrap(), "ACAD2018 DXF\nCONTEUDO");
        // não sobrescreve sem permissão
        assert!(oda_convert_one(&exe, &src, &out, "DXF", "ACAD2018", false, &dir.join("w")).is_err());
        // erro do ODA (.err) chega ao usuário
        let bad = dir.join("ruim.dxf");
        fs::write(&bad, b"RUIM").unwrap();
        let e = oda_convert_one(&exe, &bad, &dir.join("ruim.dwg"), "DWG", "ACAD2013", true, &dir.join("w")).unwrap_err();
        assert!(e.contains("arquivo invalido"), "{e}");
        assert_eq!(find_oda(Some(dir.to_str().unwrap())), Some(exe.clone()));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn native_convert_files_with_accents() {
        let dir = std::env::temp_dir().join(format!("agtn-native-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("Peça Ç 01.dxf");
        fs::write(&src, "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n5\n0\nENDSEC\n0\nEOF\n").unwrap();
        let dwg = dir.join("saída").join("Peça Ç 01.dwg");
        convert_one(&src, &dwg, "DWG", "ACAD2018", false, &dir.join("w")).unwrap();
        assert!(fs::read(&dwg).unwrap().starts_with(b"AC1032"));
        assert!(convert_one(&src, &dwg, "DWG", "ACAD2018", false, &dir.join("w")).unwrap_err().contains("Já existe"));
        let dxf = dir.join("volta.dxf");
        convert_one(&dwg, &dxf, "DXF", "ACAD12", false, &dir.join("w")).unwrap();
        assert!(fs::read_to_string(&dxf).unwrap().contains("LINE"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn atomic_write_roundtrip() {
        let dir = std::env::temp_dir().join("agtn-cad-test");
        let p = dir.join("t.agtncad");
        write_atomic(&p, b"{\"format\":\"agtncad\"}").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"{\"format\":\"agtncad\"}");
        write_atomic(&p, b"2").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"2");
        let _ = fs::remove_dir_all(dir);
    }

    /// Auditoria FASE 3 (A04): queda no meio do salvamento deixa só o temporário pela metade —
    /// o arquivo original continua íntegro e o próximo salvamento funciona.
    #[test]
    fn interrupted_save_keeps_original() {
        let dir = std::env::temp_dir().join("agtn-cad-test-int");
        let p = dir.join("peca.agtncad");
        let original = b"{\"format\":\"agtncad\",\"extras\":{\"agtn3d\":{}}}";
        write_atomic(&p, original).unwrap();
        // simula o processo morto depois de escrever parte do temporário e antes do rename
        let tmp = dir.join(".peca.agtncad.agtn-tmp");
        fs::write(&tmp, b"{\"format\":\"agtn").unwrap();
        assert_eq!(fs::read(&p).unwrap(), original);
        write_atomic(&p, b"{\"novo\":1}").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"{\"novo\":1}");
        assert!(!tmp.exists());
        let _ = fs::remove_dir_all(dir);
    }
}
