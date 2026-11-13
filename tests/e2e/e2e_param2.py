"""FASE 3 — parte 2: ferramentas do esboço (linha, restrições por botão, aparar, offset, construção, Undo
interno, cancelar), referência perdida com erro explícito, furo com rebaixo + padrão circular + espelho,
casca + união com outro corpo, varredura e loft em planos XZ/YZ. Valores conferidos com geometria conhecida."""
import asyncio, json, math, os, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
OUT = os.environ.get("E2E_OUT", "tests/output/e2e_param2")
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


async def idle(pg, extra=250):
    await pg.wait_for_function("() => window.__agtn3d && !window.__agtn3d.vp.animating", timeout=10000)
    await pg.wait_for_timeout(extra)


async def click3d(pg, x, y, z, mod=None):
    p = await pg.evaluate(f"() => window.__agtn3d.vp.clientOf({x},{y},{z})")
    await pg.mouse.move(p["x"], p["y"])
    await pg.wait_for_timeout(90)
    if mod:
        await pg.keyboard.down(mod)
    await pg.mouse.click(p["x"], p["y"])
    if mod:
        await pg.keyboard.up(mod)
    await pg.wait_for_timeout(220)


VOL = """(name) => { const a = window.__agtn3d; const m = a.model();
  const b = Object.values(m.nodes).find(n => n.kind === 'body' && n.name === name); const g = b && a.vp.geom(b.id);
  return g ? g.props.volume : null }"""


async def vol(pg, name):
    return await pg.evaluate(VOL, name)


async def wait_vol(pg, name, expect, tol=0.5, timeout=15000):
    try:
        await pg.wait_for_function(f"(n) => {{ const v = ({VOL})(n); return v !== null && Math.abs(v - {expect}) < {tol} }}", arg=name, timeout=timeout)
    except Exception:
        pass
    return await vol(pg, name)


async def sk_state(pg):
    return await pg.evaluate("""() => { const s = window.__agtn3d.sketch().getState(); const sk = s.sketch;
      const P = (id) => sk.points[id] ?? ({ O: {x:0,y:0}, _X: {x:1,y:0}, _Y: {x:0,y:1} })[id];
      return { status: s.solve.status, dof: s.solve.dof, msg: s.message, err: s.error,
        ents: Object.values(sk.entities).map(e => e.t === 'line' ? { id: e.id, t: 'line', cons: !!e.cons, a: P(e.p1), b: P(e.p2) } : { id: e.id, t: e.t, cons: !!e.cons, r: e.r }),
        cons: sk.constraints.map(c => c.t) } }""")


async def dim(pg, x, y, z, value, kind=None, second=None):
    await pg.keyboard.press("d")
    await click3d(pg, x, y, z)
    if second:
        await click3d(pg, *second)
    await pg.wait_for_selector('[data-testid="dim-input"]', timeout=4000)
    if kind:
        await pg.select_option(".sk-prompt select", kind)
        await pg.wait_for_timeout(100)
    await pg.fill('[data-testid="dim-input"]', str(value))
    await pg.keyboard.press("Enter")
    await pg.wait_for_timeout(250)


async def new_sketch(pg, plane, dest="", offset=0):
    await pg.click('.rb [data-op="sketch"]')
    await pg.wait_for_selector(".plane-ask")
    await pg.select_option('.plane-ask select[data-field="destino"]', dest)
    if offset:
        await pg.fill(".plane-ask .unit-in input", str(offset))
    await pg.click(f'[data-plane="{plane}"]')
    await pg.wait_for_selector(".sk-rb")
    await idle(pg, 400)


async def finish(pg):
    await pg.click('[data-testid="sketch-finish"]')
    await pg.wait_for_selector(".sk-rb", state="detached")
    await idle(pg, 400)


async def feature(pg, op, fields=None, before_ok=None, ok=True, selects=None):
    await pg.click(f'.rb [data-op="{op}"]')
    await pg.wait_for_selector(".fd", timeout=5000)
    for label, v in (selects or {}).items():
        await pg.select_option(f'.fd .p3-row:has(.k:text-is("{label}")) select', v)
    for label, v in (fields or {}).items():
        inp = pg.locator(f'.fd .p3-row:has(.k:text-is("{label}")) input').first
        await inp.fill(str(v))
        await inp.press("Tab")
    if before_ok:
        await before_ok()
    await pg.wait_for_timeout(200)
    await pg.wait_for_function("() => !/Calculando/.test(document.querySelector('[data-testid=feature-status]')?.innerText ?? '')", timeout=20000)
    await pg.wait_for_timeout(250)
    st = await pg.inner_text('[data-testid="feature-status"]')
    if ok:
        await pg.click('[data-testid="feature-ok"]')
        await pg.wait_for_selector(".fd", state="detached", timeout=5000)
        await pg.wait_for_timeout(500)
    return st.replace("\n", " ")


