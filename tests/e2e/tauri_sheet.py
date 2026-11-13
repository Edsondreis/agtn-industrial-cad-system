"""FASE 4 · ETAPA 1 no aplicativo Tauri COMPILADO (Linux, release instalado): esboço cotado → base de chapa →
aba lateral clicando a aresta → volume = grafo → Planificado. (Windows real: pendente, não executado.)"""
import math, os, sys, time
from selenium.webdriver.common.options import ArgOptions
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

OUT = os.environ.get("E2E_OUT", "tests/output/e2e_sheet")
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
    ok()
    W.until(lambda x: abs((vol() or 0) - 10000) < 1e-6)
    check("app compilado: base de chapa 100 × 50 × 2 no OCCT", abs(vol() - 10000) < 1e-6, f"{vol()}")
    idle()
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sheetFlange"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, '.fd[data-feature-dialog="sheetFlange"]'))
    click3d(100, 25, 2)  # aresta L2 (x = 100), fora do painel
    time.sleep(1)
    d.save_screenshot(f"{OUT}/19_app_compilado_aresta.png")
    W.until(lambda x: x.find_element(By.CSS_SELECTOR, '[data-testid="pick-count"]').text == "1")
    field("Comprimento", 30)
    ok()
    V1 = 96 * 50 * 2 + (math.pi / 2) * 2 * 3 * 50 + 26 * 50 * 2
    W.until(lambda x: abs((vol() or 0) - V1) < 1e-6)
    s = sheet()
    check("app compilado: aba lateral clicando a aresta — volume = grafo (1e-6)", abs(vol() - V1) < 1e-6 and abs(s["volume"] - vol()) < 1e-6, f"{vol():.6f}")
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sheetFlat"]').click()
    W.until(lambda x: x.execute_script("return window.__agtn3d.vp.flatBody !== null"))
    idle()
    d.save_screenshot(f"{OUT}/20_app_compilado_planificado.png")
    check("app compilado: Planificado (válida, 100 + 30 − BD)", s["state"] == "valida" and abs(s["h"] - 126.492477) < 1e-5, f"{s['h']:.6f}")
finally:
    d.quit()
print(f"{sum(o for _, o, _ in res)}/{len(res)} OK")
sys.exit(0 if all(o for _, o, _ in res) and res else 1)
