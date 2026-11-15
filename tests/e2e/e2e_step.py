"""FASE 5 — STEP aberto como documento (somente leitura) e DXF: uso real no Chromium (motor do WebView2).

Pré-requisitos: `npm run dev` (http://localhost:1420) e os arquivos grandes gerados por
`npx vitest run core/model3d/src/stepdoc.test.ts` (tests/output/step/).
"""
import asyncio, json, os, re, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
OUT = os.environ.get("E2E_OUT", "tests/output/e2e_step")
REF = "tests/step/viewer_ref/"
BIG = "tests/output/step/"
os.makedirs(OUT, exist_ok=True)
results = []
metrics = {}


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


def num(s):
    """'100.000,000 mm³' → 100000.0"""
    m = re.search(r"-?[\d.]+,\d+|-?\d+(?:,\d+)?(?:e[+-]?\d+)?", s.replace(" ", " "))
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else float("nan")


async def workers(cdp):
    t = await cdp.send("Target.getTargets")
    return sum(1 for x in t["targetInfos"] if x["type"] == "worker")


async def open_file(pg, path, timeout=120000):
    async with pg.expect_file_chooser() as fc:
        await pg.keyboard.press("Control+o")
    await (await fc.value).set_files(path)
    await pg.wait_for_selector('[data-testid="step-viewer"]', timeout=20000)
    await pg.wait_for_function("() => window.__agtnStep && (window.__agtnStep.phase === 'pronto' || window.__agtnStep.phase === 'falha')", timeout=timeout)
    await pg.wait_for_timeout(400)
    return await pg.evaluate("() => ({ phase: window.__agtnStep.phase, error: window.__agtnStep.error, summary: window.__agtnStep.summary, scan: window.__agtnStep.scan, ms: window.__agtnStep.ms, invalid: window.__agtnStep.invalid })")


async def close_step(pg):
    await pg.click('[data-testid="step-close"]')
    await pg.wait_for_selector('[data-testid="step-viewer"]', state="detached", timeout=10000)
    await pg.wait_for_timeout(300)


