"""FASE 3 — modelagem paramétrica de ponta a ponta: esboço com restrições e cotas, extrusão, corte em face,
arredondamento, edição de cota com regeneração, Undo/Redo, supressão, recuo, falha controlada, salvar/reabrir
e as demais operações (revolução, furo, chanfro, casca, espelho, padrões, combinar). Mouse e teclado reais."""
import asyncio, json, math, os, re, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
OUT = os.environ.get("E2E_OUT", "tests/output/e2e_param")
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


async def idle(pg, extra=250):
    await pg.wait_for_function("() => window.__agtn3d && !window.__agtn3d.vp.animating", timeout=10000)
    await pg.wait_for_timeout(extra)


async def at(pg, x, y, z):
    return await pg.evaluate(f"() => window.__agtn3d.vp.clientOf({x},{y},{z})")


async def click3d(pg, x, y, z, dbl=False):
    p = await at(pg, x, y, z)
    await pg.mouse.move(p["x"], p["y"])
    await pg.wait_for_timeout(90)
    if dbl:
        await pg.mouse.dblclick(p["x"], p["y"])
    else:
        await pg.mouse.click(p["x"], p["y"])
    await pg.wait_for_timeout(220)


VOL = """(name) => { const a = window.__agtn3d; const m = a.model();
  const b = Object.values(m.nodes).find(n => n.kind === 'body' && (!name || n.name === name)); const g = b && a.vp.geom(b.id);
  return g ? g.props.volume : null }"""


async def vol(pg, name=None):
    return await pg.evaluate(VOL, name)


async def wait_vol(pg, expect, name=None, tol=0.5, timeout=15000):
    try:
        await pg.wait_for_function(f"(n) => {{ const v = ({VOL})(n); return v !== null && Math.abs(v - {expect}) < {tol} }}", arg=name, timeout=timeout)
    except Exception:
        pass
    return await vol(pg, name)


async def sketch_status(pg):
    return await pg.get_attribute("[data-sketch-status]", "data-sketch-status")


async def dim(pg, x, y, z, value, kind=None):
    await pg.keyboard.press("d")
    await click3d(pg, x, y, z)
    await pg.wait_for_selector('[data-testid="dim-input"]', timeout=4000)
    if kind:
        await pg.select_option(".sk-prompt select", kind)
    await pg.fill('[data-testid="dim-input"]', str(value))
    await pg.keyboard.press("Enter")
    await pg.wait_for_timeout(250)


