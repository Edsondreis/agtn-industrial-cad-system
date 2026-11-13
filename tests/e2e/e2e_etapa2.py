"""FASE 4 · ETAPA 2 — recursos de chapa na interface real (Chromium, mouse/teclado reais).
Cresce a cada entrega: 2.1 recuos + alívio de dobra … Cada verificação confere o núcleo (grafo e OCCT), não só a tela."""
import asyncio, json, math, os, sys
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(__file__))
from e2e_sheet import BODY, SHEET, STATES, VOL, click3d, consistent, dim, fill, idle, ok_dialog, wait_until  # noqa: E402

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
OUT = os.environ.get("E2E_OUT", "tests/output/e2e_etapa2")
os.makedirs(OUT, exist_ok=True)
results = []
K = 0.43
BA = (math.pi / 2) * (2 + K * 2)
WARN = f"() => {{ const a = window.__agtn3d; const m = a.model(); const b = {BODY}; return (a.status()[b.id] || []).map(s => [m.nodes[b.id].source.features.find(f => f.id === s.id).name, s.warning || '']) }}"
RELIEF = f"() => {{ const b = {BODY}; const s = window.__agtn3d.sheets()[b.id]; return s ? {{ base: s.flanges[0].area, flat: s.flatArea, state: s.flat.state, bends: s.flat.bends.map(x => [x.partial, x.relief ? [x.relief.kind, x.relief.w, x.relief.d, x.relief.ends] : null]), bulges: s.flat.cutBulges[0].filter(q => q !== 0).length }} : null }}"


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


async def num(pg, field, v):
    inp = pg.locator(f'.fd [data-field="{field}"] input').first
    await inp.fill(str(v))
    await inp.press("Tab")


