"""Carga: estrutura metálica com N perfis em subconjuntos + tela vertical."""
import asyncio, json, os, re, sys
from playwright.async_api import async_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.environ.get("E2E_OUT", "tests/output/e2e")
os.makedirs(OUT, exist_ok=True)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"])
        for (w, h, tag) in [(1600, 950, "paisagem"), (864, 1536, "vertical")]:
            pg = await (await b.new_context(viewport={"width": w, "height": h})).new_page()
            await pg.goto(URL)
            await pg.wait_for_timeout(1000)
            await pg.get_by_text("Modelo 3D", exact=True).first.click()
            await pg.wait_for_selector(".st3-dot.ready", timeout=30000)
            # monta uma estrutura: 4 pórticos (2 colunas U + 1 viga I) + 2 longarinas por vão + chapas de base
            n = await pg.evaluate("""async (root) => {
              const M = await import('/@fs' + root + '/core/model3d/src/index.ts');
              const doc = window.__agtn3d.doc;
              let m = M.getModel(doc);
              const pl = (x,y,z,rx=0,ry=0,rz=0) => ({origin:{x,y,z}, rot:{x:rx,y:ry,z:rz}});
              const U = {shape:'U', h:152.4, b:48.8, tw:5.08, tf:8.71};
              const I = {shape:'I', h:200, b:100, tw:5.6, tf:8.5};
              let r = M.addGroup(m, {name:'ESTRUTURA'}); m = r.model; const est = r.id;
              let count = 0;
              for (let i = 0; i < 4; i++) {
                const g = M.addGroup(m, {name:`PÓRTICO ${i+1}`, parent: est, placement: pl(0, i*2000, 0)}); m = g.model;
                for (const x of [0, 4000]) {
                  m = M.addBody(m, {name:`COLUNA ${i+1}${x?'B':'A'}`, parent:g.id, placement: pl(x,0,12), source:{type:'primitive', spec:{kind:'profile', length:3000, profile:U}}}).model; count++;
                  m = M.addBody(m, {name:`BASE ${i+1}${x?'B':'A'}`, parent:g.id, placement: pl(x-100,-80,0), source:{type:'primitive', spec:{kind:'box', w:300, d:300, h:12}}}).model; count++;
                }
                m = M.addBody(m, {name:`VIGA ${i+1}`, parent:g.id, placement: pl(0,24,3012, 0,90,0), source:{type:'primitive', spec:{kind:'profile', length:4100, profile:I}}}).model; count++;
                if (i < 3) for (const x of [0, 4000]) for (const z of [1000, 2000, 3000]) {
                  m = M.addBody(m, {name:`LONGARINA ${i+1}-${x?'B':'A'}-${z}`, parent:est, placement: pl(x+25, i*2000+100, z, -90,0,0), source:{type:'primitive', spec:{kind:'profile', length:1800, profile:{shape:'RHS', b:50, h:50, t:3}}}}).model; count++;
                }
              }
              M.commitModel(doc, 'Estrutura de teste', m);
              return count;
            }""", ROOT)
            t0 = await pg.evaluate("performance.now()")
            await pg.wait_for_function(f"() => new RegExp('{n} corpo').test(document.querySelector('.st3').innerText) && /regen [1-9]/.test(document.querySelector('.st3').innerText)", timeout=120000)
            t1 = await pg.evaluate("performance.now()")
            await pg.wait_for_timeout(500)
            await pg.click(".v3-canvas", position={"x": 5, "y": 5})
            await pg.keyboard.press("f")
            await pg.wait_for_timeout(700)
            st = re.sub(r"\s+", " ", await pg.inner_text(".st3"))
            # fluidez: 60 passos de órbita medindo o tempo de quadro do renderizador
            box = await pg.locator(".v3-canvas").bounding_box()
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.8
            await pg.mouse.move(cx, cy); await pg.mouse.down()
            frames = []
            for k in range(60):
                await pg.mouse.move(cx + k * 4, cy - k, steps=1)
                await pg.wait_for_timeout(16)
                frames.append(await pg.evaluate("window.__agtn3d.vp.frameMs"))
            await pg.mouse.up()
            frames.sort()
            mem = await pg.evaluate("() => Math.round(performance.memory.usedJSHeapSize/1048576)")
            await pg.keyboard.press("7"); await pg.wait_for_timeout(600)
            await pg.screenshot(path=f"{OUT}/14_estrutura_{tag}.png")
            print(json.dumps({"tela": tag, "corpos": n, "sync_total_ms": round(t1 - t0), "status": st, "quadro_mediana_ms": round(frames[30], 2), "quadro_p95_ms": round(frames[56], 2), "heap_js_mb": mem}, ensure_ascii=False))
        await b.close()
asyncio.run(main())