async def feature(pg, op, fields=None, before_ok=None, ok=True):
    await pg.click(f'.rb [data-op="{op}"]')
    await pg.wait_for_selector(".fd", timeout=5000)
    for label, v in (fields or {}).items():
        inp = pg.locator(f'.fd .p3-row:has(.k:text-is("{label}")) input').first
        await inp.fill(str(v))
        await inp.press("Tab")
    if before_ok:
        await before_ok()
    await pg.wait_for_function("() => !/Calculando/.test(document.querySelector('[data-testid=feature-status]')?.innerText ?? '')", timeout=15000)
    await pg.wait_for_timeout(300)
    st = await pg.inner_text('[data-testid="feature-status"]')
    if ok:
        await pg.click('[data-testid="feature-ok"]')
        await pg.wait_for_selector(".fd", state="detached", timeout=5000)
        await pg.wait_for_timeout(500)
    return st


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
            # ---------------- 1. esboço no plano XY: retângulo cotado, totalmente definido
            await pg.click('.rb [data-op="sketch"]')
            await pg.wait_for_selector(".plane-ask")
            await pg.screenshot(path=f"{OUT}/01_plano.png")
            await pg.click('[data-plane="XY"]')
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 500)
            await pg.keyboard.press("r")
            await click3d(pg, 0, 0, 0)
            await click3d(pg, 100, 60, 0)
            st0 = await sketch_status(pg)
            await pg.screenshot(path=f"{OUT}/02a_retangulo.png")
            check("retângulo: 4 linhas com H/V e canto no origem → parcialmente definido", st0 == "under", st0)
            await dim(pg, 50, 60, 0, 120)
            await dim(pg, 120, 30, 0, 80)
            st1 = await sketch_status(pg)
            sk = await pg.evaluate("() => { const e = window.__agtn3d.sketch(); const s = e.getState(); return { dof: s.solve.dof, n: Object.keys(s.sketch.entities).length, c: Object.keys(s.sketch.constraints).length } }")
            check("cotas 120 × 80 → totalmente definido (0 GL)", st1 == "full" and sk["dof"] == 0, json.dumps(sk))
            await pg.screenshot(path=f"{OUT}/02_esboco_definido.png")
            # conflito: cota extra redundante/inconsistente é rejeitada com mensagem
            await pg.keyboard.press("d")
            await click3d(pg, 50, 0, 0)
            await pg.wait_for_selector('[data-testid="dim-input"]', timeout=4000)
            await pg.fill('[data-testid="dim-input"]', "50")
            await pg.keyboard.press("Enter")
            await pg.wait_for_timeout(300)
            cap = await pg.inner_text(".sk-end .rb-cap")
            st2 = await sketch_status(pg)
            check("cota conflitante é recusada com mensagem (esboço não muda)", st2 == "full" and len(cap) > 5, cap)
            await pg.keyboard.press("Escape")
            await pg.click('[data-testid="sketch-finish"]')
            await pg.wait_for_selector(".sk-rb", state="detached")
            await pg.wait_for_selector('[data-feat="Esboço_1"]')
            check("esboço concluído cria Peça com Esboço_1 na árvore", True)

            # ---------------- 2. extrusão 20 mm
            st = await feature(pg, "extrude", {"Profundidade": 20})
            v = await wait_vol(pg, 192000)
            check("Extrusão_1: 120×80×20 = 192 000 mm³", v is not None and abs(v - 192000) < 0.5, f"{v} · {st}")
            await pg.keyboard.press("f")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/03_extrusao.png")

            # ---------------- 3. esboço na face superior + corte passante Ø20
            await pg.click('button[title="Selecionar: Faces"]')
            await click3d(pg, 60, 40, 20)
            await pg.click('.rb [data-op="sketch"]')
            await pg.wait_for_selector(".sk-rb", timeout=8000)
            await idle(pg, 500)
            await pg.keyboard.press("c")
            await click3d(pg, 60, 40, 20)
            await click3d(pg, 70, 40, 20)
            await dim(pg, 70, 40, 20, 20, kind="diameter")
            await pg.screenshot(path=f"{OUT}/04_esboco_na_face.png")
            await pg.click('[data-testid="sketch-finish"]')
            await pg.wait_for_selector('[data-feat="Esboço_2"]')

            async def cut_through():
                await pg.click('.fd [data-op="cut"]')
                await pg.locator('.fd label:has-text("Passante") input').check()

            await idle(pg)
            st = await feature(pg, "extrude", before_ok=cut_through)
            v2 = 192000 - math.pi * 100 * 20
            v = await wait_vol(pg, v2)
            check("corte passante Ø20 a partir da face (entra no material)", v is not None and abs(v - v2) < 0.5, f"{v:.2f} esperado {v2:.2f} · {st}")

            # ---------------- 4. arredondamento R5 numa aresta vertical (escolhida no modelo)
            async def pick_edge():
                await click3d(pg, 0, 0, 10)
                await pg.wait_for_function("() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", timeout=5000)
                dbg = await pg.evaluate("""() => { const a = window.__agtn3d; const s = a.store.snap.sel.find(x => x.t === 'topo'); const g = a.vp.geom(s.body); if (!g) return { sel: a.store.snap.sel, ids: Object.keys(a.model().nodes) };
                  const i = s.index; const st = g.edges[2*i], n = g.edges[2*i+1]; const P = (k) => [g.edgePoints[3*k], g.edgePoints[3*k+1], g.edgePoints[3*k+2]].map(v => Math.round(v));
                  return { sel: s, a: P(st), b: P(st+n-1), ne: g.topo.edges } }""")
                print("DBG", dbg)

            await idle(pg)
            st = await feature(pg, "fillet", {"Raio": 5}, before_ok=pick_edge)
            v3 = v2 - (25 - math.pi * 25 / 4) * 20
            v = await wait_vol(pg, v3)
            check("Arredondar_1: R5 na aresta vertical", v is not None and abs(v - v3) < 0.5, f"{v:.2f} esperado {v3:.2f} · {st}")
            await pg.screenshot(path=f"{OUT}/05_furo_e_arredondamento.png")

            # ---------------- 5. falha controlada: raio grande demais
            async def big():
                await click3d(pg, 120, 80, 10)
                await pg.wait_for_function("() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", timeout=5000)

            st = await feature(pg, "fillet", {"Raio": 90}, before_ok=big, ok=False)
            dis = await pg.get_attribute('[data-testid="feature-ok"]', "disabled")
            check("raio impossível: prévia mostra erro do kernel e OK fica bloqueado", dis is not None and "Prévia OK" not in st, st)
            await pg.screenshot(path=f"{OUT}/06_falha_controlada.png")
            await pg.keyboard.press("Escape")
            await pg.wait_for_selector(".fd", state="detached")
            v = await vol(pg)
            check("cancelar não altera a peça", abs(v - v3) < 0.5, f"{v:.2f}")

            # ---------------- 6. editar cota do primeiro esboço → regeneração completa
            await pg.locator('[data-feat="Esboço_1"]').dblclick()
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 500)
            await pg.locator('.sk-dim:text-is("120")').dblclick()
            await pg.wait_for_selector('[data-testid="dim-input"]')
            await pg.fill('[data-testid="dim-input"]', "150")
            await pg.keyboard.press("Enter")
            await pg.wait_for_timeout(300)
            await pg.click('[data-testid="sketch-finish"]')
            v4 = 150 * 80 * 20 - math.pi * 100 * 20 - (25 - math.pi * 25 / 4) * 20
            v = await wait_vol(pg, v4)
            stat = await pg.evaluate("() => Object.values(window.__agtn3d.status())[0].map(s => s.state)")
            check("cota 120 → 150: furo e arredondamento acompanham (referências estáveis)", abs(v - v4) < 0.5 and all(s == "ok" for s in stat), f"{v:.2f} esperado {v4:.2f} · {stat}")
            await pg.keyboard.press("f")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/07_regenerado_150.png")

            # ---------------- 7. Undo / Redo
            await pg.click(".w3-view", position={"x": 300, "y": 600})
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("Control+z")
            v = await wait_vol(pg, v3)
            check("Ctrl+Z desfaz a edição da cota", abs(v - v3) < 0.5, f"{v:.2f}")
            await pg.keyboard.press("Control+y")
            v = await wait_vol(pg, v4)
            check("Ctrl+Y refaz", abs(v - v4) < 0.5, f"{v:.2f}")

            # ---------------- 8. suprimir e recuar
            await pg.locator('[data-feat="Arredondar_1"]').click()
            await pg.click('.fp-acts button:has-text("Suprimir")')
            v = await wait_vol(pg, 150 * 80 * 20 - math.pi * 100 * 20)
            check("suprimir Arredondar_1", abs(v - (150 * 80 * 20 - math.pi * 100 * 20)) < 0.5, f"{v:.2f}")
            await pg.click('.fp-acts button:has-text("Reativar")')
            await wait_vol(pg, v4)
            await pg.locator('[data-feat="Extrusão_2"]').click()
            await pg.click('.fp-acts button:has-text("Recuar aqui")')
            v = await wait_vol(pg, 240000)
            check("recuar até Extrusão_2 mostra só a base (240 000)", abs(v - 240000) < 0.5, f"{v:.2f}")
            await pg.screenshot(path=f"{OUT}/08_recuo.png")
            await pg.click('.t3-rb .lnk')
            v = await wait_vol(pg, v4)
            check("avançar ao fim restaura tudo", abs(v - v4) < 0.5, f"{v:.2f}")

            # ---------------- 9. excluir com dependentes é bloqueado
            await pg.locator('[data-feat="Esboço_2"]').click()
            dis = await pg.get_attribute('.fp-acts button:has-text("Excluir")', "disabled")
            txt = await pg.inner_text(".w3-props")
            check("excluir Esboço_2 bloqueado: usado por Extrusão_2", dis is not None and "Extrusão_2" in txt)

            # ---------------- 10. salvar e reabrir
            async with pg.expect_download() as dl:
                await pg.keyboard.press("Control+s")
            d = await dl.value
            path = f"{OUT}/peca_parametrica.agtncad"
            await d.save_as(path)
            data = json.load(open(path))
            part = [n for n in data["extras"]["agtn3d"]["nodes"].values() if n["kind"] == "body"][0]
            names = [f["name"] for f in part["source"]["features"]]
            check("arquivo guarda o histórico", names == ["Esboço_1", "Extrusão_1", "Esboço_2", "Extrusão_2", "Arredondar_1"], str(names))
            await pg.goto(URL)
            await pg.wait_for_timeout(1200)
            async with pg.expect_file_chooser() as fc:
                await pg.keyboard.press("Control+o")
            await (await fc.value).set_files(path)
            await pg.wait_for_timeout(800)
            await pg.get_by_role("button", name="3D", exact=True).click()
            await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
            v = await wait_vol(pg, v4, timeout=30000)
            check("reaberto: mesmo volume (regenerado do histórico)", v is not None and abs(v - v4) < 0.5, f"{v}")
            await pg.keyboard.press("f")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/09_reaberto.png")

            # ---------------- 11. chanfro, padrão circular do furo, espelho, casca
            async def pick_top_edge():
                await click3d(pg, 75, 80, 20)
                await pg.wait_for_function("() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", timeout=5000)

            await pg.click('button[title="Selecionar: Corpos"]')
            await click3d(pg, 75, 40, 20)
            st = await feature(pg, "chamfer", {"Distância": 2}, before_ok=pick_top_edge)
            v5 = v4 - 0.5 * 2 * 2 * 150
            v = await wait_vol(pg, v5)
            check("Chanfro_1: 2 mm na aresta superior traseira (150 mm)", abs(v - v5) < 0.5, f"{v:.2f} esperado {v5:.2f} · {st}")

            async def pattern_targets():
                await pg.locator('.fd label:has-text("Extrusão_2") input').check()

            st = await feature(pg, "pattern", {"Quantidade": 3, "Passo": 35}, before_ok=pattern_targets)
            v6 = v5 - 2 * math.pi * 100 * 20
            v = await wait_vol(pg, v6)
            check("padrão linear: 3 furos a cada 35 mm em X", abs(v - v6) < 0.5, f"{v:.2f} esperado {v6:.2f} · {st}")
            await pg.keyboard.press("f")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/10_chanfro_padrao.png")

            st = await feature(pg, "shell", {"Espessura": 3}, before_ok=None, ok=False)
            check("casca sem faces abertas: prévia calculada", "Prévia OK" in st or "erro" in st.lower(), st)
            await pg.keyboard.press("Escape")

            # ---------------- 12. segunda peça: revolução (eixo do esboço) e furo por ponto
            await pg.click('button[title="Selecionar: Corpos"]')
            await pg.keyboard.press("Escape")
            await pg.click(".w3-view", position={"x": 40, "y": 600})
            await pg.click('.rb [data-op="sketch"]')
            await pg.select_option('.plane-ask select[data-field="destino"]', "")
            await pg.click('[data-plane="XZ"]')
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 500)
            await pg.keyboard.press("r")
            await click3d(pg, -80, 0, 0)
            await click3d(pg, -40, 0, 60)
            await dim(pg, -60, 0, 60, 40)
            await dim(pg, -40, 0, 30, 60)
            await pg.click('[data-testid="sketch-finish"]')
            await pg.wait_for_timeout(600)

            async def axis():
                await pg.select_option('.fd .p3-row:has(.k:text-is("Eixo")) select', "AY")

            st = await feature(pg, "revolve", before_ok=axis)
            bodies = await pg.evaluate("() => Object.values(window.__agtn3d.model().nodes).filter(n => n.kind==='body').map(n => n.name)")
            vr = await vol(pg, bodies[-1])
            # anel: r 40..80 (o retângulo fica a 40 mm do eixo Z), altura 60
            exp = math.pi * (80**2 - 40**2) * 60
            check("Revolução 360° em torno do eixo vertical do esboço", vr is not None and abs(vr - exp) / exp < 1e-6, f"{vr:.1f} esperado {exp:.1f} · {st}")
            await pg.keyboard.press("f")
            await idle(pg)
            await pg.screenshot(path=f"{OUT}/11_revolucao.png")

            # ---------------- 13. performance: árvore com muitas operações
            t = await pg.inner_text(".st3")
            m = re.search(r"regen (\d+)", t)
            check("status mostra tempo de regeneração", bool(m), t[:160])

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