async def main():
    refs = json.load(open(REF + "reference.json"))
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--js-flags=--expose-gc"])
        ctx = await b.new_context(viewport={"width": 1600, "height": 900})
        pg = await ctx.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        csp = []
        pg.on("console", lambda m: ("Content Security Policy" in m.text or "unsafe-eval" in m.text) and csp.append(m.text))
        cdp = await ctx.new_cdp_session(pg)
        await pg.goto(URL)
        await pg.evaluate("() => localStorage.setItem('agtn.e2e', '1')")
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)

        # ---------------------------------------------------------------- desenho 2D antes (deve ficar intacto)
        await pg.keyboard.press("Control+n")
        await pg.wait_for_timeout(500)
        cmd = pg.locator(".cmdline input")
        await cmd.fill("LINE")
        await cmd.press("Enter")
        for pt in ["0,0", "100,0", "100,50"]:
            await cmd.fill(pt)
            await cmd.press("Enter")
        await cmd.press("Escape")
        await pg.wait_for_timeout(300)
        ents_before = await pg.evaluate("() => [window.__agtn2d.size(), window.__agtn2d.file().name]")
        w0 = await workers(cdp)

        # ---------------------------------------------------------------- 1. caixa 100×50×20 (mm)
        r = await open_file(pg, REF + "box_100x50x20.step")
        s = r["summary"]
        check("STEP abre como documento: estado 'Arquivo pronto'", r["phase"] == "pronto", r["error"] or "")
        check("caixa: 1 sólido, volume 100 000 mm³ (B-rep)", s and s["solids"] == 1 and abs(s["volume"] - 100000) < 1e-3, json.dumps(s and {k: s[k] for k in ("solids", "volume", "faces")}))
        ui_vol = await pg.inner_text('[data-testid="step-volume"]')
        check("painel mostra o volume em mm³", abs(num(ui_vol) - 100000) < 0.01 and "mm³" in ui_vol, ui_vol)
        check("unidade do arquivo: mm", (await pg.inner_text('[data-testid="step-file-unit"]')).startswith("mm"))
        check("aba STEP aparece só com documento aberto", await pg.locator('[data-testid="ws-step"]').count() == 1)
        w1 = await workers(cdp)
        check("motor próprio do documento (worker separado)", w1 >= w0 + 1, f"workers {w0} → {w1}")
        bb = s["bbox"]
        check("caixa delimitadora 100 × 50 × 20", abs(bb["max"]["x"] - bb["min"]["x"] - 100) < 0.01 and abs(bb["max"]["y"] - bb["min"]["y"] - 50) < 0.01 and abs(bb["max"]["z"] - bb["min"]["z"] - 20) < 0.01)
        await pg.screenshot(path=f"{OUT}/01_caixa_iso.png")

        # vistas padrão, ajuste, sólido/arame
        views_ok = []
        for k in ["frente", "tras", "superior", "inferior", "esquerda", "direita", "iso"]:
            await pg.evaluate(f"() => window.__agtnStep.view('{k}')")
            await pg.wait_for_timeout(450)
            v = await pg.evaluate("() => document.querySelector('.rb-view.on')?.textContent ?? ''")
            views_ok.append((k, v))
        check("7 vistas padrão (frente, trás, superior, inferior, esquerda, direita, iso)", all(v for _, v in views_ok), str(views_ok))
        cam1 = await pg.evaluate("() => { const c = window.__agtnStep.cam(); return c.height }")
        await pg.mouse.move(800, 450)
        for _ in range(5):
            await pg.mouse.wheel(0, -300)
            await pg.wait_for_timeout(60)
        await pg.wait_for_timeout(400)
        cam2 = await pg.evaluate("() => window.__agtnStep.cam().height")
        check("zoom pela roda do mouse", cam2 < cam1, f"{cam1:.1f} → {cam2:.1f}")
        q1 = await pg.evaluate("() => { const c = window.__agtnStep.cam(); return [c.dir.x, c.dir.y, c.dir.z] }")
        await pg.mouse.move(700, 450)
        await pg.mouse.down()
        await pg.mouse.move(820, 400, steps=8)
        await pg.mouse.up()
        await pg.wait_for_timeout(300)
        q2 = await pg.evaluate("() => { const c = window.__agtnStep.cam(); return [c.dir.x, c.dir.y, c.dir.z] }")
        check("rotação arrastando o mouse", q1 != q2, f"{q1} → {q2}")
        await pg.click('[data-testid="step-fit"]')
        await pg.wait_for_timeout(500)
        cam3 = await pg.evaluate("() => window.__agtnStep.cam().height")
        check("Ajustar enquadra de novo", cam3 > cam2, f"{cam2:.1f} → {cam3:.1f}")
        await pg.get_by_role("button", name="Arame", exact=True).click()
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{OUT}/02_caixa_arame.png")
        await pg.get_by_role("button", name="Sólido", exact=True).click()
        await pg.wait_for_timeout(300)
        check("alternância sólido/arame sem erro", not errors, "; ".join(errors[:2]))
        # seleção de face com informação exata
        await pg.evaluate("() => window.__agtnStep.view('iso')")
        await pg.wait_for_timeout(500)
        c = await pg.evaluate("() => window.__agtnStep.clientOf(50, 25, 20)")
        await pg.mouse.move(c["x"], c["y"])
        await pg.wait_for_timeout(150)
        await pg.mouse.click(c["x"], c["y"])
        await pg.wait_for_timeout(900)
        info = await pg.inner_text(".sv-info")
        parts = re.split(r"(?i)seleção", info)
        sel = parts[-1] if len(parts) > 1 else ""
        check("seleção da face superior mostra informação exata do B-rep (plano, 5000 mm²)", "plane" in sel and "5000,00" in sel.replace(".", ""), sel.strip().replace("\n", " ")[:90] or "sem seleção")
        # unidade de exibição
        await pg.select_option('[data-testid="step-unit"]', "cm")
        await pg.wait_for_timeout(200)
        ui_cm = await pg.inner_text('[data-testid="step-volume"]')
        check("exibição em cm: 100 cm³ (só conversão de exibição)", abs(num(ui_cm) - 100) < 1e-6 and "cm³" in ui_cm, ui_cm)

        # fechar libera o motor e volta ao desenho intacto
        await close_step(pg)
        await pg.wait_for_timeout(500)
        w2 = await workers(cdp)
        check("fechar o documento encerra o worker do motor", w2 <= w0, f"workers {w1} → {w2}")
        check("aba STEP some ao fechar", await pg.locator('[data-testid="ws-step"]').count() == 0)
        ents_after = await pg.evaluate("() => [window.__agtn2d.size(), window.__agtn2d.file().name]")
        on_draw = await pg.evaluate("() => !!document.querySelector('.cmdline')")
        check("desenho 2D intacto depois de abrir/fechar o STEP", on_draw and ents_before == ents_after and ents_before[0] >= 2, f"{ents_before} → {ents_after}")

        # ---------------------------------------------------------------- 2. polegada
        r = await open_file(pg, REF + "inch_block_2x1x0.5.step")
        unit_txt = await pg.inner_text('[data-testid="step-file-unit"]')
        sel_unit = await pg.eval_on_selector('[data-testid="step-unit"]', "e => e.value")
        bb = r["summary"]["bbox"]
        check("STEP em polegada: unidade do arquivo 'in', exibição inicia em in", unit_txt.startswith("in") and sel_unit == "in", unit_txt)
        check("polegada convertida: 50,8 × 25,4 × 12,7 mm", abs(bb["max"]["x"] - bb["min"]["x"] - 50.8) < 1e-3 and abs(bb["max"]["z"] - bb["min"]["z"] - 12.7) < 1e-3)
        await close_step(pg)

        # ---------------------------------------------------------------- 3. conjunto
        r = await open_file(pg, REF + "tank_assembly.step")
        rows = await pg.locator(".stepdoc .t3-row").count()
        check("conjunto (tank_assembly): 4 sólidos e hierarquia na árvore", r["summary"]["solids"] == 4 and rows >= 2, f"sólidos {r['summary']['solids']}, linhas {rows}")
        check("conjunto: volume = referência independente", abs(r["summary"]["volume"] - refs["tank_assembly.step"]["volume"]) / refs["tank_assembly.step"]["volume"] < 1e-6)
        await pg.evaluate("() => window.__agtnStep.yUp(true)")
        await pg.wait_for_function("() => window.__agtnStep.phase === 'pronto'", timeout=60000)
        await pg.wait_for_timeout(600)
        r2 = await pg.evaluate("() => window.__agtnStep.summary")
        check("eixo Y para cima: gira só a exibição, volume igual", abs(r2["volume"] - r["summary"]["volume"]) < 1e-3 * r["summary"]["volume"])
        await pg.screenshot(path=f"{OUT}/03_conjunto.png")
        await close_step(pg)

        # ---------------------------------------------------------------- 4. superfícies curvas
        r = await open_file(pg, REF + "cone_sphere_torus.step")
        check("superfícies curvas (cone, esfera, toro): 3 sólidos, volume de referência", r["summary"]["solids"] == 3 and abs(r["summary"]["volume"] - refs["cone_sphere_torus.step"]["volume"]) / refs["cone_sphere_torus.step"]["volume"] < 1e-6)
        await pg.screenshot(path=f"{OUT}/04_curvas.png")
        await close_step(pg)
        r = await open_file(pg, REF + "vessel_revolved.step")
        banner = await pg.locator('[data-testid="step-invalid"]').count()
        check("geometria inválida do motor é SINALIZADA (vessel_revolved)", r["phase"] == "pronto" and len(r["invalid"]) == 1 and banner == 1, f"inválidos {len(r['invalid'])}")
        await pg.screenshot(path=f"{OUT}/05_invalido_sinalizado.png")
        await close_step(pg)

        # ---------------------------------------------------------------- 5. inválidos
        tmp = os.path.abspath(OUT)
        open(f"{tmp}/nao_step.step", "w").write("isto não é um arquivo STEP\n")
        open(f"{tmp}/vazio.stp", "w").write("")
        full = open(REF + "box_100x50x20.step", encoding="latin1").read()
        open(f"{tmp}/truncado.step", "w", encoding="latin1").write(full[: len(full) // 2])
        for f, pat in [("nao_step.step", "não é um STEP"), ("vazio.stp", "vazio"), ("truncado.step", "")]:
            r = await open_file(pg, f"{tmp}/{f}")
            if f == "truncado.step":
                warn = (r["scan"] or {}).get("warnings", [])
                ok = r["phase"] == "falha" or any("truncado" in w for w in warn)
                check("STEP truncado: falha controlada ou aviso de integridade", ok, r["error"] or "; ".join(warn))
            else:
                check(f"{f}: 'Falha na leitura' com mensagem clara", r["phase"] == "falha" and pat in (r["error"] or ""), r["error"] or "")
            await close_step(pg)
        check("nenhum erro não tratado na página", not errors, "; ".join(errors[:3]))

        # ---------------------------------------------------------------- 6. grandes + memória
        for f, solids in [("grande_120_caixas.step", 120), ("grande_400_placas.step", 400)]:
            if not os.path.exists(BIG + f):
                check(f"arquivo grande {f}", False, "gere com vitest stepdoc.test.ts")
                continue
            heap0 = await pg.evaluate("() => (window.gc && window.gc(), performance.memory.usedJSHeapSize)")
            r = await open_file(pg, BIG + f, timeout=300000)
            heap1 = await pg.evaluate("() => performance.memory.usedJSHeapSize")
            tri = await pg.evaluate("() => window.__agtnStep.triangles")
            ms = r["ms"]
            metrics[f] = {"bytes": os.path.getsize(BIG + f), "ms": ms, "heap_mb_antes": heap0 / 1048576, "heap_mb_aberto": heap1 / 1048576}
            check(f"{f} ({os.path.getsize(BIG + f) / 1048576:.1f} MB): {solids} sólidos", r["phase"] == "pronto" and r["summary"]["solids"] == solids, f"leitura {ms.get('interpretando', 0):.0f} ms, visualização {ms.get('gerando', 0):.0f} ms")
            await pg.screenshot(path=f"{OUT}/06_{f}.png")
            await close_step(pg)
            await pg.wait_for_timeout(800)
            await pg.evaluate("() => { window.gc && window.gc(); }")
            await pg.wait_for_timeout(1500)
            heap2 = await pg.evaluate("() => (window.gc && window.gc(), performance.memory.usedJSHeapSize)")
            metrics[f]["heap_mb_fechado"] = heap2 / 1048576
            check(f"{f}: memória da interface liberada ao fechar", heap2 < heap0 + 0.25 * max(heap1 - heap0, 1) + 8 * 1048576, f"heap {heap0 / 1048576:.0f} → {heap1 / 1048576:.0f} → {heap2 / 1048576:.0f} MB")
        check("worker do motor STEP encerrado ao fim", await workers(cdp) <= w0, f"workers {await workers(cdp)}")

        # ---------------------------------------------------------------- 7. reabrir 5× sem acumular
        for i in range(5):
            await open_file(pg, REF + "flange_607.step")
            await close_step(pg)
        check("abrir/fechar 5× não acumula workers", await workers(cdp) <= w0)
        check("CSP: nenhuma violação no console", not csp, "; ".join(csp[:2]))
        await b.close()

    ok = sum(1 for _, o, _ in results if o)
    json.dump({"pass": ok, "total": len(results), "results": results, "metrics": metrics}, open(f"{OUT}/resultado.json", "w"), indent=1, ensure_ascii=False)
    print(f"\n{ok}/{len(results)} verificações", flush=True)
    sys.exit(0 if ok == len(results) else 1)


asyncio.run(main())
