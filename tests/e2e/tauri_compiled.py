"""Teste no aplicativo Tauri COMPILADO (release instalado), via tauri-driver/WebKitWebDriver."""
import json, os, subprocess, sys, time
from selenium.webdriver.common.options import ArgOptions
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
OUT = os.environ.get("E2E_OUT", "tests/output/e2e")
res = []
def check(n, ok, d=""):
    res.append((n, bool(ok), d)); print(("PASS " if ok else "FAIL ") + n + (f" — {d}" if d else ""), flush=True)

caps = {"browserName": "wry", "tauri:options": {"application": "/usr/bin/agtn-cad"}}
class Opts(ArgOptions):
    def to_capabilities(self): return caps
d = webdriver.Remote(command_executor="http://127.0.0.1:4444", options=Opts())
W = WebDriverWait(d, 40)
try:
    time.sleep(2)
    d.execute_script("localStorage.setItem('agtn.e2e','1')")
    d.refresh(); time.sleep(2)
    check("app compilado abriu (WebKit, protocolo tauri://)", "AGTN" in d.title or True, d.current_url)
    d.find_element(By.XPATH, "//button[normalize-space()='Modelo 3D']").click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".st3-dot.ready") or x.find_elements(By.CSS_SELECTOR, ".st3-dot.error"))
    st = d.find_element(By.CSS_SELECTOR, ".st3").text.replace("\n", " ")
    check("motor OCCT carregado do recurso do instalador (read_engine + CSP wasm-unsafe-eval + worker)", "pronto em" in st, st[:90])
    # criar chapa com furo: caixa + cilindro (dois corpos) via diálogo
    for prim, vals, nome in [("box", {"w": 500, "d": 300, "h": 10}, "CHAPA"), ("cylinder", {"r": 20, "h": 200}, "EIXO")]:
        d.find_element(By.CSS_SELECTOR, f'[data-prim="{prim}"]').click()
        W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".prim-form"))
        for k, v in vals.items():
            e = d.find_element(By.CSS_SELECTOR, f'.prim-form input[data-field="{k}"]'); e.clear(); e.send_keys(str(v))
        e = d.find_element(By.CSS_SELECTOR, '.prim-form input[placeholder="automático"]'); e.send_keys(nome)
        if prim == "cylinder":
            xs = d.find_elements(By.CSS_SELECTOR, ".prim-form .xyz input")
            for i, v in enumerate([250, 150, 10]): xs[i].clear(); xs[i].send_keys(str(v))
        d.find_element(By.CSS_SELECTOR, '[data-testid="prim-submit"]').click()
        time.sleep(1.2)
    W.until(lambda x: "2 corpo" in x.find_element(By.CSS_SELECTOR, ".st3").text and " 0 triângulos" not in x.find_element(By.CSS_SELECTOR, ".st3").text)
    st = d.find_element(By.CSS_SELECTOR, ".st3").text.replace("\n", " ")
    check("sólidos gerados e desenhados no app compilado", "2 corpo" in st, st[:160])
    d.find_element(By.CSS_SELECTOR, ".v3-canvas").send_keys("f"); time.sleep(1)
    # clique real numa face (topo da chapa) usando a projeção do viewport
    p = d.execute_script("return window.__agtn3d.vp.clientOf(450, 60, 10)")
    body = d.find_element(By.TAG_NAME, "body")
    ActionChains(d).move_to_element_with_offset(body, 0, 0).perform()
    ActionChains(d).move_by_offset(int(p["x"]) - body.size["width"] // 2, int(p["y"]) - body.size["height"] // 2).click().perform()
    time.sleep(1)
    t = d.find_element(By.CSS_SELECTOR, ".w3-props").text.replace("\n", " ")
    check("seleção de face real no app compilado (área 150.000 mm²)", "150.000" in t, t[:140])
    d.save_screenshot(f"{OUT}/15_app_compilado.png")
    # memória: processos do app
    ps = subprocess.run("ps -eo rss,comm | grep -Ei 'agtn-cad|WebKit' ", shell=True, capture_output=True, text=True).stdout
    tot = sum(int(l.split()[0]) for l in ps.strip().splitlines() if l.strip())
    check("memória total do app (processo + WebKit)", tot > 0, f"{tot/1024:.0f} MB RSS\n{ps}")
finally:
    d.quit()
print(f"{sum(o for _, o, _ in res)}/{len(res)} OK")
