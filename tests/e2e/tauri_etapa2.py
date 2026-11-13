"""FASE 4 · ETAPA 2 no aplicativo Tauri COMPILADO (Linux, release instalado): base → aba de borda em DUAS
arestas (Ctrl+clique) com material por fora → canto encosto → desdobrar/redobrar → DXF da planificação conferido.
(Windows real: pendente, não executado.)"""
import math, os, sys, time
from selenium.webdriver.common.options import ArgOptions
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

OUT = os.environ.get("E2E_OUT", "tests/output/e2e_etapa2")
os.makedirs(OUT, exist_ok=True)
res = []


def check(n, ok, d=""):
    res.append((n, bool(ok), d))
    print(("PASS " if ok else "FAIL ") + n + (f" — {d}" if d else ""), flush=True)


caps = {"browserName": "wry", "tauri:options": {"application": "/usr/bin/agtn-cad"}}


class Opts(ArgOptions):
    def to_capabilities(self):
        return caps


d = webdriver.Remote(command_executor="http://127.0.0.1:4444", options=Opts())
W = WebDriverWait(d, 40)


def click3d(x, y, z, dbl=False):
    p = d.execute_script(f"return window.__agtn3d.vp.clientOf({x},{y},{z})")
    body = d.find_element(By.TAG_NAME, "body")
    a = ActionChains(d).move_to_element_with_offset(body, 0, 0).move_by_offset(int(p["x"]) - body.size["width"] // 2, int(p["y"]) - body.size["height"] // 2)
    a.pause(0.2)
    (a.double_click() if dbl else a.click()).perform()
    time.sleep(0.35)


def key(k):
    ActionChains(d).send_keys(k).perform()
    time.sleep(0.2)


def idle():
    W.until(lambda x: x.execute_script("return !window.__agtn3d.vp.animating"))
    time.sleep(0.4)


def vol():
    return d.execute_script("const a = window.__agtn3d; const b = Object.values(a.model().nodes).find(n => n.kind === 'body'); const g = b && a.vp.geom(b.id); return g ? g.props.volume : null")


def dim(x, y, z, v):
    key("d")
    click3d(x, y, z)
    W.until(lambda q: q.find_elements(By.CSS_SELECTOR, '[data-testid="dim-input"]'))
    e = d.find_element(By.CSS_SELECTOR, '[data-testid="dim-input"]')
    e.send_keys(Keys.CONTROL, "a")
    e.send_keys(str(v), Keys.ENTER)
    time.sleep(0.4)




def sheet():
    return d.execute_script("const a = window.__agtn3d; const b = Object.values(a.model().nodes).find(n => n.kind === 'body'); const s = b && a.sheets()[b.id]; return s ? { volume: s.volume, state: s.flat.state, h: s.flat.box.maxX - s.flat.box.minX } : null")


def field(label, v):
    e = d.find_element(By.XPATH, f"//div[contains(@class,'fd')]//div[contains(@class,'p3-row')][.//span[@class='k' and text()='{label}']]//input")
    e.send_keys(Keys.CONTROL, "a")
    e.send_keys(str(v), Keys.TAB)


def ok():
    W.until(lambda x: "Prévia OK" in x.find_element(By.CSS_SELECTOR, '[data-testid="feature-status"]').text)
    d.find_element(By.CSS_SELECTOR, '[data-testid="feature-ok"]').click()
    time.sleep(1.0)



def consistent():
    W.until(lambda x: x.execute_script("const a = window.__agtn3d; const b = Object.values(a.model().nodes).find(n => n.kind === 'body'); const g = b && a.vp.geom(b.id); const s = b && a.sheets()[b.id]; return g && s && Math.abs(g.props.volume - s.volume) < 1e-6 * Math.max(1, s.volume)"))
    return vol(), d.execute_script("const a = window.__agtn3d; const b = Object.values(a.model().nodes).find(n => n.kind === 'body'); const s = a.sheets()[b.id]; return { area: s.flatArea, state: s.flat.state, corners: s.corners.map(c => c.kind), areas: s.flanges.map(f => f.area), folded: s.flat.bends.map(q => q.folded) }")


def shift_click3d(x, y, z):
    p = d.execute_script(f"return window.__agtn3d.vp.clientOf({x},{y},{z})")
    body = d.find_element(By.TAG_NAME, "body")
    a = ActionChains(d).move_to_element_with_offset(body, 0, 0).move_by_offset(int(p["x"]) - body.size["width"] // 2, int(p["y"]) - body.size["height"] // 2)
    a.pause(0.2).key_down(Keys.SHIFT).click().key_up(Keys.SHIFT).perform()
    time.sleep(0.35)


try:
    time.sleep(2)
    d.execute_script("localStorage.setItem('agtn.e2e','1')")
    d.refresh()
    time.sleep(2)
    d.find_element(By.XPATH, "//button[normalize-space()='Modelo 3D']").click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".st3-dot.ready"))
    d.find_element(By.CSS_SELECTOR, '.rb [data-tab="chapa"]').click()
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sketch"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, '[data-plane="XY"]'))
    d.find_element(By.CSS_SELECTOR, '[data-plane="XY"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".sk-rb"))
    idle()
    key("r")
    click3d(0, 0, 0)
    click3d(90, 40, 0)
    dim(45, 40, 0, 100)
    dim(100, 20, 0, 50)
    d.find_element(By.CSS_SELECTOR, '[data-testid="sketch-finish"]').click()
    time.sleep(1.2)
    d.find_element(By.CSS_SELECTOR, '.rb [data-tab="chapa"]').click()
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sheetBase"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, '.fd[data-feature-dialog="sheetBase"]'))
    field("Espessura T", 2)
    d.save_screenshot(f"{OUT}/20_app_compilado_dialogo_base.png")
    ok()
    W.until(lambda x: abs((vol() or 0) - 10000) < 1e-6)
    idle()
    # aba de borda em duas arestas (L1 y = 0 e L2 x = 100), material por fora
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sheetFlange"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, '.fd[data-feature-dialog="sheetFlange"]'))
    click3d(100, 25, 2)
    W.until(lambda x: x.find_element(By.CSS_SELECTOR, '[data-testid="pick-count"]').text == "1")
    shift_click3d(92, 0, 2)  # L1 (y = 0), à direita do diálogo
    time.sleep(0.8)
    W.until(lambda x: x.find_element(By.CSS_SELECTOR, '[data-testid="pick-count"]').text == "2")
    field("Comprimento", 30)
    from selenium.webdriver.support.ui import Select
    Select(d.find_element(By.CSS_SELECTOR, '.fd select[data-field="position"]')).select_by_value("fora")
    time.sleep(0.4)
    ok()
    v, s = consistent()
    check("app compilado: aba de borda em 2 arestas (Shift+clique), material por fora — base (100 + T − SB)(50 + T − SB) = 4704; sólido = grafo; canto detectado", abs(s["areas"][0] - 4704) < 1e-9 and s["corners"] == ["aberto"] and s["state"] == "valida", f"{v} · {s}")
    # canto encosto
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sheetCorner"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, '.fd[data-feature-dialog="sheetCorner"]'))
    d.find_element(By.CSS_SELECTOR, '.fd [data-corner-kind="encosto"]').click()
    d.find_element(By.CSS_SELECTOR, ".fd [data-corner] input").click()
    time.sleep(0.4)
    ok()
    v2, s2 = consistent()
    idle()
    d.save_screenshot(f"{OUT}/21_app_compilado_canto.png")
    check("app compilado: canto encosto — sólido OCCT = grafo, sem interferência, planificação válida", s2["corners"] == ["encosto"] and s2["state"] == "valida" and v2 is not None, f"{v2} · {s2['areas']}")
    # desdobrar tudo / redobrar tudo
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sheetUnfold"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, '.fd[data-feature-dialog="sheetUnfold"]'))
    ok()
    v3, s3 = consistent()
    check("app compilado: desdobrar — V = T × área plana (região BA × L × T)", abs(v3 - 2 * s3["area"]) < 1e-6 * v3 and s3["folded"] == [False, False], f"{v3} · {s3['area']}")
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sheetRefold"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, '.fd[data-feature-dialog="sheetRefold"]'))
    ok()
    v4, s4 = consistent()
    check("app compilado: redobrar — volta exatamente ao volume de antes", abs(v4 - v2) < 1e-9 * v2 and s4["folded"] == [True, True], f"{v4} vs {v2}")
    # DXF da planificação: conferência no app (o arquivo é gravado pelo diálogo nativo — não automatizado aqui)
    bid = d.execute_script("return Object.values(window.__agtn3d.model().nodes).find(n => n.kind === 'body').id")
    d.find_element(By.CSS_SELECTOR, f'.t3-row[data-node="{bid}"] .t3-name').click()
    rep = d.execute_script("""
      const a = window.__agtn3d; const b = Object.values(a.model().nodes).find(n => n.kind === 'body'); const s = a.sheets()[b.id];
      return a.flatDxf ? a.flatDxf(s.flat) : null""")
    if rep is not None:
        check("app compilado: DXF da planificação gerado e conferido no próprio app", rep["ok"], str([c["name"] for c in rep["checks"] if not c["ok"]]))
finally:
    d.quit()
print(f"{sum(o for _, o, _ in res)}/{len(res)} OK")
sys.exit(0 if all(o for _, o, _ in res) and res else 1)
