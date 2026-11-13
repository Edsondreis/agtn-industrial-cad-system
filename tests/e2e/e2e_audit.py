"""Auditoria FASE 3 — A07 integridade da interface (Chromium, mouse/teclado reais):
- operação que falha: árvore, faixa de aviso, propriedades e volume dizem a verdade (último sólido válido);
- dependentes aparecem como "não avaliados", nunca como válidos; corrigir (Ctrl+Z) recupera a cadeia;
- prévia e cancelamento não alteram o documento nem deixam resíduos (malha, seta, filtro, histórico);
- regeneração atualiza propriedades; Undo/Redo coerentes; alternância 2D/3D preserva tudo."""
import asyncio, json, math, os, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
OUT = os.environ.get("E2E_OUT", "tests/output/e2e_audit")
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


VOL = "() => { const a = window.__agtn3d; const b = Object.values(a.model().nodes).find(n => n.kind === 'body'); const g = b && a.vp.geom(b.id); return g ? g.props.volume : null }"
STATES = "() => { const a = window.__agtn3d; const m = a.model(); const b = Object.values(m.nodes).find(n => n.kind === 'body'); const st = a.status()[b.id] || []; return st.map(s => [m.nodes[b.id].source.features.find(f => f.id === s.id).name, s.state]) }"


async def wait_vol(pg, expect, tol=0.5, timeout=15000):
    try:
        await pg.wait_for_function(f"() => {{ const v = ({VOL})(); return v !== null && Math.abs(v - {expect}) < {tol} }}", timeout=timeout)
    except Exception:
        pass
    return await pg.evaluate(VOL)


async def dim(pg, x, y, z, value, kind=None):
    await pg.keyboard.press("d")
    await click3d(pg, x, y, z)
    await pg.wait_for_selector('[data-testid="dim-input"]', timeout=4000)
    if kind:
        await pg.select_option(".sk-prompt select", kind)
    await pg.fill('[data-testid="dim-input"]', str(value))
    await pg.keyboard.press("Enter")
    await pg.wait_for_timeout(250)


