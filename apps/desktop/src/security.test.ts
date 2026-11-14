import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findDynamicCode } from "../../../core/solid/src/occt-csp-patch";
import { fileURLToPath } from "node:url";

/**
 * FASE 4 · ETAPA 5 — bateria de segurança (estática). O que roda no navegador/WebView está em
 * tests/e2e/csp_chromium_smoke.py (modo estrito) e scripts/windows/smoke (WebView2).
 *  1. CSP ativa e mínima;  5. permissões Tauri sem excesso;  6. sem origem externa;  4. build sem geração de código.
 */
// fileURLToPath: no Windows, URL.pathname vira "/D:/..." e o caminho quebra (achado na ETAPA 6)
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const conf = JSON.parse(readFileSync(join(ROOT, "apps/desktop/src-tauri/tauri.conf.json"), "utf8"));
const csp: string = conf.app.security.csp;
const dir = Object.fromEntries(
  csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([k, ...v]) => [k, v]),
) as Record<string, string[]>;

describe("CSP de produção (tauri.conf.json)", () => {
  it("está ativa (não é nula nem desligada)", () => {
    expect(typeof csp).toBe("string");
    expect(csp.length).toBeGreaterThan(20);
    expect(conf.app.security.dangerousDisableAssetCspModification).toBeUndefined();
  });
  it("script-src: só 'self' + 'wasm-unsafe-eval' (WebAssembly) — sem 'unsafe-eval', sem 'unsafe-inline', sem origem externa", () => {
    expect(dir["script-src"]).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });
  it("worker-src só 'self' (sem blob:, que nada usa)", () => expect(dir["worker-src"]).toEqual(["'self'"]));
  it("default-src 'self'; object-src 'none'; base-uri 'self'", () => {
    expect(dir["default-src"]).toEqual(["'self'"]);
    expect(dir["object-src"]).toEqual(["'none'"]);
    expect(dir["base-uri"]).toEqual(["'self'"]);
  });
  it("connect-src: só o próprio app e o IPC do Tauri (ipc: no Linux/macOS, http://ipc.localhost no Windows)", () => {
    expect(dir["connect-src"]).toEqual(["'self'", "ipc:", "http://ipc.localhost"]);
  });
  it("nenhuma diretiva com '*', 'unsafe-eval', 'unsafe-hashes', http(s) externo ou data: em script", () => {
    for (const [k, v] of Object.entries(dir)) {
      expect(v, k).not.toContain("*");
      expect(v, k).not.toContain("'unsafe-eval'");
      expect(v, k).not.toContain("'unsafe-hashes'");
      for (const s of v) if (/^https?:/.test(s)) expect(s, k).toBe("http://ipc.localhost");
    }
    expect(dir["script-src"]).not.toContain("data:");
  });
  it("style-src 'unsafe-inline' é a única exceção de inline (estilos do React/three; não executa código)", () => {
    expect(dir["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  });
  it("index.html sem atributo style=\"\" (F-10: o Tauri põe nonce no style-src e o WebView2 passa a ignorar 'unsafe-inline')", () => {
    const html = readFileSync(join(ROOT, "apps/desktop/index.html"), "utf8");
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });
});

describe("permissões do Tauri (capabilities/default.json)", () => {
  const cap = JSON.parse(readFileSync(join(ROOT, "apps/desktop/src-tauri/capabilities/default.json"), "utf8"));
  it("lista fechada — qualquer permissão nova precisa de revisão", () => {
    expect(cap.windows).toEqual(["main"]);
    expect([...cap.permissions].sort()).toEqual(["core:default", "core:window:allow-destroy", "core:window:allow-set-title", "dialog:allow-ask", "dialog:allow-message", "dialog:allow-open", "dialog:allow-save"]);
  });
  it("sem shell, fs genérico, http ou execução de processos pelo JavaScript", () => {
    for (const p of cap.permissions as string[]) expect(p).not.toMatch(/^(shell|fs|http|process|opener):/);
  });
});

const DIST = join(ROOT, "apps/desktop/dist");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
describe.runIf(existsSync(join(DIST, "index.html")))("build de produção (apps/desktop/dist, se existir)", () => {
  const files = existsSync(DIST) ? walk(DIST).filter((f) => /\.(js|html)$/.test(f)) : [];
  it("nenhum arquivo gera código a partir de texto (Function/eval/setTimeout com string)", () => {
    const bad = files.map((f) => [f.slice(DIST.length), findDynamicCode(readFileSync(f, "utf8"))] as const).filter(([, v]) => v.length);
    expect(bad).toEqual([]);
  });
  it("o glue do OCCT no build é o corrigido (F-05)", () => {
    const glue = files.filter((f) => /occt-wasm-.*\.js$/.test(f));
    expect(glue.length).toBeGreaterThan(0);
    // comentários somem na minificação; a mensagem de erro do chamador corrigido (string) permanece
    for (const f of glue) expect(readFileSync(f, "utf8"), f).toContain("emval: invocador sem argumentos");
  });
  it("nenhuma origem externa além de namespaces/textos (w3.org, react.dev)", () => {
    const hosts = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) hosts.add(m[1]);
    expect([...hosts].filter((h) => !["www.w3.org", "react.dev"].includes(h))).toEqual([]);
  });
});
