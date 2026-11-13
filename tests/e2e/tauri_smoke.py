"""FASE 4 · ETAPA 4 — o MESMO teste de fumaça do WebView2 (scripts/windows/smoke/agtn_smoke.js) rodando no app
Tauri COMPILADO e INSTALADO no Linux (WebKitGTK, CSP real do tauri.conf.json, IPC real do Rust).

Serve para provar que o instrumento funciona antes de ir ao Windows. NÃO substitui o teste no WebView2.

  xvfb-run -a tauri-driver &      (porta 4444)
  python3 tests/e2e/tauri_smoke.py
"""
import json, os, sys, time
from selenium import webdriver
from selenium.webdriver.common.options import ArgOptions

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SMOKE = os.path.join(ROOT, "scripts", "windows", "smoke")
FIX = os.path.join(ROOT, "modules", "sheet3d", "src", "fixtures")
OUT = os.environ.get("E2E_OUT", os.path.join(ROOT, "tests", "output", "tauri_smoke"))
PASTA = os.path.join(OUT, "Projetos AGTN", "Peça ção #1 (rev.2)")
os.makedirs(PASTA, exist_ok=True)
APP = os.environ.get("AGTN_APP", "/usr/bin/agtn-cad")
JS = open(os.path.join(SMOKE, "agtn_smoke.js"), encoding="utf-8").read()
REF = json.load(open(os.path.join(SMOKE, "referencias.json"), encoding="utf-8"))
FILES = ["etapa2_completo.agtncad", "fase3_peca_parametrica.agtncad", "fase2_projeto_3d.agtncad", "etapa1_chapa.agtncad", "grande_120furos.agtncad"]
CSP_LISTENER = """window.__agtnCsp = window.__agtnCsp || [];
document.addEventListener('securitypolicyviolation', e => window.__agtnCsp.push({d: e.violatedDirective, u: e.blockedURI, s: e.sourceFile}));"""

CASES = [(f, os.path.join(FIX, f), {"ref": REF[f]}) for f in FILES]
CASES.append(("v311_desenho.agtncad", os.path.join(ROOT, "tests", "regressao2d", "v311_desenho.agtncad"), {"objetos2D": 114, "somente2D": True}))
todos = []
for f, src, extra in CASES:
    # arquivo copiado para um caminho com espaço e acento: a abertura pela linha de comando também é testada
    dst = os.path.join(PASTA, f)
    open(dst, "wb").write(open(src, "rb").read())
    caps = {"browserName": "wry", "tauri:options": {"application": APP, "args": [dst]}}

    class Opts(ArgOptions):
        def to_capabilities(self):
            return caps

    t0 = time.time()
    d = webdriver.Remote(command_executor="http://127.0.0.1:4444", options=Opts())
    try:
        d.set_script_timeout(240)
        d.execute_script(CSP_LISTENER)
        d.execute_script(JS)
        r = d.execute_async_script("const done = arguments[arguments.length - 1]; window.__agtnSmoke(arguments[0]).then(done, e => done({erro: String(e)}));",
                                   {"arquivo": f, "pastaSaida": PASTA, "esperarTitulo": True, **extra})
        r["sessao_s"] = round(time.time() - t0, 1)
        todos.append(r)
        for t in r.get("testes", []):
            print(("PASS " if t["ok"] else "FAIL ") + f"[{f}] {t['id']} {t['nome']} — {t['detalhe'][:160]}", flush=True)
    finally:
        d.quit()
        time.sleep(1)

json.dump(todos, open(os.path.join(OUT, "resultado.json"), "w"), ensure_ascii=False, indent=1)
ts = [t for r in todos for t in r.get("testes", [])]
ok = sum(t["ok"] for t in ts)
print(f"{ok}/{len(ts)} verificações OK")
sys.exit(0 if ts and ok == len(ts) else 1)