async def feature(pg, op, fields=None, before_ok=None):
    await pg.click(f'.rb [data-op="{op}"]')
    await pg.wait_for_selector(".fd", timeout=5000)
    for label, v in (fields or {}).items():
        inp = pg.locator(f'.fd .p3-row:has(.k:text-is("{label}")) input').first
        await inp.fill(str(v))
        await inp.press("Tab")
    if before_ok:
        await before_ok()
    await pg.wait_for_timeout(200)
    await pg.wait_for_function("() => !/Calculando/.test(document.querySelector('[data-testid=feature-status]')?.innerText ?? '')", timeout=20000)
    await pg.click('[data-testid="feature-ok"]')
    await pg.wait_for_selector(".fd", state="detached", timeout=5000)
    await pg.wait_for_timeout(500)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = await b.new_context(viewport={"width": 1600, "height": 950})
        pg = await ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        await pg.get_by_text("Modelo 3D", exact=True).first.click()
        await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
        try:
            # peça: base 120×80×20 + arredondamento R5 + ressalto Ø20×10 em cima
            await pg.click('.rb [data-op="sketch"]')
            await pg.click('[data-plane="XY"]')
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 400)
            await pg.keyboard.press("r")
            await click3d(pg, 0, 0, 0)
            await click3d(pg, 100, 60, 0)
            await dim(pg, 50, 60, 0, 120)
            await dim(pg, 120, 30, 0, 80)
            await pg.click('[data-testid="sketch-finish"]')
            await pg.wait_for_selector(".sk-rb", state="detached")
            await feature(pg, "extrude", {"Profundidade": 20})
            await idle(pg)

            async def edge0():
                await click3d(pg, 120, 0, 10)
                await pg.wait_for_function("() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", timeout=5000)

            await feature(pg, "fillet", {"Raio": 5}, before_ok=edge0)
            await pg.click('.rb [data-op="sketch"]')
            await pg.wait_for_selector(".plane-ask")
            await pg.fill(".plane-ask .unit-in input", "20")
            await pg.click('[data-plane="XY"]')
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 400)
            await pg.keyboard.press("c")
            await click3d(pg, 60, 40, 20)
            await click3d(pg, 70, 40, 20)
            await dim(pg, 70, 40, 20, 20, kind="diameter")
            await pg.click('[data-testid="sketch-finish"]')
            await pg.wait_for_selector(".sk-rb", state="detached")
            await feature(pg, "extrude", {"Profundidade": 10})
            fil = (25 - math.pi * 25 / 4) * 20
            vfull = 120 * 80 * 20 - fil + math.pi * 100 * 10
            v = await wait_vol(pg, vfull)
            st = await pg.evaluate(STATES)
            check("peça base: todas as operações ok", all(s == "ok" for _, s in st) and abs(v - vfull) < 0.5, f"{st} · {v:.2f}")

            # ---------------- prévia e cancelamento não mexem no documento
            before = await pg.evaluate("() => JSON.stringify(window.__agtn3d.model())")
            undo0 = await pg.evaluate("() => window.__agtn3d.doc.undoLabel")
            filt0 = await pg.evaluate("() => window.__agtn3d.store.snap.filter")
            await pg.click('.rb [data-op="extrude"]')
            await pg.wait_for_selector(".fd")
            inp = pg.locator('.fd .p3-row:has(.k:text-is("Profundidade")) input').first
            await inp.fill("55")
            await inp.press("Tab")
            await pg.wait_for_timeout(800)
            during = await pg.evaluate("() => JSON.stringify(window.__agtn3d.model())")
            await pg.keyboard.press("Escape")
            await pg.wait_for_selector(".fd", state="detached")
            await pg.wait_for_timeout(400)
            after = await pg.evaluate("() => JSON.stringify(window.__agtn3d.model())")
            undo1 = await pg.evaluate("() => window.__agtn3d.doc.undoLabel")
            res = await pg.evaluate("() => ({ handle: !!document.querySelector('.v3-handle'), multi: window.__agtn3d.store.snap.multi, filter: window.__agtn3d.store.snap.filter })")
            v = await pg.evaluate(VOL)
            check("prévia não altera o documento (antes = durante = depois) e não entra no histórico", before == during == after and undo0 == undo1, f"undo: {undo0} → {undo1}")
            check("cancelar não deixa resíduo (seta, escolha múltipla, filtro, malha da prévia)", not res["handle"] and not res["multi"] and res["filter"] == filt0 and abs(v - vfull) < 0.5, f"{res} · {v:.2f}")

            # ---------------- falha intermediária: a base vira círculo → o arredondamento perde a aresta
            await pg.locator('[data-feat="Esboço_1"]').dblclick()
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 400)
            for x, y in [(60, 0), (60, 80), (0, 40), (120, 40)]:
                await click3d(pg, x, y, 0, mod="Control")
            await pg.keyboard.press("Delete")
            await pg.keyboard.press("c")
            await click3d(pg, 60, 40, 0)
            await click3d(pg, 100, 40, 0)
            await dim(pg, 100, 40, 0, 80, kind="diameter")
            await pg.click('[data-testid="sketch-finish"]')
            await pg.wait_for_selector(".sk-rb", state="detached")
            vlast = math.pi * 1600 * 20  # último sólido válido: só a base cilíndrica
            v = await wait_vol(pg, vlast)
            await idle(pg)
            st = dict(await pg.evaluate(STATES))
            check("árvore: Arredondar_1 = erro; Extrusão_2 (depois) = não avaliada — nenhum dependente 'ok'", st.get("Arredondar_1") == "error" and st.get("Extrusão_2") == "dependency_error" and st.get("Esboço_2") == "ok", str(st))
            rows = await pg.evaluate("() => ({ err: !!document.querySelector('[data-feat=\"Arredondar_1\"].error'), dep: !!document.querySelector('[data-feat=\"Extrusão_2\"].dependency_error') })")
            check("árvore desenha os dois estados de forma distinta", rows["err"] and rows["dep"], str(rows))
            banner = await pg.locator('[data-testid="partial-banner"]').inner_text() if await pg.locator('[data-testid="partial-banner"]').count() else ""
            check("viewport avisa que mostra o último sólido válido", "Arredondar_1" in banner and "último sólido válido" in banner, banner)
            check("volume exibido = último sólido válido (cilindro Ø80×20), não um resultado misto", abs(v - vlast) < 0.5, f"{v:.2f} esperado {vlast:.2f}")
            bid = await pg.evaluate("() => Object.values(window.__agtn3d.model().nodes).find(n => n.kind === 'body').id")
            await pg.click(f'.t3-row[data-node="{bid}"] .t3-name')
            await pg.wait_for_timeout(300)
            note = await pg.locator('[data-testid="partial-note"]').inner_text() if await pg.locator('[data-testid="partial-note"]').count() else ""
            check("propriedades físicas avisam que os valores são do último sólido válido", "Arredondar_1" in note, note[:120])
            await pg.locator('[data-feat="Extrusão_2"]').click()
            props = await pg.inner_text(".w3-props")
            check("propriedades da operação dependente: 'não avaliada' + causa", "Não avaliada" in props and "Arredondar_1" in props, props[:200].replace("\n", " "))
            await pg.screenshot(path=f"{OUT}/01_falha_intermediaria.png")

            # ---------------- corrigir (Ctrl+Z) → cadeia toda regenerada
            await pg.click(".w3-view", position={"x": 300, "y": 700})
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("Control+z")
            v = await wait_vol(pg, vfull)
            await pg.wait_for_timeout(500)
            st = await pg.evaluate(STATES)
            nb = await pg.locator('[data-testid="partial-banner"]').count()
            check("Ctrl+Z corrige: todas ok, aviso some, volume completo", all(s == "ok" for _, s in st) and nb == 0 and abs(v - vfull) < 0.5, f"{st} · banner {nb} · {v:.2f}")
            await pg.keyboard.press("Control+y")
            v = await wait_vol(pg, vlast)
            st = dict(await pg.evaluate(STATES))
            check("Ctrl+Y refaz a falha com os mesmos estados", st.get("Extrusão_2") == "dependency_error" and abs(v - vlast) < 0.5, str(st))
            await pg.keyboard.press("Control+z")
            await wait_vol(pg, vfull)

            # ---------------- regeneração atualiza propriedades
            await pg.click(f'.t3-row[data-node="{bid}"] .t3-name')
            await pg.wait_for_timeout(300)
            txt0 = await pg.inner_text(".w3-props")
            await pg.locator('[data-feat="Extrusão_1"]').dblclick()
            await pg.wait_for_selector(".fd")
            inp = pg.locator('.fd .p3-row:has(.k:text-is("Profundidade")) input').first
            await inp.fill("30")
            await inp.press("Tab")
            await pg.wait_for_function("() => /Prévia OK/.test(document.querySelector('[data-testid=feature-status]')?.innerText ?? '')", timeout=15000)
            await pg.click('[data-testid="feature-ok"]')
            await pg.wait_for_selector(".fd", state="detached")
            v30 = 120 * 80 * 30 - (25 - math.pi * 25 / 4) * 30 + math.pi * 100 * 10
            v = await wait_vol(pg, v30)
            await pg.click(f'.t3-row[data-node="{bid}"] .t3-name')
            await pg.wait_for_timeout(400)
            txt1 = await pg.inner_text(".w3-props")
            check("editar a profundidade: volume e propriedades atualizam (ressalto acompanha o topo? não — plano fixo em z=20, fica embutido)", abs(v - (v30 - math.pi * 100 * 10)) < 0.5 or abs(v - v30) < 0.5, f"{v:.2f}")
            check("painel de propriedades mostra o valor novo (não o antigo)", txt0 != txt1, "")

            # ---------------- alternar 2D ↔ 3D preserva modelo e estados
            m0 = await pg.evaluate("() => JSON.stringify(window.__agtn3d.model())")
            await pg.get_by_role("button", name="DESENHO", exact=True).click()
            await pg.wait_for_timeout(800)
            await pg.get_by_role("button", name="3D", exact=True).click()
            await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
            v2 = await wait_vol(pg, v)
            m1 = await pg.evaluate("() => JSON.stringify(window.__agtn3d.model())")
            check("2D → 3D: mesmo modelo e mesmo volume", m0 == m1 and abs(v2 - v) < 1e-6, f"{v2:.3f}")
            await pg.screenshot(path=f"{OUT}/02_apos_correcao.png")
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
