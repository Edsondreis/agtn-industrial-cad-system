"""FASE 4 · ETAPA 4 — build de PRODUÇÃO (apps/desktop/dist) servido com a CSP EXATA do tauri.conf.json, no Chromium
(mesma família de motor do WebView2), rodando o mesmo teste de fumaça do Windows (scripts/windows/smoke/agtn_smoke.js).

Evidência auxiliar: Chromium NÃO é o WebView2. Mostra que a CSP de produção não bloqueia worker, WebAssembly e OCCT
num motor Chromium, e grava todas as mensagens de console (inclusive as de worker) para procurar violações.

  npm run build          (gera apps/desktop/dist)
  python3 tests/e2e/csp_chromium_smoke.py
"""
import asyncio, json, os, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, "apps", "desktop", "dist")
WASM = os.path.join(ROOT, "node_modules", "occt-wasm", "dist", "occt-wasm.wasm")
SMOKE = os.path.join(ROOT, "scripts", "windows", "smoke")
FIX = os.path.join(ROOT, "modules", "sheet3d", "src", "fixtures")
OUT = os.environ.get("E2E_OUT", os.path.join(ROOT, "tests", "output", "csp_chromium"))
os.makedirs(OUT, exist_ok=True)
CSP = json.load(open(os.path.join(ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json"), encoding="utf-8"))["app"]["security"]["csp"]
JS = open(os.path.join(SMOKE, "agtn_smoke.js"), encoding="utf-8").read()
REF = json.load(open(os.path.join(SMOKE, "referencias.json"), encoding="utf-8"))
FILES = ["etapa2_completo.agtncad", "fase3_peca_parametrica.agtncad", "fase2_projeto_3d.agtncad", "etapa1_chapa.agtncad", "grande_120furos.agtncad"]
PORT = int(os.environ.get("CSP_PORT", "1477"))
MODO = os.environ.get("MODO", "tauri")
OUT = os.path.join(OUT, MODO)
os.makedirs(OUT, exist_ok=True)


class H(SimpleHTTPRequestHandler):
    _html = False

    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIST, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        # MODO=tauri (padrão): igual ao Tauri 2.12.5 — CSP só nas respostas .html (tauri/src/manager/mod.rs, is_html)
        # MODO=estrito: CSP em TODAS as respostas (inclusive o script do worker) — mostra a dependência do motor
        if MODO == "estrito" or self._html:
            self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        p0 = self.path.split("?")[0]
        self._html = p0 == "/" or p0.endswith(".html") or not os.path.exists(os.path.join(DIST, p0.lstrip("/")))
        if self.path.startswith("/__engine/occt-wasm.wasm"):
            b = open(WASM, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/wasm")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        if self.path.split("?")[0] not in ("/",) and not os.path.exists(os.path.join(DIST, self.path.split("?")[0].lstrip("/"))):
            self.path = "/index.html"
        return super().do_GET()


SimpleHTTPRequestHandler.extensions_map[".js"] = "text/javascript"
SimpleHTTPRequestHandler.extensions_map[".wasm"] = "application/wasm"
srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"

CSP_LISTENER = """window.__agtnCsp = [];
document.addEventListener('securitypolicyviolation', e => window.__agtnCsp.push({d: e.violatedDirective, u: e.blockedURI, s: e.sourceFile}));"""


async def main():
    todos, consoles = [], []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for f in FILES:
            ctx = await b.new_context(viewport={"width": 1600, "height": 900})
            pg = await ctx.new_page()
            await pg.add_init_script(CSP_LISTENER)
            msgs = []
            pg.on("console", lambda m, msgs=msgs: msgs.append({"tipo": m.type, "texto": m.text[:300]}))
            pg.on("pageerror", lambda e, msgs=msgs: msgs.append({"tipo": "pageerror", "texto": str(e)[:300]}))
            pg.on("worker", lambda w, msgs=msgs: msgs.append({"tipo": "worker", "texto": w.url}))
            hdr = {}
            pg.on("response", lambda r, hdr=hdr: hdr.setdefault("csp", r.headers.get("content-security-policy")) if r.url == URL else None)
            await pg.goto(URL)
            await pg.wait_for_timeout(1500)
            async with pg.expect_file_chooser(timeout=10000) as fc:
                await pg.keyboard.press("Control+o")
            await (await fc.value).set_files(os.path.join(FIX, f))
            await pg.evaluate(JS)
            r = await pg.evaluate("(cfg) => window.__agtnSmoke(cfg)", {"arquivo": f, "ref": REF[f], "esperarTitulo": True})
            sec = [m for m in msgs if "Content Security Policy" in m["texto"] or "Refused to" in m["texto"]]
            r["testes"].append({"id": "S9b", "nome": "console sem mensagem de CSP (página e worker)", "ok": not sec, "detalhe": json.dumps(sec[:3], ensure_ascii=False) if sec else f"{len(msgs)} mensagens, 0 de CSP; workers: {[m['texto'].rsplit('/', 1)[-1] for m in msgs if m['tipo'] == 'worker']}", "ms": None})
            r["testes"].append({"id": "S0", "nome": "CSP de produção aplicada no documento", "ok": hdr.get("csp") == CSP, "detalhe": hdr.get("csp") or "sem cabeçalho", "ms": None})
            todos.append(r)
            consoles.append({"arquivo": f, "console": msgs})
            for t in r["testes"]:
                print(("PASS " if t["ok"] else "FAIL ") + f"[{f}] {t['id']} {t['nome']} — {t['detalhe'][:150]}", flush=True)
            await ctx.close()
        await b.close()
    json.dump(todos, open(os.path.join(OUT, "resultado.json"), "w"), ensure_ascii=False, indent=1)
    json.dump(consoles, open(os.path.join(OUT, "console.json"), "w"), ensure_ascii=False, indent=1)
    ts = [t for r in todos for t in r["testes"]]
    ok = sum(t["ok"] for t in ts)
    print(f"{ok}/{len(ts)} verificações OK")
    return ts and ok == len(ts)


sys.exit(0 if asyncio.run(main()) else 1)
