"""FASE 5 — valida no Chromium, com o build de PRODUÇÃO e a CSP EXATA do tauri.conf.json, o mesmo script que roda
dentro do app instalado no Windows (scripts/windows/smoke/step_smoke.js). Evidência auxiliar: Chromium não é WebView2.

  npm run build && npx vitest run core/model3d/src/stepdoc.test.ts   (gera dist e os STEP grandes)
  python3 tests/e2e/step_smoke_chromium.py
"""
import asyncio, json, os, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, "apps", "desktop", "dist")
WASM = os.path.join(ROOT, "node_modules", "occt-wasm", "dist", "occt-wasm.wasm")
SMOKE = os.path.join(ROOT, "scripts", "windows", "smoke")
OUT = os.environ.get("E2E_OUT", os.path.join(ROOT, "tests", "output", "step_smoke_chromium"))
os.makedirs(OUT, exist_ok=True)
CSP = json.load(open(os.path.join(ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json"), encoding="utf-8"))["app"]["security"]["csp"]
JS = open(os.path.join(SMOKE, "step_smoke.js"), encoding="utf-8").read()
REF = json.load(open(os.path.join(SMOKE, "referencias_step.json"), encoding="utf-8"))
SRC = {f: os.path.join(ROOT, "tests", "step", "viewer_ref", f) for f in os.listdir(os.path.join(ROOT, "tests", "step", "viewer_ref"))}
for f in ("grande_120_caixas.step", "grande_400_placas.step"):
    SRC[f] = os.path.join(ROOT, "tests", "output", "step", f)
open(os.path.join(OUT, "nao_step.step"), "w").write("isto não é STEP\n")
open(os.path.join(OUT, "vazio.stp"), "w").write("")
SRC["nao_step.step"] = os.path.join(OUT, "nao_step.step")
SRC["vazio.stp"] = os.path.join(OUT, "vazio.stp")
FILES = sys.argv[1:] or ["box_100x50x20.step", "inch_block_2x1x0.5.step", "tank_assembly.step", "cone_sphere_torus.step", "vessel_revolved.step", "fusion_srr_assembly.step", "grande_400_placas.step", "nao_step.step", "vazio.stp"]
PORT = int(os.environ.get("CSP_PORT", "1478"))


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIST, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        p0 = self.path.split("?")[0]
        if p0 == "/" or p0.endswith(".html"):
            self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/__engine/occt-wasm.wasm"):
            b = open(WASM, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/wasm")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        if self.path.split("?")[0] != "/" and not os.path.exists(os.path.join(DIST, self.path.split("?")[0].lstrip("/"))):
            self.path = "/index.html"
        return super().do_GET()


SimpleHTTPRequestHandler.extensions_map[".js"] = "text/javascript"
SimpleHTTPRequestHandler.extensions_map[".wasm"] = "application/wasm"
srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{PORT}/"


async def main():
    todos = []
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for f in FILES:
            ctx = await b.new_context(viewport={"width": 1600, "height": 900})
            await ctx.add_init_script("window.__agtnCsp=[];document.addEventListener('securitypolicyviolation',e=>window.__agtnCsp.push(e.violatedDirective));try{localStorage.setItem('agtn.e2e','1')}catch(e){}")
            pg = await ctx.new_page()
            await pg.goto(URL)
            await pg.wait_for_timeout(1200)
            async with pg.expect_file_chooser() as fc:
                await pg.keyboard.press("Control+o")
            await (await fc.value).set_files(SRC[f])
            await pg.evaluate(JS)
            r = await pg.evaluate("c => window.__agtnStepSmoke(c)", {"arquivo": f, "ref": REF.get(f, {}), "timeoutMs": 300000})
            testes = r["testes"]
            if not REF.get(f, {}).get("falha"):
                c = await pg.evaluate("() => window.__agtnStepClose()")
                testes += c["testes"]
            csp = await pg.evaluate("() => window.__agtnCsp")
            testes.append({"id": "P13", "nome": "CSP de produção sem violação", "ok": not csp, "detalhe": str(csp)})
            for t in testes:
                print(("PASS " if t["ok"] else "FAIL ") + f"{f} {t['id']} {t['nome']} — {t['detalhe'][:140]}", flush=True)
            todos.append({"arquivo": f, "testes": testes, "medidas": r.get("medidas")})
            await ctx.close()
        await b.close()
    n = sum(len(x["testes"]) for x in todos)
    ok = sum(1 for x in todos for t in x["testes"] if t["ok"])
    json.dump({"aprovadas": ok, "total": n, "execucoes": todos}, open(os.path.join(OUT, "resultado.json"), "w"), indent=1, ensure_ascii=False)
    print(f"\n{ok}/{n} verificações")
    sys.exit(0 if ok == n else 1)


asyncio.run(main())
