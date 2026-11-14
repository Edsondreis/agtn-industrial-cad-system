"""FASE 4 · ETAPA 5 — falhas forçadas do motor 3D, diagnóstico (F-06), recuperação e inicialização repetida.

Build de PRODUÇÃO (apps/desktop/dist) servido com a CSP do tauri.conf.json aplicada a TODAS as respostas (inclusive
o script do worker = o cenário mais rigoroso). Chromium — não é WebView2.

Casos:
  ok           motor inicia com a CSP estrita (F-05 resolvido no build)
  wasm404      .wasm ausente → WASM_LOAD; 2D continua; "Tentar novamente" com o .wasm de volta → pronto (recuperação)
  wasmcorrupt  .wasm trocado por lixo → WASM_COMPILE
  worker404    script do worker ausente → WORKER_START
  semwasmcsp   CSP sem 'wasm-unsafe-eval' → CSP
  repetido     sair/voltar do 3D com liberação do motor: 6 inicializações seguidas, todas prontas

  npm run build && python3 tests/e2e/engine_fail.py
"""
import asyncio, json, os, re, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, "apps", "desktop", "dist")
WASM = os.path.join(ROOT, "node_modules", "occt-wasm", "dist", "occt-wasm.wasm")
OUT = os.environ.get("E2E_OUT", os.path.join(ROOT, "tests", "output", "engine_fail"))
os.makedirs(OUT, exist_ok=True)
CSP = json.load(open(os.path.join(ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json"), encoding="utf-8"))["app"]["security"]["csp"]
PORT = int(os.environ.get("FAIL_PORT", "1495"))
STATE = {"modo": "ok", "wasm_hits": 0}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIST, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        csp = CSP.replace(" 'wasm-unsafe-eval'", "") if STATE["modo"] == "semwasmcsp" else CSP
        self.send_header("Content-Security-Policy", csp)  # em TODAS as respostas (estrito)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        p0 = self.path.split("?")[0]
        m = STATE["modo"]
        if p0 == "/__engine/occt-wasm.wasm":
            STATE["wasm_hits"] += 1
            if m == "wasm404":
                self.send_response(404)
                self.end_headers()
                return
            b = b"<!doctype html>nao e wasm" * 100 if m == "wasmcorrupt" else open(WASM, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/wasm")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        if m == "worker404" and re.search(r"/assets/engine\.worker-[^/]+\.js$", p0):
            self.send_response(404)
            self.end_headers()
            return
        if p0 != "/" and not os.path.exists(os.path.join(DIST, p0.lstrip("/"))):
            self.path = "/index.html"
        return super().do_GET()


SimpleHTTPRequestHandler.extensions_map[".js"] = "text/javascript"
srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"
results = []


def check(name, ok, detail=""):
    results.append({"nome": name, "ok": bool(ok), "detalhe": str(detail)[:400]})
    print(("PASS " if ok else "FAIL ") + name + (f" — {str(detail)[:200]}" if detail else ""), flush=True)


async def enter3d(pg):
    await pg.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '3D').click()")
    await pg.wait_for_function("() => { const d = document.querySelector('.st3-dot'); return d && (d.classList.contains('ready') || d.classList.contains('error')) }", timeout=90000)
    return await pg.evaluate("""() => ({ ready: document.querySelector('.st3-dot').classList.contains('ready'),
        code: document.querySelector('.v3-center.err')?.dataset.diagCode ?? null,
        tela: document.querySelector('.v3-center.err')?.innerText ?? null,
        status: document.querySelector('.st3-dot').parentElement.textContent,
        diag: window.__agtnEngineDiag ?? null })""")


async def page(b):
    ctx = await b.new_context(viewport={"width": 1500, "height": 900}, permissions=["clipboard-read", "clipboard-write"])
    pg = await ctx.new_page()
    msgs = []
    pg.on("console", lambda m: msgs.append(m.text))
    await pg.goto(URL)
    await pg.wait_for_function("() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === '3D')", timeout=30000)
    return ctx, pg, msgs


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        # ok — CSP estrita em tudo
        STATE["modo"] = "ok"
        ctx, pg, msgs = await page(b)
        r = await enter3d(pg)
        check("ok: motor pronto com a CSP aplicada também ao worker", r["ready"], r["status"])
        check("ok: console sem violação de CSP", not [m for m in msgs if "Content Security Policy" in m or "Refused to" in m], len(msgs))
        await ctx.close()

        for modo, code in [("wasm404", "WASM_LOAD"), ("wasmcorrupt", "WASM_COMPILE"), ("worker404", "WORKER_START"), ("semwasmcsp", "CSP")]:
            STATE["modo"] = modo
            ctx, pg, msgs = await page(b)
            r = await enter3d(pg)
            check(f"{modo}: falha detectada (não fica 'pronto')", not r["ready"], r["status"])
            check(f"{modo}: código {code}", r["code"] == code, f"{r['code']} · {(r['tela'] or '').splitlines()[:2]}")
            tela = r["tela"] or ""
            check(f"{modo}: tela diz que o 2D continua", "O desenho 2D permanece disponível." in tela, tela[:120])
            check(f"{modo}: erro técnico original preservado no diagnóstico", bool(r["diag"]) and len(r["diag"]["tecnico"]) > 0, (r["diag"] or {}).get("tecnico"))
            check(f"{modo}: o erro foi registrado no console (não silencioso)", any("[AGTN] motor 3D" in m for m in msgs), len(msgs))
            await pg.evaluate("document.querySelector('[data-act=engine-details]').click()")
            await pg.wait_for_timeout(100)
            det = await pg.evaluate("document.querySelector('.v3-diag')?.innerText ?? ''")
            check(f"{modo}: 'Detalhes técnicos' mostra código e etapa", f"código: {code}" in det, det[:160])
            # o 2D continua: voltar ao DESENHO e o canvas existe e responde
            await pg.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'DESENHO').click()")
            await pg.wait_for_timeout(300)
            ok2d = await pg.evaluate("!!document.querySelector('canvas') && !document.querySelector('.v3-center.err')")
            check(f"{modo}: 2D utilizável depois da falha", ok2d)
            if modo == "wasm404":
                # recuperação: o .wasm volta → "Tentar novamente" inicia sem recarregar a página
                await pg.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '3D').click()")
                await pg.wait_for_selector("[data-act=engine-retry]", timeout=20000)
                STATE["modo"] = "ok"
                await pg.evaluate("document.querySelector('[data-act=engine-retry]').click()")
                await pg.wait_for_function("() => document.querySelector('.st3-dot')?.classList.contains('ready')", timeout=90000)
                st = await pg.evaluate("document.querySelector('.st3-dot').parentElement.textContent")
                check("wasm404: 'Tentar novamente' recupera sem reiniciar o app", "pronto em" in st, st[:100])
            await ctx.close()

        # inicialização repetida: o motor é liberado ao sair do 3D (agtn.engineIdleMs) e reinicia ao voltar
        STATE["modo"] = "ok"
        ctx, pg, msgs = await page(b)
        await pg.evaluate("localStorage.setItem('agtn.engineIdleMs', '50')")
        times, mems = [], []
        for i in range(6):
            r = await enter3d(pg)
            m = re.search(r"pronto em ([\d.]+) ms", r["status"])
            times.append(float(m.group(1)) if m and r["ready"] else None)
            mems.append(await pg.evaluate("performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null"))
            await pg.evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'DESENHO').click()")
            await pg.wait_for_timeout(400)  # > engineIdleMs: o worker é encerrado
        check("repetido: 6 inicializações seguidas, todas prontas", all(t is not None for t in times), times)
        check("repetido: heap JS da página não cresce (±25 %)", mems[0] is None or max(mems) <= 1.25 * mems[0] + 5, mems)
        await ctx.close()
        await b.close()
    json.dump({"casos": results, "inicializacoes_ms": times, "heap_mb": mems}, open(os.path.join(OUT, "resultado.json"), "w"), ensure_ascii=False, indent=1)
    ok = sum(r["ok"] for r in results)
    print(f"{ok}/{len(results)} verificações OK")
    return ok == len(results)


sys.exit(0 if asyncio.run(main()) else 1)
