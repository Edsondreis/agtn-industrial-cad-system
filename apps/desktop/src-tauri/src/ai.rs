//! AGTN AI ASSISTANT — canal HTTP do Gemini e guarda da chave (lado nativo).
//!
//! Por que no Rust: a CSP do app só libera IPC no `connect-src` (o WebView não fala com a internet) e a chave da API
//! não pode ficar no JavaScript, no `.agtncad`, no código ou no executável. Aqui:
//!  - a chave fica no Gerenciador de Credenciais do Windows (crate `keyring`), lida só no momento da chamada e nunca
//!    devolvida ao WebView nem escrita em log;
//!  - só modelos do nível GRATUITO são aceitos (mesma lista do `modules/ai`, conferida de novo aqui);
//!  - o corpo é recusado se declarar recurso pago (busca/grounding, cache de contexto, execução de código);
//!  - limites de tamanho de pedido/resposta e tempo máximo.
//!
//! Códigos de status devolvidos ao JS além dos HTTP: 0 = rede, -1 = tempo esgotado, -2 = sem chave,
//! -3 = bloqueado localmente (modelo/recurso não permitido), -4 = pedido grande demais.

use serde::Serialize;
use std::time::Duration;

pub const FREE_MODELS: &[&str] = &["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
pub const ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/models/";
pub const MAX_REQUEST: usize = 2 * 1024 * 1024;
pub const MAX_RESPONSE: u64 = 8 * 1024 * 1024;
pub const TIMEOUT: Duration = Duration::from_secs(90);
/// recursos pagos ou que saem do escopo do CAD — nunca enviados
const FORBIDDEN: &[&str] = &["\"googleSearch\"", "\"google_search\"", "\"googleSearchRetrieval\"", "\"cachedContent\"", "\"codeExecution\"", "\"urlContext\"", "\"googleMaps\"", "\"computerUse\""];

const SERVICE: &str = "AGTN Industrial CAD";
const ACCOUNT: &str = "gemini-api-key";

#[derive(Serialize, Debug, PartialEq)]
pub struct AiResponse {
    pub status: i32,
    pub body: String,
}

fn local(status: i32, msg: &str) -> AiResponse {
    AiResponse { status, body: serde_json::json!({ "error": { "message": msg } }).to_string() }
}

pub trait KeyStore {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, key: &str) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}

/// Gerenciador de Credenciais do Windows (keyring/windows-native).
pub struct CredStore;
impl CredStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("credencial indisponível: {e}"))
    }
}
impl KeyStore for CredStore {
    fn get(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(k) => Ok(Some(k)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("não foi possível ler a credencial: {e}")),
        }
    }
    fn set(&self, key: &str) -> Result<(), String> {
        Self::entry()?.set_password(key).map_err(|e| format!("não foi possível gravar a credencial: {e}"))
    }
    fn clear(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("não foi possível apagar a credencial: {e}")),
        }
    }
}

/// Formato da chave: 20–200 caracteres [A-Za-z0-9_-] (chaves do AI Studio). Não diz se é válida no Google.
pub fn validate_key(key: &str) -> Result<String, String> {
    let k = key.trim();
    if k.len() < 20 || k.len() > 200 {
        return Err("chave com tamanho inesperado".into());
    }
    if !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("a chave só pode ter letras, números, - e _".into());
    }
    Ok(k.to_string())
}

pub fn generate(store: &dyn KeyStore, base: &str, model: &str, body: &str, timeout: Duration) -> AiResponse {
    if !FREE_MODELS.contains(&model) {
        return local(-3, "modelo não permitido: o AGTN só usa modelos do nível gratuito do Gemini");
    }
    if body.len() > MAX_REQUEST {
        return local(-4, "pedido grande demais");
    }
    if let Some(f) = FORBIDDEN.iter().find(|f| body.contains(*f)) {
        return local(-3, &format!("recurso não permitido no pedido ({})", f.trim_matches('"')));
    }
    let key = match store.get() {
        Ok(Some(k)) => k,
        Ok(None) => return local(-2, "chave não configurada"),
        Err(e) => return local(-2, &e),
    };
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(timeout)).http_status_as_error(false).build().into();
    let url = format!("{base}{model}:generateContent");
    match agent.post(&url).header("x-goog-api-key", key.as_str()).header("content-type", "application/json").send(body) {
        Ok(mut resp) => {
            let status = i32::from(resp.status().as_u16());
            match resp.body_mut().with_config().limit(MAX_RESPONSE).read_to_string() {
                Ok(text) => AiResponse { status, body: text },
                Err(ureq::Error::Timeout(_)) => local(-1, "tempo esgotado lendo a resposta"),
                Err(e) => local(0, &format!("falha lendo a resposta: {}", redact(&e.to_string(), &key))),
            }
        }
        Err(ureq::Error::Timeout(_)) => local(-1, "tempo esgotado"),
        Err(e) => local(0, &redact(&e.to_string(), &key)),
    }
}