async def shot(pg, name, flat=False):
    bid = await pg.evaluate(f"() => {BODY}.id")
    if flat:
        await pg.click(f'.t3-row[data-node="{bid}"] .t3-name')
        await pg.click('.rb [data-op="sheetFlat"]')
        await wait_until(pg, "() => window.__agtn3d.vp.flatBody !== null", 10000)
    await pg.keyboard.press("f")
    await idle(pg, 500)
    await pg.screenshot(path=f"{OUT}/{name}.png")
    if flat:
        await pg.click('.rb [data-op="sheetFlat"]')
        await wait_until(pg, "() => window.__agtn3d.vp.flatBody === null", 5000)
        await idle(pg, 300)


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
            # ---------------- esboço 100 × 50, base T 2
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
            await pg.click('.rb [data-tab="chapa"]')
            await pg.click('.rb [data-op="sheetBase"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetBase"]')
            await fill(pg, "Espessura T", 2)
            await ok_dialog(pg)
            await consistent(pg)
            await idle(pg)

            # ---------------- 2.1a aba com recuos 20 / 30 (faixa 20…70 da aresta y = 0)
            await pg.click('.rb [data-op="sheetFlange"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetFlange"]')
            await click3d(pg, 50, 0, 2)
            await wait_until(pg, "() => document.querySelector('[data-testid=pick-count]')?.textContent === '1'", 6000)
            await fill(pg, "Comprimento", 30)
            await num(pg, "offsetStart", 20)
            await num(pg, "offsetEnd", 30)
            note = await pg.locator(".fd .fd-note", has_text="rasgo").first.inner_text()
            st = await ok_dialog(pg)
            v, sh = await consistent(pg)
            r = await pg.evaluate(RELIEF)
            V = (100 * 50 - 4 * 50) * 2 + (math.pi / 2) * 2 * 3 * 50 + 26 * 50 * 2
            check("2.1a aba parcial 50 mm (recuos 20/30): volume = grafo = fórmula, dobra marcada parcial", v is not None and abs(v - V) < 1e-6 and r["bends"][0][0] is True, f"{v:.6f} esperado {V:.6f} · {r['bends']}")
            check("2.1a sem alívio: aviso de risco de rasgo na tela", "alívio" in note.lower(), note)
            await shot(pg, "01_aba_parcial_dobrado")

            # ---------------- 2.1b alívio retangular automático nas duas pontas
            await pg.click('.rb [data-op="sheetRelief"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetRelief"]')
            await pg.locator(".fd [data-bend] input").first.check()
            st = await ok_dialog(pg)
            v, sh = await consistent(pg)
            r = await pg.evaluate(RELIEF)
            w, d = 2.5, 4.5
            check("2.1b alívio retangular: w = T + g = 2,5 · d = SB + g = 4,5 nas duas pontas", r["bends"][0][1] and abs(r["bends"][0][1][1] - w) < 1e-12 and abs(r["bends"][0][1][2] - d) < 1e-12 and r["bends"][0][1][3] == ["inicio", "fim"], str(r["bends"]))
            check("2.1b área da base = 5000 − SB·50 − 2·w·d; sólido OCCT = grafo; planificação válida", abs(r["base"] - (4800 - 2 * w * d)) < 1e-9 and r["state"] == "valida" and v is not None, f"{r['base']} · {r['state']} · {v}")
            warns = await pg.evaluate(WARN)
            check("2.1b aviso de rasgo some da Aba_1 depois do Alívio (fica só o aviso de K estimado)", not any("alívio" in w for _, w in warns) and "estimado" in dict(warns)["Aba_1"], str(warns))
            await shot(pg, "02_alivio_retangular_dobrado")
            await shot(pg, "03_alivio_retangular_planificado", flat=True)

            # ---------------- trocar para oblongo editando a operação
            await pg.locator('[data-feat="Alívio_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetRelief"]')
            await pg.click('.fd [data-kind="oblongo"]')
            await ok_dialog(pg)
            v, sh = await consistent(pg)
            r = await pg.evaluate(RELIEF)
            d2 = 4.5 + w / 2
            rem = w * (d2 - w / 2) + math.pi * (w / 2) ** 2 / 2
            check("2.1b oblongo: 2 arcos exatos no corte, área = 4800 − 2·[w(d − w/2) + π(w/2)²/2]", r["bulges"] == 2 and abs(r["base"] - (4800 - 2 * rem)) < 1e-9 and r["state"] == "valida", f"{r['base']} · arcos {r['bulges']}")
            await shot(pg, "04_alivio_oblongo_planificado", flat=True)

            # ---------------- T 3 → alívio recalculado (w = 3,5)
            await pg.locator('[data-feat="Chapa_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetBase"]')
            await fill(pg, "Espessura T", 3)
            await ok_dialog(pg)
            v, sh = await consistent(pg)
            r = await pg.evaluate(RELIEF)
            states = await pg.evaluate(STATES)
            check("T 3 mm: alívio recalculado w = 3,5; todas ok; sólido = grafo", all(s[1] == "ok" for s in states) and abs(r["bends"][0][1][1] - 3.5) < 1e-12 and v is not None, f"{states} · {r['bends']}")

            # ---------------- salvar / reabrir
            async with pg.expect_download() as dl:
                await pg.keyboard.press("Control+s")
            path = f"{OUT}/etapa2.agtncad"
            await (await dl.value).save_as(path)
            data = json.load(open(path))
            part = [n for n in data["extras"]["agtn3d"]["nodes"].values() if n["kind"] == "body"][0]
            feats = part["source"]["features"]
            kinds = [f["t"] for f in feats]
            fl = [f for f in feats if f["t"] == "sheetFlange"][0]
            check("arquivo: histórico com sheetRelief e recuos da aba", kinds == ["sketch", "sheetBase", "sheetFlange", "sheetRelief"] and fl.get("offsetStart") == 20 and fl.get("offsetEnd") == 30, str(kinds))
            rsaved = r
            await pg.goto(URL)
            await pg.wait_for_timeout(1200)
            async with pg.expect_file_chooser() as fc:
                await pg.keyboard.press("Control+o")
            await (await fc.value).set_files(path)
            await pg.wait_for_timeout(800)
            await pg.get_by_role("button", name="3D", exact=True).click()
            await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
            v, sh = await consistent(pg)
            r = await pg.evaluate(RELIEF)
            check("reaberto: mesmo alívio, mesma área, sólido = grafo", r == rsaved and v is not None, f"{r['base']}")

            # ---------------- 2.2 aba de borda: duas arestas (Ctrl+clique), material por fora, canto detectado
            await pg.goto(URL)
            await pg.wait_for_timeout(1200)
            await pg.get_by_text("Modelo 3D", exact=True).first.click()
            await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
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
            await pg.click('.rb [data-tab="chapa"]')
            await pg.click('.rb [data-op="sheetBase"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetBase"]')
            await fill(pg, "Espessura T", 2)
            await ok_dialog(pg)
            await consistent(pg)
            await idle(pg)
            await pg.click('.rb [data-op="sheetFlange"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetFlange"]')
            await click3d(pg, 50, 0, 2)
            await click3d(pg, 100, 25, 2, "Control")
            two = await wait_until(pg, "() => document.querySelector('[data-testid=pick-count]')?.textContent === '2'", 6000)
            await fill(pg, "Comprimento", 30)
            await pg.select_option('.fd select[data-field="position"]', "fora")
            note = await pg.locator(".fd .fd-note", has_text="cantos").count()
            await ok_dialog(pg)
            v, sh = await consistent(pg)
            r = await pg.evaluate(RELIEF)
            bid = await pg.evaluate(f"() => {BODY}.id")
            await pg.click(f'.t3-row[data-node="{bid}"] .t3-name')
            await pg.wait_for_timeout(300)
            corners = await pg.inner_text('[data-testid="sheet-corners"]') if await pg.locator('[data-testid="sheet-corners"]').count() else ""
            cids = await pg.evaluate(f"() => window.__agtn3d.sheets()[{BODY}.id].corners.map(c => c.id + ' ' + c.angleDeg)")
            # δ = T: a pai cresce T nas duas arestas e recua SB = 4 → base (100 + 2 − 4) × (50 + 2 − 4)
            check("2.2 duas arestas por Ctrl+clique, aviso de canto na operação", two and note == 1, f"{two} · {note}")
            check("2.2 material por fora: base = (100 + T − SB)·(50 + T − SB) = 4704; sólido = grafo; planificação válida", abs(r["base"] - 98 * 48) < 1e-9 and r["state"] == "valida" and v is not None, f"{r['base']} · {r['state']}")
            check("2.2 canto entre as duas abas detectado no núcleo e mostrado no painel (aberto, 90°)", corners.startswith("1 aberto") and len(cids) == 1 and cids[0].endswith(" 90"), f"{corners} · {cids}")
            await shot(pg, "05_aba_borda_fora_dobrado")
            await shot(pg, "06_aba_borda_fora_planificado", flat=True)
            await pg.locator('[data-feat="Aba_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetFlange"]')
            await pg.select_option('.fd select[data-field="position"]', "dobra_fora")
            await ok_dialog(pg)
            v, sh = await consistent(pg)
            r = await pg.evaluate(RELIEF)
            check("2.2 dobra por fora: a base fica inteira (5000), a dobra começa na aresta; sólido = grafo", abs(r["base"] - 5000) < 1e-9 and r["state"] == "valida" and v is not None, f"{r['base']}")

            # ---------------- 2.3 fechamento de canto: encosto → esquadria, recalculado ao mudar a altura
            await pg.locator('[data-feat="Aba_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetFlange"]')
            await pg.select_option('.fd select[data-field="position"]', "dentro")
            await ok_dialog(pg)
            await consistent(pg)
            await pg.click('.rb [data-op="sheetCorner"]')
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetCorner"]')
            await pg.click('.fd [data-corner-kind="encosto"]')
            await pg.locator(".fd [data-corner] input").first.check()
            st = await ok_dialog(pg)
            v, sh = await consistent(pg)
            CORN = f"() => {{ const b = {BODY}; const s = window.__agtn3d.sheets()[b.id]; return s ? s.corners.map(c => c.kind) : null }}"
            ks = await pg.evaluate(CORN)
            r = await pg.evaluate(RELIEF)
            areas = await pg.evaluate(f"() => window.__agtn3d.sheets()[{BODY}.id].flanges.map(f => f.area)")
            # 90°, T 2, R 2, g 0,5: a que fecha (1ª) avança SB = 4; a outra SB − T − g = 1,5 → áreas (96 + 4)·26 e (46 + 1,5)·26
            check("2.3 encosto: as duas abas avançam até os planos (4 e 1,5 mm) — áreas exatas; sólido OCCT = grafo sem interferência", ks == ["encosto"] and abs(areas[1] - 100 * 26) < 1e-9 and abs(areas[2] - 47.5 * 26) < 1e-9 and v is not None and r["state"] == "valida", f"{ks} · {areas} · {st}")
            await shot(pg, "07_canto_encosto_dobrado")
            await shot(pg, "08_canto_encosto_planificado", flat=True)
            await pg.locator('[data-feat="Canto_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetCorner"]')
            await pg.click('.fd [data-corner-kind="esquadria"]')
            await ok_dialog(pg)
            v, sh = await consistent(pg)
            areas = await pg.evaluate(f"() => window.__agtn3d.sheets()[{BODY}.id].flanges.map(f => f.area)")
            # esquadria (fibra interna, g/2 cada): cada aba avança SB − T − g/2 = 1,75
            check("2.3 esquadria: cada aba avança SB − T − g/2 = 1,75 mm; sólido = grafo", abs(areas[1] - 97.75 * 26) < 1e-9 and abs(areas[2] - 47.75 * 26) < 1e-9 and v is not None, f"{areas}")
            await shot(pg, "09_canto_esquadria_dobrado")
            await pg.locator('[data-feat="Aba_1"]').dblclick()
            await pg.wait_for_selector('.fd[data-feature-dialog="sheetFlange"]')
            await fill(pg, "Comprimento", 40)
            await ok_dialog(pg)
            v, sh = await consistent(pg)
            areas = await pg.evaluate(f"() => window.__agtn3d.sheets()[{BODY}.id].flanges.map(f => f.area)")
            states = await pg.evaluate(STATES)
            check("2.3 altura 40: canto recalculado do histórico (áreas ·36), todas ok", all(s[1] == "ok" for s in states) and abs(areas[1] - 97.75 * 36) < 1e-9 and v is not None, f"{states} · {areas}")
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
