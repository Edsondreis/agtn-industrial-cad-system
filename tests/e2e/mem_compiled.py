import subprocess, time
from selenium import webdriver
from selenium.webdriver.common.options import ArgOptions
from selenium.webdriver.common.by import By
caps = {"browserName": "wry", "tauri:options": {"application": "/usr/bin/agtn-cad"}}
class Opts(ArgOptions):
    def to_capabilities(self): return caps
def rss():
    out = subprocess.run("ps -eo rss,comm | grep -Ei 'agtn-cad|WebKitWebProces|WebKitNetwork'", shell=True, capture_output=True, text=True).stdout
    return round(sum(int(l.split()[0]) for l in out.strip().splitlines()) / 1024)
d = webdriver.Remote(command_executor="http://127.0.0.1:4444", options=Opts())
try:
    time.sleep(2); d.execute_script("localStorage.setItem('agtn.engineIdleMs','5000')"); d.refresh(); time.sleep(3); a = rss()
    d.find_element(By.XPATH, "//button[normalize-space()='Desenho 2D']").click(); time.sleep(3); b = rss()
    d.find_element(By.XPATH, "//button[normalize-space()='3D']").click(); time.sleep(6); c = rss()
    d.find_element(By.XPATH, "//button[normalize-space()='DESENHO']").click(); time.sleep(10); e = rss()
    d.find_element(By.XPATH, "//button[normalize-space()='3D']").click(); t0 = time.time()
    while not d.find_elements(By.CSS_SELECTOR, ".st3-dot.ready"): time.sleep(0.1)
    print({"start_center_MB": a, "desenho_2d_MB": b, "com_3d_aberto_MB": c, "2d_apos_liberar_motor_MB": e, "reabrir_3d_s": round(time.time() - t0, 2)})
finally:
    d.quit()
