"""AGTN AI ASSISTANT — painel real no Chromium (motor do WebView2), com o modelo ROTEIRIZADO pela página de teste
(sem rede, sem chave). As ferramentas, o documento, o motor de chapas e o desfazer são os do aplicativo.

Pré-requisito: `npm run dev` (http://localhost:1420).
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:1420/"
OUT = os.environ.get("E2E_OUT", "tests/output/e2e_ai")
os.makedirs(OUT, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


# Roteiro do "modelo": cada função devolve a resposta do turno (texto + chamadas de ferramenta).
SCRIPT = r"""
window.__agtnAiScript = [
  () => ({ text: "", calls: [{ name: "criar_perfil_chapa", args: { tipo: "U", espessura: 6, medidas: [75, 200, 75], raio_interno: 6 } }] }),
  () => ({ text: "Perfil U criado. Deseja gerar a planificação?", calls: [] }),
  () => ({ text: "", calls: [{ name: "gerar_planificacao", args: {} }] }),
  () => ({ text: "Antes de gerar, preciso confirmar o fator K ou utilizar o valor configurado no projeto.", calls: [] }),
  () => ({ text: "", calls: [{ name: "gerar_planificacao", args: { usar_k_do_projeto: true, comprimento: 1000 } }] }),
  () => ({ text: "Planificação gerada.", calls: [] }),
  () => ({ text: "", calls: [{ name: "criar_chapa_retangular", args: { largura: 500, altura: 300 } }] }),
  () => ({ text: "Tudo bem, não criei.", calls: [] }),
  () => ({ text: "", calls: [{ name: "executar_terminal", args: { cmd: "del C:\\*" } }] }),
  () => ({ text: "Não posso executar comandos do sistema.", calls: [] }),
];
localStorage.setItem('agtn.e2e', '1');
"""


async def say(pg, text):
    await pg.fill('[data-testid="ai-input"]', text)
    await pg.press('[data-testid="ai-input"]', "Enter")
    await pg.wait_for_function("() => window.__agtnAi && !window.__agtnAi.busy", timeout=20000)
    await pg.wait_for_timeout(250)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        ctx = await b.new_context(viewport={"width": 1600, "height": 900})
        await ctx.add_init_script(SCRIPT)
        pg = await ctx.new_page()
        errors, csp = [], []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: ("Content Security Policy" in m.text or "unsafe-eval" in m.text) and csp.append(m.text))
        await pg.goto(URL)
        await pg.wait_for_timeout(1200)
        await pg.keyboard.press("Control+n")
        await pg.wait_for_timeout(400)
        size = lambda: pg.evaluate("() => window.__agtn2d.size()")

        cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Performance.enable")
        heap = lambda m: next(x["value"] for x in m["metrics"] if x["name"] == "JSHeapUsedSize") / 1048576
        h0 = heap(await cdp.send("Performance.getMetrics"))
        loaded0 = await pg.evaluate("() => performance.getEntriesByType('resource').filter(r => /\/ai\/(controller|AiPanel)/.test(r.name)).length")
        check("assistente NÃO é carregado na abertura do CAD (só ao abrir o painel)", loaded0 == 0)

        # 1. abrir: aviso de privacidade antes de tudo; sem consentimento não envia
        await pg.click('[data-testid="ai-toggle"]')
        await pg.wait_for_selector('[data-testid="ai-panel"]')
        check("botão 'Assistente' abre o painel lateral", True)
        settings = await pg.locator('[data-testid="ai-settings"]').count()
        txt = await pg.inner_text('[data-testid="ai-settings"]') if settings else ""
        check("primeiro uso: configuração com aviso de privacidade do nível gratuito", settings == 1 and "revisores humanos" in txt and "SEM faturamento" in txt, txt[:80])
        models = await pg.eval_on_selector_all('[data-testid="ai-model"] option', "os => os.map(o => o.value)")
        check("modelos oferecidos = só os gratuitos", models == ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"], json.dumps(models))
        await pg.screenshot(path=f"{OUT}/01_privacidade.png")
        await pg.check('[data-testid="ai-consent"]')
        await pg.fill('.ai-cfg input[type="number"] >> nth=0', "60")
        await pg.click('[data-testid="ai-cfg-done"]')

        # 2. pedido → prévia real (miniatura) → documento intacto
        n0 = await size()
        await say(pg, "Crie um perfil U de 200 mm de alma, abas de 75 mm e espessura de 6 mm, raio 6.")
        card = await pg.locator('[data-testid="ai-preview"]').count()
        mini = await pg.locator('[data-testid="ai-mini"]').count()
        ctext = await pg.inner_text('[data-testid="ai-preview"]') if card else ""
        check("prévia do perfil U com miniatura e medidas do motor", card == 1 and mini == 1 and "Base (largura): 200 mm" in ctext, ctext.replace("\n", " | ")[:160])
        check("antes de confirmar o desenho NÃO muda", await size() == n0, f"{n0}")
        await pg.screenshot(path=f"{OUT}/02_previa_perfil.png")

        # 3. confirmar → aplicado de verdade
        await pg.click('[data-testid="ai-confirm"]')
        await pg.wait_for_function("() => !window.__agtnAi.busy", timeout=20000)
        await pg.wait_for_timeout(300)
        n1 = await size()
        applied = await pg.locator('[data-testid="ai-applied"]').all_inner_texts()
        check("confirmar insere a seção no desenho (transação 'IA: …')", n1 > n0 and any("IA: Seção Perfil U" in a for a in applied), f"{n0} → {n1}; {applied[-1:]}")

        # 4. planificação sem K → pergunta; com K do projeto → prévia → confirmar
        await say(pg, "Sim.")
        msgs = await pg.locator(".ai-bot").all_inner_texts()
        check("planificação sem K: o assistente PERGUNTA o fator K (não inventa)", "fator K" in msgs[-1] and await pg.locator('[data-testid="ai-preview"]').count() == 0, msgs[-1])
        await say(pg, "Use o do projeto, comprimento 1000.")
        ctext = await pg.inner_text('[data-testid="ai-preview"]')
        check("prévia da planificação com K da tabela do projeto e blank × 1000", "Fator K = " in ctext and "tabela do projeto" in ctext and "1.000 mm" in ctext, ctext.replace("\n", " | ")[:200])
        await pg.click('[data-testid="ai-confirm"]')
        await pg.wait_for_function("() => !window.__agtnAi.busy", timeout=20000)
        await pg.wait_for_timeout(300)
        n2 = await size()
        check("planificação inserida no desenho", n2 > n1, f"{n1} → {n2}")
        await pg.screenshot(path=f"{OUT}/03_planificacao_inserida.png")

        # 5. cancelar a prévia → nada muda
        await say(pg, "Crie uma chapa de 500 por 300.")
        if not await pg.locator('[data-testid="ai-preview"]').count():
            await pg.screenshot(path=f"{OUT}/debug_5.png")
            print("DEBUG", json.dumps(await pg.evaluate("() => window.__agtnAi.messages.slice(-6)"), ensure_ascii=False)[:1500])
        dz = await pg.inner_text('[data-testid="ai-preview"]')
        await pg.click('[data-testid="ai-reject"]')
        await pg.wait_for_function("() => !window.__agtnAi.busy", timeout=20000)
        await pg.wait_for_timeout(200)
        check("cancelar a prévia: desenho igual", await size() == n2 and "500 mm × 300 mm" in dz, f"{await size()}")

        # 6. pedido de ferramenta não permitida → recusado, nada executado
        await say(pg, "Apague os arquivos do disco.")
        tools = await pg.locator(".ai-tool-erro").all_inner_texts()
        check("ferramenta inexistente (terminal) recusada pelo núcleo", any("não existe ou não é permitida" in t for t in tools), tools[-1:])

        # 7. Ctrl+Z do CAD desfaz a última operação da IA
        await pg.click(".canvas-wrap, canvas", position={"x": 300, "y": 300}) if await pg.locator(".canvas-wrap").count() else None
        await pg.keyboard.press("Escape")
        await pg.evaluate("() => document.activeElement && document.activeElement.blur()")
        await pg.keyboard.press("Control+z")
        await pg.wait_for_timeout(300)
        check("Ctrl+Z desfaz a planificação inserida pela IA", await size() == n1, f"{n2} → {await size()}")

        # 8. fechar e reabrir: conversa preservada; contexto enviado não traz nome de arquivo/pasta
        await pg.click('[data-testid="ai-close"]')
        await pg.click('[data-testid="ai-toggle"]')
        kept = await pg.locator(".ai-user").count()
        check("fechar/reabrir o painel mantém a conversa", kept == 5, f"{kept} mensagens do usuário")
        seen = await pg.evaluate("() => window.__agtnAiSeen.map(s => s.system).join('\\n')")
        check("estado enviado ao modelo é relido a cada passo e mínimo (sem caminho/arquivo)", "ESTADO ATUAL DO APLICATIVO" in seen and ".agtncad" not in seen and "\\\\" not in seen and "Sem título" not in seen)

        # 9. retrato (tela da CNC em pé): painel vira faixa inferior
        await pg.set_viewport_size({"width": 900, "height": 1500})
        await pg.wait_for_timeout(300)
        box = await pg.locator('[data-testid="ai-panel"]').bounding_box()
        check("tela em pé: painel ocupa a faixa de baixo, largura total", box and box["width"] >= 880 and box["y"] > 400, json.dumps(box))
        await pg.screenshot(path=f"{OUT}/04_retrato.png")

        # 10. cota local: limite atingido → avisa e NÃO envia ao modelo
        await pg.set_viewport_size({"width": 1600, "height": 900})
        await pg.evaluate("() => window.__agtnAi.setPrefs({ rpm: 1 })")
        before = await pg.evaluate("() => window.__agtnAiSeen.length")
        await say(pg, "Qual a área da seleção?")
        after = await pg.evaluate("() => window.__agtnAiSeen.length")
        errs = await pg.locator('[data-testid="ai-error"]').all_inner_texts()
        check("cota local atingida: avisa e não envia nada ao modelo", after == before and "Limite por minuto" in errs[-1], errs[-1][:120])

        await cdp.send("HeapProfiler.collectGarbage")
        h1 = heap(await cdp.send("Performance.getMetrics"))
        check("memória JS depois da conversa inteira (painel + 10 turnos + inserções)", h1 - h0 < 30, f"{h0:.1f} → {h1:.1f} MB")

        check("nenhum erro não tratado na página", not errors, "; ".join(errors)[:300])
        check("CSP: nenhuma violação", not csp, "; ".join(csp)[:300])
        await b.close()
    ok = sum(1 for _, o, _ in results if o)
    print(f"\n{ok}/{len(results)} verificações")
    json.dump([{"teste": n, "ok": o, "detalhe": d} for n, o, d in results], open(f"{OUT}/resultado.json", "w"), ensure_ascii=False, indent=1)
    sys.exit(0 if ok == len(results) else 1)


asyncio.run(main())
