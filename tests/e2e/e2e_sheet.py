"""FASE 4 · ETAPA 1 — Chapa 3D na interface real (Chromium, mouse/teclado reais):
esboço cotado → base de chapa → aba lateral clicando a aresta no modelo → editar (comprimento, θ/α, T) →
flange de contorno → Undo/Redo → alternar Dobrado | Planificado → conferir medidas → enviar ao DESENHO
(camadas de corte/dobra/marcação) → salvar e reabrir (regenera do histórico, mesmo volume e planificação)."""
import asyncio, json, math, os, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
OUT = os.environ.get("E2E_OUT", "tests/output/e2e_sheet")
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


BODY = "Object.values(window.__agtn3d.model().nodes).find(n => n.kind === 'body')"
VOL = f"() => {{ const b = {BODY}; const g = b && window.__agtn3d.vp.geom(b.id); return g ? g.props.volume : null }}"
SHEET = f"() => {{ const b = {BODY}; const s = b && window.__agtn3d.sheets()[b.id]; return s ? {{ volume: s.volume, flatArea: s.flatArea, state: s.flat.state, reasons: s.flat.reasons, w: s.flat.box.maxX - s.flat.box.minX, h: s.flat.box.maxY - s.flat.box.minY, bends: s.flat.bends.map(x => [x.label, x.deflectionDeg, x.includedDeg, x.K, x.kSource]) }} : null }}"
STATES = f"() => {{ const a = window.__agtn3d; const m = a.model(); const b = {BODY}; const st = a.status()[b.id] || []; return st.map(s => [m.nodes[b.id].source.features.find(f => f.id === s.id).name, s.state, s.error || '']) }}"


async def wait_until(pg, js, timeout=15000):
    try:
        await pg.wait_for_function(js, timeout=timeout)
        return True
    except Exception:
        return False


async def consistent(pg):
    """volume exibido (OCCT) = volume do grafo (Σ A·T + Σ θ·T·(R+T/2)·L)"""
    await wait_until(pg, f"() => {{ const v = ({VOL})(); const s = ({SHEET})(); return v !== null && s && Math.abs(v - s.volume) < 1e-6 * Math.max(1, v) }}")
    return await pg.evaluate(VOL), await pg.evaluate(SHEET)


async def dim(pg, x, y, z, value, kind=None):
    await pg.keyboard.press("d")
    await click3d(pg, x, y, z)
    await pg.wait_for_selector('[data-testid="dim-input"]', timeout=4000)
    if kind:
        await pg.select_option(".sk-prompt select", kind)
    await pg.fill('[data-testid="dim-input"]', str(value))
    await pg.keyboard.press("Enter")
    await pg.wait_for_timeout(250)


async def fill(pg, label, v):
    inp = pg.locator(f'.fd .p3-row:has(.k:text-is("{label}")) input').first
    await inp.fill(str(v))
    await inp.press("Tab")


async def ok_dialog(pg):
    await pg.wait_for_timeout(250)
    await pg.wait_for_function("() => !/Calculando/.test(document.querySelector('[data-testid=feature-status]')?.innerText ?? '')", timeout=20000)
    status = await pg.inner_text('[data-testid="feature-status"]')
    await pg.click('[data-testid="feature-ok"]')
    await pg.wait_for_selector(".fd", state="detached", timeout=5000)
    await pg.wait_for_timeout(600)
    return status


