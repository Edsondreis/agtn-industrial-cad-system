//! AGTN CAD — camada nativa.
//!
//! Responsabilidades (mínimas por decisão de arquitetura):
//! - E/S de arquivos com gravação atômica (arquivo temporário + rename), evitando corrupção
//!   de projetos em caso de queda de energia ou falha durante o salvamento.
//! - Arquivo de recuperação automática em `%LOCALAPPDATA%\br.com.agtn.cad\`.
//! - Arquivo passado na linha de comando (associação de `.agtncad`/`.dxf`/`.dwg` no Windows) e
//!   instância única (o 2º duplo clique abre o arquivo na janela já aberta).
//! - DWG ↔ DXF pelo ODA File Converter (programa externo gratuito da Open Design Alliance).
//! O motor geométrico, o documento e o DXF ficam no núcleo TypeScript (independente de UI).

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
 * DWG ↔ DXF — via ODA File Converter (Open Design Alliance, gratuito, instalado à parte).
 * O formato DWG é fechado; em vez de um leitor "aproximado", o AGTN CAD usa o conversor da ODA
 * (o mesmo motor de BricsCAD/DraftSight) como programa externo. Nada é embutido no AGTN CAD.
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

#[derive(serde::Serialize)]
struct ConverterInfo {
    path: Option<String>,
}

/// Localiza o conversor DWG (None = não instalado).
#[tauri::command]
fn dwg_converter(custom: Option<String>) -> ConverterInfo {
    ConverterInfo { path: find_oda(custom.as_deref()).map(|p| p.display().to_string()) }
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
fn convert_one(
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
    converter: Option<String>,
    jobs: Vec<ConvertJob>,
    format: String,
    version: String,
    overwrite: bool,
) -> Result<Vec<ConvertResult>, String> {
    let exe = find_oda(converter.as_deref()).ok_or_else(|| "ODA File Converter não encontrado.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let work = unique_temp_dir(Some(&app), "lote")?;
        let res = jobs
            .into_iter()
            .map(|j| {
                let r = convert_one(&exe, Path::new(&j.input), Path::new(&j.output), &format, &version, overwrite, &work);
                ConvertResult { ok: r.is_ok(), error: r.err(), input: j.input, output: j.output }
            })
            .collect::<Vec<_>>();
        let _ = fs::remove_dir_all(&work);
        Ok(res)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre um DWG: converte para DXF (R2018, sem perda de entidades modernas) e devolve os bytes do DXF.
#[tauri::command]
async fn dwg_read_as_dxf(app: tauri::AppHandle, converter: Option<String>, path: String) -> Result<Response, String> {
    let exe = find_oda(converter.as_deref()).ok_or_else(|| "ODA File Converter não encontrado.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let work = unique_temp_dir(Some(&app), "abrir")?;
        let out = work.join("resultado.dxf");
        let r = convert_one(&exe, Path::new(&path), &out, "DXF", "ACAD2018", true, &work).and_then(|_| fs::read(&out).map_err(|e| e.to_string()));
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
    let converter = h("x-converter")?;
    let bytes = match request.body() {
        InvokeBody::Raw(b) => b.clone(),
        _ => return Err("Corpo da requisição deve ser binário".into()),
    };
    let exe = find_oda(converter.as_deref()).ok_or_else(|| "ODA File Converter não encontrado.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        let work = unique_temp_dir(Some(&app), "salvar")?;
        let tmp = work.join("origem.dxf");
        let r = fs::write(&tmp, &bytes)
            .map_err(|e| e.to_string())
            .and_then(|_| convert_one(&exe, &tmp, Path::new(&path), "DWG", &version, true, &work.join("w")));
        let _ = fs::remove_dir_all(&work);
        r
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre a janela "Abrir com" do Windows para a extensão (com "Sempre usar este aplicativo").
/// O Windows 10/11 não permite que um programa se torne padrão sozinho — só o usuário confirma.
#[tauri::command]
fn choose_default_app(app: tauri::AppHandle, ext: String) -> Result<(), String> {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    if !["dxf", "dwg", "agtncad"].contains(&ext.as_str()) {
        return Err("Extensão não suportada".into());
    }
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("associacao");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let sample = dir.join(format!("exemplo.{ext}"));
    if !sample.is_file() {
        fs::write(&sample, b"").map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32.exe")
            .arg("shell32.dll,OpenAs_RunDLL")
            .arg(&sample)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Não foi possível abrir \"Abrir com\": {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = sample;
        Err("Disponível no Windows.".into())
    }
}

/// Abre a página oficial de download do ODA File Converter no navegador padrão.
#[tauri::command]
fn open_oda_download() -> Result<(), String> {
    const URL: &str = "https://www.opendesign.com/guestfiles/oda_file_converter";
    #[cfg(windows)]
    let r = std::process::Command::new("explorer").arg(URL).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(URL).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(URL).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
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
            write_file,
            write_text,
            file_exists,
            reveal_in_folder,
            recovery_save,
            recovery_load,
            recovery_clear,
            startup_file,
            dwg_converter,
            convert_cad,
            dwg_read_as_dxf,
            dwg_write_from_dxf,
            choose_default_app,
            open_oda_download
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
        let exe = Path::new("nao-existe");
        assert!(convert_one(exe, &txt, &dir.join("o.dxf"), "DXF", "ACAD2018", true, &dir).is_err());
        assert!(convert_one(exe, &dir.join("x.dwg"), &dir.join("o.dxf"), "PDF", "ACAD2018", true, &dir).is_err());
        assert!(convert_one(exe, &dir.join("x.dwg"), &dir.join("o.dxf"), "DXF", "ACAD1999", true, &dir).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    /// ODA falso: imita a linha de comando (pasta_in pasta_out VERSÃO TIPO rec audit filtro).
    #[cfg(unix)]
    #[test]
    fn convert_with_fake_oda() {
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
        convert_one(&exe, &src, &out, "DXF", "ACAD2018", false, &dir.join("w")).unwrap();
        assert_eq!(fs::read_to_string(&out).unwrap(), "ACAD2018 DXF\nCONTEUDO");
        // não sobrescreve sem permissão
        assert!(convert_one(&exe, &src, &out, "DXF", "ACAD2018", false, &dir.join("w")).is_err());
        // erro do ODA (.err) chega ao usuário
        let bad = dir.join("ruim.dxf");
        fs::write(&bad, b"RUIM").unwrap();
        let e = convert_one(&exe, &bad, &dir.join("ruim.dwg"), "DWG", "ACAD2013", true, &dir.join("w")).unwrap_err();
        assert!(e.contains("arquivo invalido"), "{e}");
        assert_eq!(find_oda(Some(dir.to_str().unwrap())), Some(exe.clone()));
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
}