async def body_id(pg, name):
    return await pg.evaluate("(n) => Object.values(window.__agtn3d.model().nodes).find(x => x.name === n)?.id", name)


async def hide(pg, name):
    bid = await body_id(pg, name)
    await pg.click(f'.t3-row[data-node="{bid}"] .t3-act.eye')
    await pg.wait_for_timeout(300)


async def select_body(pg, name):
    bid = await body_id(pg, name)
    await pg.click(f'.t3-row[data-node="{bid}"] .t3-name')
    await pg.wait_for_timeout(200)


async def last_body(pg):
    return await pg.evaluate("() => { const b = Object.values(window.__agtn3d.model().nodes).filter(n => n.kind === 'body'); return b[b.length - 1].name }")


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
        try:
            # =============== A. ferramentas do esboço
            await new_sketch(pg, "XY")
            await pg.keyboard.press("l")
            await click3d(pg, 0, 0, 0)
            await click3d(pg, 60, 0, 0)
            await click3d(pg, 60, 40, 0)
            await pg.keyboard.press("Escape")
            s = await sk_state(pg)
            check("linha em cadeia: 2 linhas com horizontal/vertical automáticas", len(s["ents"]) == 2 and "horizontal" in s["cons"] and "vertical" in s["cons"], str(s["cons"]))
            # linha inclinada + paralela e igual por botão
            await pg.keyboard.press("l")
            await click3d(pg, 5, 15, 0)
            await click3d(pg, 40, 33, 0)
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("Escape")
            await click3d(pg, 22, 24, 0)
            await click3d(pg, 30, 0, 0, mod="Control")
            await pg.click('[data-cons="parallel"]')
            await pg.wait_for_timeout(250)
            s = await sk_state(pg)
            l3 = s["ents"][2]
            check("botão Paralela: linha inclinada fica horizontal", abs(l3["a"]["y"] - l3["b"]["y"]) < 1e-6, json.dumps(l3))
            await click3d(pg, (l3["a"]["x"] + l3["b"]["x"]) / 2, l3["a"]["y"], 0)
            await click3d(pg, 30, 0, 0, mod="Control")
            await pg.click('[data-cons="equal"]')
            await pg.wait_for_timeout(250)
            s = await sk_state(pg)
            L = lambda e: math.hypot(e["b"]["x"] - e["a"]["x"], e["b"]["y"] - e["a"]["y"])
            l1, l2, l3 = s["ents"][0], s["ents"][1], s["ents"][2]
            check("botão Igual: as duas linhas ficam com o mesmo comprimento", abs(L(l1) - L(l3)) < 1e-6, f"{L(l1):.6f} = {L(l3):.6f}")
            await pg.screenshot(path=f"{OUT}/01_restricoes.png")
            # offset com distância exata (5 mm) da linha vertical
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("Escape")
            xv = l2["a"]["x"]
            ym = (l2["a"]["y"] + l2["b"]["y"]) / 2
            await pg.keyboard.press("o")
            await pg.fill(".sk-opt input", "5")
            await pg.keyboard.press("Tab")
            n0 = len(s["ents"])
            await click3d(pg, xv, ym, 0)
            await click3d(pg, xv + 15, ym, 0)
            s = await sk_state(pg)
            xs = sorted(round(e["a"]["x"] - xv, 6) for e in s["ents"] if e["t"] == "line" and abs(e["a"]["x"] - e["b"]["x"]) < 1e-9)
            n_off = len(s["ents"])
            check("offset de 5 mm exatos (cadeia conectada: linha vertical e a horizontal ligada a ela)", n_off > n0 and 5.0 in xs, f"{xs} · {n_off - n0} curva(s) nova(s)")
            await pg.keyboard.press("Control+z")
            await pg.wait_for_timeout(200)
            n1 = len((await sk_state(pg))["ents"])
            check("Ctrl+Z dentro do esboço desfaz o offset", n1 == n0, f"{n1} entidades")
            await pg.keyboard.press("Control+y")
            await pg.wait_for_timeout(200)
            check("Ctrl+Y refaz", len((await sk_state(pg))["ents"]) == n_off)
            # aparar: linha vertical cruzando a primeira; apara o trecho da esquerda
            x0, x1 = sorted([l1["a"]["x"], l1["b"]["x"]])
            xc = x0 + 20
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("l")
            await click3d(pg, xc, -10, 0)
            await click3d(pg, xc, 10, 0)
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("t")
            await click3d(pg, x0 + 8, 0, 0)
            s = await sk_state(pg)
            bottoms = [e for e in s["ents"] if e["t"] == "line" and abs(e["a"]["y"]) < 1e-6 and abs(e["b"]["y"]) < 1e-6]
            spans = sorted((round(min(e["a"]["x"], e["b"]["x"]) - xc, 3), round(max(e["a"]["x"], e["b"]["x"]) - x1, 3)) for e in bottoms)
            check("aparar: trecho à esquerda do cruzamento removido", spans == [(0.0, 0.0)], str(spans) + " " + str(s["err"]))
            # construção
            await pg.keyboard.press("Escape")
            await click3d(pg, xc, 6, 0)
            await pg.click('.sk-rb button:has-text("Construção")')
            s = await sk_state(pg)
            check("alternar construção", any(e["cons"] for e in s["ents"]))
            await pg.screenshot(path=f"{OUT}/02_ferramentas.png")
            nb = await pg.evaluate("() => Object.values(window.__agtn3d.model().nodes).length")
            await pg.click('.sk-rb button:has-text("Cancelar")')
            await pg.wait_for_selector(".sk-rb", state="detached")
            nb2 = await pg.evaluate("() => Object.values(window.__agtn3d.model().nodes).length")
            check("cancelar o esboço não cria nada no documento", nb == nb2 == 0, f"{nb} → {nb2}")

            # =============== E. referência perdida → erro explícito
            await new_sketch(pg, "XY")
            await pg.keyboard.press("r")
            await click3d(pg, 0, 0, 0)
            await click3d(pg, 80, 50, 0)
            await dim(pg, 40, 50, 0, 80)
            await dim(pg, 80, 25, 0, 50)
            await finish(pg)
            E = await last_body(pg)
            await feature(pg, "extrude", {"Profundidade": 10})
            await idle(pg)

            async def edge0():
                await click3d(pg, 80, 0, 5)
                await pg.wait_for_function("() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", timeout=5000)

            await feature(pg, "fillet", {"Raio": 4}, before_ok=edge0)
            vE = 80 * 50 * 10 - (16 - math.pi * 4) * 10
            v = await wait_vol(pg, E, vE)
            check("base para o teste: arredondamento R4", abs(v - vE) < 0.5, f"{v:.2f}")
            await pg.locator('[data-feat="Esboço_1"]').dblclick()
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 400)
            for x, y in [(40, 0), (40, 50), (0, 25), (80, 25)]:
                await click3d(pg, x, y, 0, mod="Control")
            await pg.keyboard.press("Delete")
            await pg.keyboard.press("c")
            await click3d(pg, 40, 25, 0)
            await click3d(pg, 60, 25, 0)
            await dim(pg, 60, 25, 0, 40, kind="diameter")
            await finish(pg)
            await pg.wait_for_timeout(1500)
            st = await pg.evaluate("(id) => window.__agtn3d.status()[id]", await body_id(pg, E))
            fil = st[-1] if st else {}
            v = await vol(pg, E)
            toast = await pg.inner_text("body")
            check(
                "aresta sumiu → Arredondar_1 com erro explícito (sem trocar de aresta), peça segue com a extrusão",
                fil.get("state") == "error" and "eferência" in (fil.get("error") or "") and abs(v - math.pi * 400 * 10) < 0.5,
                f"{fil.get('error')} · vol {v:.2f}",
            )
            await pg.locator('[data-feat="Arredondar_1"]').click()
            await pg.screenshot(path=f"{OUT}/03_referencia_perdida.png")
            check("erro aparece na árvore e nas propriedades", await pg.locator('[data-feat="Arredondar_1"].error').count() == 1 and "eferência" in await pg.inner_text(".w3-props"))
            await hide(pg, E)

            # =============== B. base centrada, furo com rebaixo, padrão circular, espelho
            await new_sketch(pg, "XY")
            await pg.keyboard.press("r")
            await click3d(pg, -50, -50, 0)
            await click3d(pg, 50, 50, 0)
            await dim(pg, 0, 50, 0, 100)
            await dim(pg, 50, 0, 0, 100)
            await dim(pg, 0, 0, 0, 50, kind="distanceX", second=(-50, -50, 0))
            await dim(pg, 0, 0, 0, 50, kind="distanceY", second=(-50, -50, 0))
            s = await sk_state(pg)
            check("retângulo centrado por cotas da origem → totalmente definido", s["status"] == "full", f"{s['status']} {s['dof']} {s['err']}")
            await finish(pg)
            B = await last_body(pg)
            await feature(pg, "extrude", {"Profundidade": 30})
            await idle(pg)
            await pg.click('button[title="Selecionar: Faces"]')
            await click3d(pg, 0, 0, 30)
            await pg.click('.rb [data-op="sketch"]')
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 400)
            await pg.keyboard.press("p")
            await click3d(pg, 0, 30, 30)
            await finish(pg)

            async def cbore():
                await pg.locator('.fd label:has-text("Rebaixo") input').check()
                await pg.wait_for_timeout(150)
                for label, v in {"Ø rebaixo": 15, "Prof. rebaixo": 5}.items():
                    inp = pg.locator(f'.fd .p3-row:has(.k:text-is("{label}")) input').first
                    await inp.fill(str(v))
                    await inp.press("Tab")

            st = await feature(pg, "hole", {"Diâmetro": 8.5}, before_ok=cbore)
            hole = math.pi * 4.25**2 * 30 + math.pi * (7.5**2 - 4.25**2) * 5
            vB1 = 300000 - hole
            v = await wait_vol(pg, B, vB1)
            check("Furo_1: Ø8,5 passante com rebaixo Ø15×5", abs(v - vB1) < 0.5, f"{v:.2f} esperado {vB1:.2f} · {st}")

            async def furo():
                for lab in ["Extrusão_1"]:
                    loc = pg.locator(f'.fd label:has-text("{lab}") input')
                    if await loc.is_checked():
                        await loc.uncheck()
                await pg.locator('.fd label:has-text("Furo_1") input').check()

            st = await feature(pg, "patternc", {"Quantidade": 4}, before_ok=furo)
            vB2 = 300000 - 4 * hole
            v = await wait_vol(pg, B, vB2)
            check("padrão circular: 4 furos em 360° no eixo Z", abs(v - vB2) < 0.5, f"{v:.2f} esperado {vB2:.2f} · {st}")
            await pg.keyboard.press("Home")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/04_furos_padrao_circular.png")
            st = await feature(pg, "mirror", {"Deslocamento": 50})
            v = await wait_vol(pg, B, 2 * vB2, tol=1)
            check("espelho do corpo no plano YZ deslocado 50 mm → volume dobra", abs(v - 2 * vB2) < 1, f"{v:.2f} esperado {2 * vB2:.2f} · {st}")
            await pg.keyboard.press("f")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/05_espelho.png")
            await hide(pg, B)

            # =============== C. casca (face superior aberta) + união com outro corpo
            await pg.click('[data-tab="corpos"]')
            await pg.click('[data-prim="box"]')
            await pg.wait_for_selector(".modal .prim-form")
            for k, v in {"w": 100, "d": 60, "h": 40}.items():
                await pg.fill(f'.prim-form input[data-field="{k}"]', str(v))
            await pg.fill('.prim-form input[placeholder="automático"]', "CAIXA")
            await pg.click('[data-testid="prim-submit"]')
            await pg.wait_for_selector(".modal", state="detached")
            await pg.click('[data-tab="modelar"]')
            await pg.keyboard.press("f")
            await idle(pg)
            await select_body(pg, "CAIXA")

            async def top():
                await click3d(pg, 50, 30, 40)
                await pg.wait_for_function("() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", timeout=5000)

            st = await feature(pg, "shell", {"Espessura": 3}, before_ok=top)
            vC = 100 * 60 * 40 - 94 * 54 * 37
            v = await wait_vol(pg, "CAIXA", vC)
            tree = await pg.inner_text(".t3")
            check("primitiva convertida em peça (Base_1) + casca 3 mm com topo aberto", abs(v - vC) < 0.5 and "Base_1" in tree and "Casca_1" in tree, f"{v:.2f} esperado {vC} · {st}")
            await pg.screenshot(path=f"{OUT}/06_casca.png")
            await pg.click('[data-tab="corpos"]')
            await pg.click('[data-prim="box"]')
            await pg.wait_for_selector(".modal .prim-form")
            for k, v in {"w": 20, "d": 20, "h": 20}.items():
                await pg.fill(f'.prim-form input[data-field="{k}"]', str(v))
            await pg.fill('.prim-form input[placeholder="automático"]', "TACO")
            inputs = pg.locator(".prim-form .xyz input")
            for i, v in enumerate([100, 20, 0]):
                await inputs.nth(i).fill(str(v))
            await pg.click('[data-testid="prim-submit"]')
            await pg.wait_for_selector(".modal", state="detached")
            await pg.click('[data-tab="modelar"]')
            await select_body(pg, "CAIXA")

            async def tool():
                await pg.locator('.fd label:has-text("TACO") input').check()

            st = await feature(pg, "combine-join", before_ok=tool)
            v = await wait_vol(pg, "CAIXA", vC + 8000)
            hidden = await pg.evaluate("() => Object.values(window.__agtn3d.model().nodes).find(n => n.name === 'TACO').visible")
            check("União com corpo TACO (encostado): volume soma e ferramenta fica oculta", abs(v - (vC + 8000)) < 0.5 and hidden is False, f"{v:.2f} · {st}")
            # editar a ferramenta regenera a combinação
            await select_body(pg, "TACO")
            await pg.wait_for_timeout(300)
            await pg.screenshot(path=f"{OUT}/07_uniao.png")
            await hide(pg, "CAIXA")

            # =============== D. varredura: trajetória no XY + perfil circular no XZ
            await new_sketch(pg, "XY")
            await pg.keyboard.press("l")
            await click3d(pg, 0, 0, 0)
            await click3d(pg, 0.0, 80, 0)
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("Escape")
            await dim(pg, 0, 40, 0, 100)
            await finish(pg)
            D = await last_body(pg)
            await new_sketch(pg, "XZ", dest=await body_id(pg, D))
            await pg.keyboard.press("c")
            await click3d(pg, 0, 0, 0)
            await click3d(pg, 6, 0, 0)
            await dim(pg, 6, 0, 0, 10, kind="diameter")
            await finish(pg)
            st = await feature(pg, "sweep", selects={"Perfil": await pg.evaluate("(n) => window.__agtn3d.model().nodes[n].source.features[1].id", await body_id(pg, D)), "Trajetória": await pg.evaluate("(n) => window.__agtn3d.model().nodes[n].source.features[0].id", await body_id(pg, D))})
            vD = math.pi * 25 * 100
            v = await wait_vol(pg, D, vD, tol=1)
            check("Varredura: círculo Ø10 ao longo de 100 mm", v is not None and abs(v - vD) < 1, f"{v} esperado {vD:.2f} · {st}")
            await pg.keyboard.press("f")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/08_varredura.png")
            await hide(pg, D)

            # =============== F. loft entre dois quadrados em planos YZ (0 e 50 mm)
            await new_sketch(pg, "YZ")
            await pg.keyboard.press("r")
            await click3d(pg, 0, 0, 0)
            await click3d(pg, 0, 40, 40)
            await dim(pg, 0, 20, 40, 40)
            await dim(pg, 0, 40, 20, 40)
            await finish(pg)
            F = await last_body(pg)
            await new_sketch(pg, "YZ", dest=await body_id(pg, F), offset=50)
            await pg.keyboard.press("r")
            await click3d(pg, 50, 10, 10)
            await click3d(pg, 50, 30, 30)
            await dim(pg, 50, 20, 30, 20)
            await dim(pg, 50, 30, 20, 20)
            await dim(pg, 50, 0, 0, 10, kind="distanceX", second=(50, 10, 10))
            await dim(pg, 50, 0, 0, 10, kind="distanceY", second=(50, 10, 10))
            s = await sk_state(pg)
            check("segundo quadrado (YZ + 50 mm) totalmente definido", s["status"] == "full", f"{s['status']} {s['dof']} {s['err']}")
            await finish(pg)

            async def ruled():
                await pg.locator('.fd label:has-text("regrado") input').check()

            st = await feature(pg, "loft", before_ok=ruled)
            vF = 50 / 3 * (1600 + 400 + math.sqrt(1600 * 400))
            v = await wait_vol(pg, F, vF, tol=1)
            check("Loft regrado entre quadrados 40 e 20 a 50 mm (tronco de pirâmide)", v is not None and abs(v - vF) < 1, f"{v} esperado {vF:.2f} · {st}")
            await pg.keyboard.press("f")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/09_loft.png")
        except Exception:
            await pg.screenshot(path=f"{OUT}/zz_falha.png")
            raise
        check("sem erros de página", not errors, "; ".join(errors[:3]))
        await b.close()
    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)}/{len(results)} verificações OK")
    json.dump([{"teste": n, "ok": o, "detalhe": d} for n, o, d in results], open(f"{OUT}/resultado.json", "w"), ensure_ascii=False, indent=1)
    sys.exit(1 if fails else 0)


asyncio.run(main())