def bd(R, K, T, th=90):
    t = math.radians(th)
    return 2 * (R + T) * math.tan(t / 2) - t * (R + K * T)


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
            # ---------------- 1. esboço cotado 100 × 50 no XY
            await pg.click('.rb [data-tab="chapa"]')
            await pg.click('.rb [data-op="sketch"]')
            await pg.click('[data-plane="XY"]')
            await pg.wait_for_selector(".sk-rb")
            await idle(pg, 400)
            await pg.keyboard.press("r")
            await click3d(pg, 0, 0, 0)
            await click3d(pg, 90, 40, 0)
            await dim(pg, 45, 40, 0, 100)
            await dim(pg, 100, 20, 0, 50)
            await pg.click('[data-testid="sketch-finish"]')
            await pg.wait_for_selector(".sk-rb", state="detached")

            # ---------------- 2. base de chapa (T 2, R 2, K da tabela)
            await pg.click('.rb [data-tab="chapa"]')
            await pg.click('.rb [data-op="sheetBase"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetBase"]')
            await fill(pg, "Espessura T", 2)
            st = await ok_dialog(pg)
            v, sh = await consistent(pg)
            check("base de chapa: sólido 100 × 50 × 2 = 10 000 mm³ e planificação válida", v is not None and abs(v - 10000) < 1e-6 and sh and sh["state"] == "valida", f"{v} · {st}")
            await idle(pg)

            # ---------------- 3. aba lateral clicando a aresta y = 0 (face de cima, z = 2)
            await pg.click('.rb [data-op="sheetFlange"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetFlange"]')
            await click3d(pg, 50, 0, 2)
            got = await wait_until(pg, "() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", 6000)
            names = await pg.inner_text('[data-testid="sheet-edges"]') if got else ""
            check("clique na aresta do modelo → aresta de chapa semântica (Base · L…)", got and "Chapa_1 · L" in names, names)
            await fill(pg, "Comprimento", 30)
            st = await ok_dialog(pg)
            v, sh = await consistent(pg)
            K = 0.43  # aço carbono, dobra no ar, R/T = 1 (tabela de partida, origem "estimado")
            V1 = 100 * 46 * 2 + (math.pi / 2) * 2 * 3 * 100 + 26 * 100 * 2
            check("aba 30 mm θ 90°: volume = Σ A·T + θ·T·(R+T/2)·L (1e-6)", v is not None and abs(v - V1) < 1e-6, f"{v:.6f} esperado {V1:.6f}")
            check("K da tabela com origem visível (estimado)", sh and sh["bends"][0][3] == K and sh["bends"][0][4] == "estimado", str(sh and sh["bends"]))
            check("planificação = 50 + 30 − BD", sh and abs(sh["h"] - (80 - bd(2, K, 2))) < 1e-9 and abs(sh["w"] - 100) < 1e-9, f"{sh and sh['h']:.6f}")

            # ---------------- 4. editar: comprimento 45; α 135° → θ 45° (os dois na tela)
            await pg.locator('[data-feat="Aba_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetFlange"]')
            a = pg.locator('.fd [data-field="alpha"] input')
            await a.fill("135")
            await a.press("Tab")
            await pg.wait_for_timeout(300)
            th = await pg.locator('.fd [data-field="theta"] input').input_value()
            check("digitar α = 135° mostra θ = 45° (o modelo guarda só θ)", th.replace(",", ".") in ("45", "45.0"), th)
            t = pg.locator('.fd [data-field="theta"] input')
            await t.fill("90")
            await t.press("Tab")
            await fill(pg, "Comprimento", 45)
            await ok_dialog(pg)
            v, sh = await consistent(pg)
            V2 = 100 * 46 * 2 + (math.pi / 2) * 2 * 3 * 100 + 41 * 100 * 2
            check("editar comprimento → regenera 3D e planificação juntos", v is not None and abs(v - V2) < 1e-6 and abs(sh["h"] - (95 - bd(2, K, 2))) < 1e-9, f"{v:.6f} · {sh['h']:.6f}")

            # ---------------- 5. flange de contorno (U de retorno) na aresta y = 50
            await pg.click('.rb [data-op="sheetContour"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetContour"]')
            await click3d(pg, 50, 50, 2)
            got = await wait_until(pg, "() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", 6000)
            st = await ok_dialog(pg)
            v, sh = await consistent(pg)
            states = await pg.evaluate(STATES)
            exp_h = 50 + 45 + 30 + 15 - 3 * bd(2, K, 2)
            check("flange de contorno 30 + 15: todas ok, volume = grafo, planificação 140 − 3·BD", got and all(s[1] == "ok" for s in states) and abs(sh["h"] - exp_h) < 1e-9, f"{states} · {sh['h']:.6f}")

            # ---------------- 6. Undo / Redo
            await pg.click(".w3-view", position={"x": 300, "y": 760})
            await pg.keyboard.press("Escape")
            await pg.keyboard.press("Control+z")
            ok_u = await wait_until(pg, f"() => {{ const v = ({VOL})(); return v !== null && Math.abs(v - {V2}) < 1e-6 }}")
            await pg.keyboard.press("Control+y")
            ok_r = await wait_until(pg, f"() => {{ const s = ({SHEET})(); return s && Math.abs(s.h - {exp_h}) < 1e-9 }}")
            v, sh2 = await consistent(pg)
            check("Ctrl+Z desfaz o flange; Ctrl+Y refaz com a mesma planificação", ok_u and ok_r and abs(sh2["h"] - exp_h) < 1e-9, f"undo {ok_u} · redo {ok_r} · {sh2['h']:.6f}")

            # ---------------- 7. espessura 3 → tudo regenera, sem inversão
            await pg.locator('[data-feat="Chapa_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetBase"]')
            await fill(pg, "Espessura T", 3)
            await ok_dialog(pg)
            v, sh = await consistent(pg)
            states = await pg.evaluate(STATES)
            check("T 3 mm: todas as operações ok e volume = grafo", all(s[1] == "ok" for s in states) and sh is not None, f"{states}")
            await pg.locator('[data-feat="Chapa_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetBase"]')
            await fill(pg, "Espessura T", 2)
            await ok_dialog(pg)
            v, sh = await consistent(pg)

            # ---------------- 8. Dobrado | Planificado + painel
            bid = await pg.evaluate(f"() => {BODY}.id")
            await pg.click(f'.t3-row[data-node="{bid}"] .t3-name')
            await pg.wait_for_timeout(300)
            await pg.click('.rb [data-op="sheetFlat"]')
            ok_f = await wait_until(pg, "() => window.__agtn3d.vp.flatBody !== null", 10000)
            await pg.keyboard.press("f")
            await idle(pg, 500)
            await pg.screenshot(path=f"{OUT}/01_planificado.png")
            panel = await pg.inner_text('[data-testid="sheet-panel"]')
            blank = await pg.inner_text('[data-testid="flat-blank"]')
            w = f"{100:.0f}"
            check("Planificado: sólido do mesmo grafo exibido no lugar do dobrado", ok_f, "")
            check("painel: planificação válida, blank 100 × 140 − 3·BD, tabela de dobras", "válida" in panel and blank.startswith(w) and "D3" in panel, blank)
            await pg.click('.rb [data-op="sheetFlat"]')
            back = await wait_until(pg, "() => window.__agtn3d.vp.flatBody === null", 5000)
            await idle(pg, 400)
            await pg.screenshot(path=f"{OUT}/02_dobrado.png")
            check("volta ao Dobrado", back, "")

            # ---------------- 9. salvar e reabrir
            async with pg.expect_download() as dl:
                await pg.keyboard.press("Control+s")
            d = await dl.value
            path = f"{OUT}/chapa.agtncad"
            await d.save_as(path)
            data = json.load(open(path))
            part = [n for n in data["extras"]["agtn3d"]["nodes"].values() if n["kind"] == "body"][0]
            kinds = [f["t"] for f in part["source"]["features"]]
            check("arquivo guarda só o histórico (sem geometria pronta)", kinds == ["sketch", "sheetBase", "sheetFlange", "sheetContour"], str(kinds))
            vsaved, shsaved = v, sh
            await pg.goto(URL)
            await pg.wait_for_timeout(1200)
            async with pg.expect_file_chooser() as fc:
                await pg.keyboard.press("Control+o")
            await (await fc.value).set_files(path)
            await pg.wait_for_timeout(800)
            await pg.get_by_role("button", name="3D", exact=True).click()
            await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
            v, sh = await consistent(pg)
            check("reaberto: mesmo volume e mesma planificação (regenerados)", v is not None and abs(v - vsaved) < 1e-9 and sh["h"] == shsaved["h"] and sh["flatArea"] == shsaved["flatArea"], f"{v} · {sh and sh['h']}")

            # ---------------- 10. enviar ao DESENHO
            await pg.click('.rb [data-tab="chapa"]')
            bid = await pg.evaluate(f"() => {BODY}.id")
            await pg.click(f'.t3-row[data-node="{bid}"] .t3-name')
            await pg.click('.rb [data-op="sheetSend"]')
            await pg.wait_for_timeout(900)
            await pg.keyboard.type("0,0")
            await pg.keyboard.press("Enter")
            await pg.wait_for_timeout(800)
            layers = await pg.evaluate("() => { const all = window.__agtn3d.doc.all(); const c = {}; for (const e of all) c[e.layer] = (c[e.layer] || 0) + 1; return c }")
            marks = await pg.evaluate("() => window.__agtn3d.doc.all().filter(e => e.layer === 'MARCACAO').map(e => e.value)")
            check("DESENHO recebe contorno, 3 linhas de dobra, 6 limites e marcação D1…D3", layers.get("CONTORNO_CORTE", 0) == 1 and layers.get("LINHAS_DOBRA", 0) == 3 and layers.get("REGIAO_DOBRA", 0) == 6 and len(marks) == 3, f"{layers} {marks}")
            check("marcação no padrão do 2D", all(m.startswith(f"D{i + 1} CIMA 90,0° RI2,00") for i, m in enumerate(marks)), str(marks))
            await pg.screenshot(path=f"{OUT}/03_desenho.png")
        except Exception:
            await pg.screenshot(path=f"{OUT}/zz_falha.png")
            raise
        check("sem erros de página", not errors, "; ".join(errors[:3]))
        await b.close()
    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)}/{len(results)} verificações OK")
    json.dump([{"teste": n, "ok": o, "detalhe": d} for n, o, d in results], open(f"{OUT}/resultado.json", "w"), ensure_ascii=False, indent=1)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    asyncio.run(main())
