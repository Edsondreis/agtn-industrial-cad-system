"""Teste de ponta a ponta do AGTN 3D: uso real com mouse/teclado no Chromium (motor do WebView2)."""
import asyncio, json, re, sys, os
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
OUT = os.environ.get("E2E_OUT", "tests/output/e2e")
os.makedirs(OUT, exist_ok=True)
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)

async def idle(pg):
    await pg.wait_for_function("() => window.__agtn3d && !window.__agtn3d.vp.animating", timeout=10000)
    await pg.wait_for_timeout(250)

async def click3d(pg, x, y, z, mods=None):
    p = await pg.evaluate(f"() => window.__agtn3d.vp.clientOf({x},{y},{z})")
    if mods:
        await pg.keyboard.down(mods)
    await pg.mouse.move(p["x"], p["y"])
    await pg.wait_for_timeout(120)
    await pg.mouse.click(p["x"], p["y"])
    if mods:
        await pg.keyboard.up(mods)
    await pg.wait_for_timeout(350)
    return p

async def props(pg):
    return await pg.inner_text(".w3-props")

async def create(pg, prim, fields, name=None, pos=None):
    await pg.click(f'[data-prim="{prim}"]')
    await pg.wait_for_selector(".modal .prim-form")
    for k, v in fields.items():
        await pg.fill(f'.prim-form input[data-field="{k}"]', str(v))
    if name:
        await pg.fill('.prim-form input[placeholder="automático"]', name)
    if pos:
        inputs = pg.locator(".prim-form .xyz input")
        for i, v in enumerate(pos):
            await inputs.nth(i).fill(str(v))
    await pg.click('[data-testid="prim-submit"]')
    await pg.wait_for_selector(".modal", state="detached")
    await pg.wait_for_function(f"() => [...document.querySelectorAll('.t3-name')].some(e => e.textContent === {json.dumps(name)})" if name else "() => true")

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = await b.new_context(viewport={"width": 1600, "height": 950}, accept_downloads=True)
        pg = await ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        await pg.get_by_text("Modelo 3D", exact=True).first.click()
        await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
        check("motor OCCT inicia no worker", True, (await pg.inner_text(".st3")).split("\n")[0])

        # ---------------- criação de sólidos e montagem
        await create(pg, "box", {"w": 500, "d": 300, "h": 10}, name="CHAPA", pos=[0, 0, 0])
        await create(pg, "profile", {"h": 100, "b": 50, "tw": 6, "tf": 8, "length": 600}, name="COLUNA", pos=[40, 40, 10])
        await create(pg, "tube", {"od": 60.3, "t": 3.91, "h": 250}, name="TUBO", pos=[380, 150, 10])
        await pg.wait_for_function("() => document.querySelectorAll('.t3-row').length === 3")
        await pg.wait_for_function("() => /3 corpo/.test(document.querySelector('.st3').innerText) && !/ 0 triângulos/.test(document.querySelector('.st3').innerText)")
        await pg.keyboard.press("Escape")
        await pg.click(".v3-canvas")
        await pg.keyboard.press("f")
        await idle(pg)
        await pg.screenshot(path=f"{OUT}/02_tres_corpos_iso.png")
        st = await pg.inner_text(".st3")
        check("3 corpos criados e regenerados", "3 corpo(s)" in st, re.sub(r"\s+", " ", st)[:160])

        # propriedades exatas do corpo (seleção pela árvore)
        await pg.click(".t3-row:has-text('CHAPA') .t3-name")
        await pg.wait_for_timeout(300)
        t = await props(pg)
        check("volume da chapa 500×300×10 = 1500 cm³", "1.500" in t and "cm³" in t, re.sub(r"\s+", " ", t)[:220])
        check("massa teórica aço 11,775 kg", "11,775" in t)

        # ---------------- vistas pelo ViewCube (clique real nas faces)
        await pg.locator('.vc-cell.face[data-dir="0,-1,0"]').first.click()
        await idle(pg)
        check("ViewCube FRENTE → vista Frontal", "Frontal" in await pg.inner_text(".st3"))
        await pg.locator('.vc-arrow.up').click()
        await idle(pg)
        check("seta do ViewCube (de Frontal para cima) → vista Superior", "Superior" in await pg.inner_text(".st3"))
        await pg.screenshot(path=f"{OUT}/03_superior.png")
        await pg.locator('.vc-cell.corner[data-dir="1,-1,1"] >> visible=true').first.click()
        await idle(pg)
        check("ViewCube canto → Isométrica", "Isométrica" in await pg.inner_text(".st3"))
        await pg.locator('.vc-cell.edge[data-dir="1,0,1"] >> visible=true').first.click()
        await idle(pg)
        check("ViewCube aresta → vista livre", "Vista livre" in await pg.inner_text(".st3"))
        await pg.keyboard.press("7")
        await idle(pg)

        # ---------------- seleção de face real (topo da chapa, fora das peças)
        await pg.keyboard.press("Escape")
        await click3d(pg, 450, 60, 10)
        t = await props(pg)
        check("clique na chapa seleciona FACE plana real do OCCT", "FACE Nº" in t.upper() and "Plana" in t, re.sub(r"\s+", " ", t)[:200])
        check("área exata da face superior = 150.000 mm²", "150.000" in t)
        await pg.screenshot(path=f"{OUT}/04_face_selecionada.png")

        # face cilíndrica externa do tubo: raio 30,15
        await pg.keyboard.press("Escape")
        await click3d(pg, 380 + 30.15 * 0.7071, 150 - 30.15 * 0.7071, 100)
        t = await props(pg)
        check("face cilíndrica do tubo: Ø 60,3", "Cilíndrica" in t and "60,3" in t, re.sub(r"\s+", " ", t)[:220])

        # aresta: borda frontal da chapa (y=0, z=10) — filtro aresta
        await pg.keyboard.press("Escape")
        await pg.click('[aria-label="Filtro de seleção"] button:nth-child(4)')
        await click3d(pg, 250, 0, 10)
        t = await props(pg)
        check("aresta reta da chapa: 500 mm", "ARESTA" in t.upper() and "Reta" in t and "500" in t, re.sub(r"\s+", " ", t)[:200])
        await pg.screenshot(path=f"{OUT}/05_aresta.png")

        # vértice: canto (500,300,10) — filtro vértice
        await pg.click('[aria-label="Filtro de seleção"] button:nth-child(5)')
        await click3d(pg, 500, 300, 10)
        t = await props(pg)
        check("vértice exato (500; 300; 10)", "VÉRTICE" in t.upper() and "500" in t and "300" in t, re.sub(r"\s+", " ", t)[:160])

        # ---------------- medição: vértice × vértice (diagonal da chapa) com Ctrl+clique
        await click3d(pg, 0, 0, 10, mods="Control")
        t = await props(pg)
        check("medição vértice×vértice = 583,095 mm (√(500²+300²))", "583,095" in t, re.sub(r"\s+", " ", t)[:260])
        check("ΔX = 500 e ΔY = 300", "500" in t and "300" in t)
        await pg.screenshot(path=f"{OUT}/06_medicao.png")

        # modo medir: face superior da chapa × topo do tubo (planos paralelos, folga 250)
        await pg.keyboard.press("Escape")
        await pg.keyboard.press("m")
        await pg.click('[aria-label="Filtro de seleção"] button:nth-child(3)')
        await click3d(pg, 450, 60, 10)
        await click3d(pg, 380 - 28 * 0.7071, 150 + 28 * 0.7071, 260)
        t = await props(pg)
        check("medir face×face paralelas: 250 mm, ângulo 0°", "250" in t and "Entre planos" in t, re.sub(r"\s+", " ", t)[:260])
        await pg.keyboard.press("Escape")
        await pg.click('[aria-label="Filtro de seleção"] button:nth-child(1)')

        # ---------------- árvore: renomear, ocultar, desfazer
        row = pg.locator(".t3-row:has-text('TUBO')")
        await row.dblclick()
        await pg.keyboard.press("Control+A")
        await pg.keyboard.type("TUBO_SUPORTE")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(300)
        check("renomear na árvore", await pg.locator(".t3-name", has_text="TUBO_SUPORTE").count() == 1)
        await pg.locator(".t3-row:has-text('TUBO_SUPORTE') .t3-act.eye").click()
        await pg.wait_for_timeout(300)
        hidden = await pg.evaluate("() => { const m = window.__agtn3d.doc.extras.agtn3d; return Object.values(m.nodes).filter(n => !n.visible).map(n => n.name) }")
        check("ocultar pela árvore altera o documento", hidden == ["TUBO_SUPORTE"], str(hidden))
        await pg.screenshot(path=f"{OUT}/07_tubo_oculto.png")
        await pg.keyboard.press("Control+z")
        await pg.wait_for_timeout(300)
        hidden = await pg.evaluate("() => Object.values(window.__agtn3d.doc.extras.agtn3d.nodes).filter(n => !n.visible).length")
        check("Ctrl+Z desfaz o ocultar", hidden == 0)

        # ---------------- conjunto (montagem): agrupar coluna + tubo
        await pg.click(".t3-row:has-text('COLUNA') .t3-name")
        await pg.click(".t3-row:has-text('TUBO_SUPORTE') .t3-name", modifiers=["Control"])
        await pg.keyboard.press("Control+g")
        await pg.wait_for_timeout(400)
        tree = await pg.inner_text(".t3")
        check("agrupar em conjunto (montagem)", "Conjunto 1" in tree, tree.replace("\n", " | "))
        # mover o conjunto inteiro 100 mm em Z pelo painel de propriedades
        await pg.click(".t3-row:has-text('Conjunto 1') .t3-name")
        z = pg.locator(".w3-props .xyz").first.locator("input").nth(2)
        await z.fill("100")
        await z.press("Enter")
        await pg.wait_for_timeout(800)
        zmin = await pg.evaluate("() => { const v = window.__agtn3d.vp; const m = window.__agtn3d.doc.extras.agtn3d; const id = Object.values(m.nodes).find(n => n.name==='COLUNA').id; return v.geom(id).props.bbox.min.z }")
        check("mover conjunto regenera filhos (COLUNA z mín = 110)", abs(zmin - 110) < 1e-6, str(zmin))

        # ---------------- modos de exibição
        await pg.click('[aria-label="Modo de exibição"] button:nth-child(3)')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"{OUT}/08_arame.png")
        await pg.click('[aria-label="Modo de exibição"] button:nth-child(2)')
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=f"{OUT}/09_sombreado.png")
        await pg.click('[aria-label="Modo de exibição"] button:nth-child(1)')
        await pg.keyboard.press("p")
        await pg.wait_for_timeout(300)
        check("alterna perspectiva (P)", "Perspectiva" in await pg.inner_text(".st3"))
        await pg.screenshot(path=f"{OUT}/10_perspectiva.png")
        await pg.keyboard.press("p")

        # ---------------- navegação: órbita, pan, zoom
        c0 = await pg.evaluate("() => { const c = window.__agtn3d.vp.camera; return [c.dir.x, c.dir.y, c.dir.z, c.height, c.target.x] }")
        box = await pg.locator(".v3-canvas").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        await pg.mouse.move(cx + 200, cy + 200)
        await pg.mouse.down()
        await pg.mouse.move(cx + 320, cy + 160, steps=8)
        await pg.mouse.up()
        c1 = await pg.evaluate("() => { const c = window.__agtn3d.vp.camera; return [c.dir.x, c.dir.y, c.dir.z] }")
        check("órbita com botão esquerdo muda a direção de vista", sum(abs(a - b) for a, b in zip(c0[:3], c1)) > 0.05)
        await pg.mouse.move(cx, cy)
        await pg.mouse.wheel(0, -400)
        await pg.wait_for_timeout(200)
        h1 = await pg.evaluate("() => window.__agtn3d.vp.camera.height")
        check("roda aproxima (zoom no cursor)", h1 < c0[3], f"{c0[3]:.1f} → {h1:.1f}")
        await pg.mouse.move(cx, cy)
        await pg.mouse.down(button="middle")
        await pg.mouse.move(cx + 150, cy, steps=6)
        await pg.mouse.up(button="middle")
        t1 = await pg.evaluate("() => window.__agtn3d.vp.camera.target.x")
        check("pan com botão do meio", abs(t1 - c0[4]) > 1)
        await pg.keyboard.press("f")
        await idle(pg)

        # ---------------- persistência: salvar .agtncad (download) e reabrir
        async with pg.expect_download() as dl:
            await pg.keyboard.press("Control+s")
        d = await dl.value
        path = f"{OUT}/projeto_3d.agtncad"
        await d.save_as(path)
        data = json.load(open(path))
        names = sorted(n["name"] for n in data["extras"]["agtn3d"]["nodes"].values())
        check("arquivo salvo contém o modelo 3D", names == ["CHAPA", "COLUNA", "Conjunto 1", "TUBO_SUPORTE"], str(names))
        vols_before = await pg.evaluate("() => { const v = window.__agtn3d.vp; const m = window.__agtn3d.doc.extras.agtn3d; return Object.values(m.nodes).filter(n=>n.kind==='body').map(n => [n.name, v.geom(n.id).props.volume]).sort() }")
        # novo documento e reabrir o arquivo
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        async with pg.expect_file_chooser() as fc:
            await pg.keyboard.press("Control+o")
        await (await fc.value).set_files(path)
        await pg.wait_for_timeout(800)
        await pg.get_by_role("button", name="3D", exact=True).click()
        await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
        await pg.wait_for_function("() => /3 corpo/.test(document.querySelector('.st3').innerText) && !/ 0 triângulos/.test(document.querySelector('.st3').innerText)", timeout=20000)
        await pg.wait_for_timeout(600)
        vols_after = await pg.evaluate("() => { const v = window.__agtn3d.vp; const m = window.__agtn3d.doc.extras.agtn3d; return Object.values(m.nodes).filter(n=>n.kind==='body').map(n => [n.name, v.geom(n.id).props.volume]).sort() }")
        check("reabrir: mesmos corpos e volumes idênticos", vols_before == vols_after, str(vols_after))
        await pg.screenshot(path=f"{OUT}/11_reaberto.png")

        # ---------------- STEP: exportar (download) e reimportar
        async with pg.expect_download() as dl:
            await pg.click(".rb-btn:has-text('STEP')")
        d = await dl.value
        spath = f"{OUT}/modelo.step"
        await d.save_as(spath)
        stxt = open(spath, encoding="utf-8", errors="replace").read()
        check("STEP exportado com nomes", stxt.startswith("ISO-10303-21") and "COLUNA" in stxt and "TUBO_SUPORTE" in stxt, f"{len(stxt)} bytes")
        async with pg.expect_file_chooser() as fc:
            await pg.click(".rb-btn:has-text('Importar')")
        await (await fc.value).set_files(spath)
        await pg.wait_for_function("() => /6 corpo/.test(document.querySelector('.st3').innerText)", timeout=30000)
        await pg.wait_for_timeout(800)
        tree = await pg.inner_text(".t3")
        check("STEP reimportado: 6 corpos, nomes preservados", tree.count("COLUNA") == 2 and tree.count("TUBO_SUPORTE") == 2, tree.replace("\n", " | "))
        await pg.keyboard.press("f")
        await idle(pg)
        await pg.screenshot(path=f"{OUT}/12_step_reimportado.png")

        # ---------------- 2D intacto
        await pg.click(".ws-tab:has-text('DESENHO')")
        await pg.wait_for_timeout(500)
        await pg.keyboard.type("REC")
        await pg.keyboard.press("Enter")
        await pg.keyboard.type("0,0")
        await pg.keyboard.press("Enter")
        await pg.keyboard.type("200,100")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(400)
        n2d = await pg.evaluate("() => window.__agtn3d.doc.size")
        check("2D continua funcionando (REC cria entidade no mesmo documento)", n2d == 1, str(n2d))
        await pg.screenshot(path=f"{OUT}/13_desenho_2d.png")
        await pg.click(".ws-tab:has-text('3D')")
        await pg.wait_for_selector(".st3-dot.ready")
        await pg.wait_for_function("() => /6 corpo/.test(document.querySelector('.st3').innerText) && !/ 0 triângulos/.test(document.querySelector('.st3').innerText)", timeout=15000)
        check("voltar ao 3D: viewport novo recebe toda a geometria", True, re.sub(r"\s+", " ", await pg.inner_text(".st3"))[:120])
        # criar e renomear em seguida (dois syncs encadeados) não pode perder geometria
        await create(pg, "sphere", {"r": 40}, name="ESFERA", pos=[250, 150, 300])
        await pg.locator(".t3-row:has-text('ESFERA')").dblclick()
        await pg.keyboard.press("Control+A")
        await pg.keyboard.type("ESFERA_2")
        await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(1200)
        has = await pg.evaluate("() => { const m = window.__agtn3d.doc.extras.agtn3d; const id = Object.values(m.nodes).find(n => n.name==='ESFERA_2').id; return !!window.__agtn3d.vp.geom(id) }")
        check("criar + renomear em seguida: corpo aparece no viewport", has)

        # ---------------- memória
        mem = await pg.evaluate("() => performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : -1")
        st = re.sub(r"\s+", " ", await pg.inner_text(".st3"))
        check("memória: heap JS da interface (MB)", mem > 0, f"{mem} MB · {st}")

        check("sem erros de página", not errors, "; ".join(errors[:3]))
        await b.close()
    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)}/{len(results)} verificações OK")
    json.dump([{"teste": n, "ok": o, "detalhe": d} for n, o, d in results], open(f"{OUT}/resultado.json", "w"), ensure_ascii=False, indent=1)
    sys.exit(1 if fails else 0)

asyncio.run(main())
