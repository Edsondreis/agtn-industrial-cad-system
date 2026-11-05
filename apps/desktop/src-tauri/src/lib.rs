//! AGTN CAD — camada nativa.
//!
//! Responsabilidades (mínimas por decisão de arquitetura):
//! - E/S de arquivos com gravação atômica (arquivo temporário + rename), evitando corrupção
//!   de projetos em caso de queda de energia ou falha durante o salvamento.
//! - Arquivo de recuperação automática em `%LOCALAPPDATA%\br.com.agtn.cad\`.
//! - Arquivo passado na linha de comando (associação de `.agtncad` no Windows).
//! O motor geométrico, o documento e o DXF ficam no núcleo TypeScript (independente de UI).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

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

/// Arquivo informado na linha de comando (duplo clique em um .agtncad / .dxf).
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| !a.starts_with('-') && Path::new(a).is_file())
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            write_text,
            file_exists,
            recovery_save,
            recovery_load,
            recovery_clear,
            startup_file
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