/// Nunca deixa a chave sair numa mensagem de erro.
fn redact(s: &str, key: &str) -> String {
    if key.is_empty() { s.to_string() } else { s.replace(key, "***") }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    struct Mem(RefCell<Option<String>>);
    impl KeyStore for Mem {
        fn get(&self) -> Result<Option<String>, String> { Ok(self.0.borrow().clone()) }
        fn set(&self, k: &str) -> Result<(), String> { *self.0.borrow_mut() = Some(k.into()); Ok(()) }
        fn clear(&self) -> Result<(), String> { *self.0.borrow_mut() = None; Ok(()) }
    }
    const KEY: &str = "AIzaTESTE_0123456789abcdefXYZ";

    /// servidor HTTP de uma conexão: devolve (status, corpo) e entrega o pedido recebido
    fn serve(status: u16, body: &'static str, delay_ms: u64) -> (String, std::thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/v1beta/models/", l.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = vec![0u8; 65536];
            let mut req = Vec::new();
            loop {
                let n = s.read(&mut buf).unwrap();
                req.extend_from_slice(&buf[..n]);
                let t = String::from_utf8_lossy(&req).to_string();
                if let Some(i) = t.find("\r\n\r\n") {
                    let len = t.lines().find_map(|x| x.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                    if req.len() >= i + 4 + len { break; }
                }
                if n == 0 { break; }
            }
            std::thread::sleep(Duration::from_millis(delay_ms));
            let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            String::from_utf8_lossy(&req).to_string()
        });
        (base, h)
    }

    #[test]
    fn so_modelos_gratuitos() {
        let st = Mem(RefCell::new(Some(KEY.into())));
        for m in ["gemini-4-carbon", "gemini-3.1-pro-preview", "gemini-2.5-pro", "../../etc"] {
            assert_eq!(generate(&st, "http://127.0.0.1:1/", m, "{}", TIMEOUT).status, -3, "{m}");
        }
    }
    #[test]
    fn recusa_recurso_pago_e_pedido_grande() {
        let st = Mem(RefCell::new(Some(KEY.into())));
        let r = generate(&st, "http://127.0.0.1:1/", "gemini-3.8-flash", r#"{"tools":[{"googleSearch":{}}]}"#, TIMEOUT);
        assert_eq!(r.status, -3);
        assert!(r.body.contains("googleSearch"));
        let big = "x".repeat(MAX_REQUEST + 1);
        assert_eq!(generate(&st, "http://127.0.0.1:1/", "gemini-3.8-flash", &big, TIMEOUT).status, -4);
    }
    #[test]
    fn sem_chave() {
        let st = Mem(RefCell::new(None));
        assert_eq!(generate(&st, "http://127.0.0.1:1/", "gemini-3.8-flash", "{}", TIMEOUT).status, -2);
    }
    #[test]
    fn chamada_ok_envia_chave_no_cabecalho_e_devolve_corpo() {
        let (base, h) = serve(200, r#"{"candidates":[]}"#, 0);
        let st = Mem(RefCell::new(Some(KEY.into())));
        let r = generate(&st, &base, "gemini-3.8-flash", r#"{"contents":[]}"#, TIMEOUT);
        let req = h.join().unwrap();
        assert_eq!(r, AiResponse { status: 200, body: r#"{"candidates":[]}"#.into() });
        assert!(req.starts_with("POST /v1beta/models/gemini-3.8-flash:generateContent HTTP/1.1"), "{req}");
        assert!(req.to_ascii_lowercase().contains(&format!("x-goog-api-key: {}", KEY.to_ascii_lowercase())));
        assert!(!req.contains(&format!("key={KEY}")), "chave não vai na URL");
        assert!(req.ends_with(r#"{"contents":[]}"#));
    }
    #[test]
    fn status_429_repassado_com_corpo() {
        let (base, h) = serve(429, r#"{"error":{"code":429}}"#, 0);
        let st = Mem(RefCell::new(Some(KEY.into())));
        let r = generate(&st, &base, "gemini-3.5-flash-lite", "{}", TIMEOUT);
        h.join().unwrap();
        assert_eq!(r.status, 429);
        assert_eq!(r.body, r#"{"error":{"code":429}}"#);
    }
    #[test]
    fn tempo_esgotado_e_rede() {
        let (base, h) = serve(200, "{}", 1500);
        let st = Mem(RefCell::new(Some(KEY.into())));
        assert_eq!(generate(&st, &base, "gemini-3.8-flash", "{}", Duration::from_millis(300)).status, -1);
        let _ = h.join();
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let dead = format!("http://{}/", l.local_addr().unwrap());
        drop(l);
        let r = generate(&st, &dead, "gemini-3.8-flash", "{}", TIMEOUT);
        assert_eq!(r.status, 0);
        assert!(!r.body.contains(KEY));
    }
    #[test]
    fn formato_da_chave() {
        assert!(validate_key(&format!("  {KEY}  ")).is_ok());
        assert!(validate_key("curta").is_err());
        assert!(validate_key("AIza com espaço 0123456789012345").is_err());
        assert!(validate_key("AIza\";DROP TABLE-0123456789012").is_err());
    }
    #[test]
    fn chave_nunca_aparece_em_erro() {
        assert_eq!(redact(&format!("falhou {KEY}!"), KEY), "falhou ***!");
    }
}
