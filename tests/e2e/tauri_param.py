"""FASE 3 no aplicativo Tauri COMPILADO (release instalado): esboço cotado → extrusão → editar cota → regenerar."""
import math, os, sys, time
from selenium.webdriver.common.options import ArgOptions
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

OUT = os.environ.get("E2E_OUT", "tests/output/e2e_param")
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


try:
    time.sleep(2)
    d.execute_script("localStorage.setItem('agtn.e2e','1')")
    d.refresh()
    time.sleep(2)
    d.find_element(By.XPATH, "//button[normalize-space()='Modelo 3D']").click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".st3-dot.ready"))
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="sketch"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, '[data-plane="XY"]'))
    d.find_element(By.CSS_SELECTOR, '[data-plane="XY"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".sk-rb"))
    idle()
    key("r")
    click3d(0, 0, 0)
    click3d(100, 60, 0)
    dim(50, 60, 0, 120)
    dim(120, 30, 0, 80)
    st = d.find_element(By.CSS_SELECTOR, "[data-sketch-status]").get_attribute("data-sketch-status")
    check("app compilado: esboço cotado totalmente definido", st == "full", st)
    d.find_element(By.CSS_SELECTOR, '[data-testid="sketch-finish"]').click()
    time.sleep(1.2)
    d.find_element(By.CSS_SELECTOR, '.rb [data-op="extrude"]').click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".fd"))
    e = d.find_element(By.XPATH, "//div[contains(@class,'fd')]//div[contains(@class,'p3-row')][.//span[@class='k' and text()='Profundidade']]//input")
    e.send_keys(Keys.CONTROL, "a")
    e.send_keys("20", Keys.TAB)
    W.until(lambda x: "Prévia OK" in x.find_element(By.CSS_SELECTOR, '[data-testid="feature-status"]').text)
    d.find_element(By.CSS_SELECTOR, '[data-testid="feature-ok"]').click()
    W.until(lambda x: (vol() or 0) > 0)
    v = vol()
    check("app compilado: extrusão real no OCCT (120×80×20 = 192 000 mm³)", abs(v - 192000) < 0.5, f"{v}")
    # editar a cota pelo histórico
    ActionChains(d).double_click(d.find_element(By.CSS_SELECTOR, '[data-feat="Esboço_1"]')).perform()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".sk-rb"))
    idle()
    lab = [x for x in d.find_elements(By.CSS_SELECTOR, ".sk-dim") if x.text == "120"][0]
    ActionChains(d).double_click(lab).perform()
    W.until(lambda q: q.find_elements(By.CSS_SELECTOR, '[data-testid="dim-input"]'))
    e = d.find_element(By.CSS_SELECTOR, '[data-testid="dim-input"]')
    e.send_keys(Keys.CONTROL, "a")
    e.send_keys("150", Keys.ENTER)
    time.sleep(0.4)
    d.find_element(By.CSS_SELECTOR, '[data-testid="sketch-finish"]').click()
    W.until(lambda x: abs((vol() or 0) - 240000) < 0.5)
    check("app compilado: editar cota 120 → 150 regenera (240 000 mm³)", abs(vol() - 240000) < 0.5, f"{vol()}")
    idle()
    d.save_screenshot(f"{OUT}/20_app_compilado_param.png")
    # alternar 2D ↔ 3D no app compilado preserva o modelo e o volume
    d.find_element(By.XPATH, "//button[normalize-space()='DESENHO']").click()
    time.sleep(1)
    d.find_element(By.XPATH, "//button[normalize-space()='3D']").click()
    W.until(lambda x: x.find_elements(By.CSS_SELECTOR, ".st3-dot.ready"))
    W.until(lambda x: abs((vol() or 0) - 240000) < 0.5)
    check("app compilado: 2D → 3D mantém a peça (240 000 mm³)", abs(vol() - 240000) < 0.5, f"{vol()}")
    ps = __import__("subprocess").run("ps -eo rss,comm | grep -Ei 'agtn-cad|WebKit'", shell=True, capture_output=True, text=True).stdout
    tot = sum(int(l.split()[0]) for l in ps.strip().splitlines() if l.strip())
    check("app compilado: memória após modelagem (app + WebKit, render por software)", tot > 0, f"{tot / 1024:.0f} MB RSS")
finally:
    d.quit()
print(f"{sum(o for _, o, _ in res)}/{len(res)} OK")
sys.exit(0 if all(o for _, o, _ in res) and res else 1)
