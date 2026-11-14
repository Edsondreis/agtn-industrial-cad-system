# FASE 4 · ETAPA 5 — Bateria de segurança

Chromium e WebKitGTK **não** equivalem ao WebView2. Os resultados abaixo valem para os ambientes onde rodaram. O WebView2 tem instrumento próprio (§ Windows).

| # | Verificação | Como | Resultado |
|---|---|---|---|
| 1 | CSP ativa | `security.test.ts`: CSP presente, sem `dangerousDisableAssetCspModification`; `csp_chromium_smoke.py` S0: o cabeçalho servido = `tauri.conf.json` | OK (7 testes) |
| 2 | Worker com as permissões mínimas | `worker-src 'self'` (sem `blob:`); motor inicia com a CSP aplicada **também ao script do worker** (MODO=estrito, `engine_fail.py` caso `ok`) | OK. Antes: 20/30; depois: 66/66 (3 rodadas) |
| 3 | WASM inicializando corretamente | S2/S3 em todos os projetos; `'wasm-unsafe-eval'` é necessário e suficiente: sem ele o motor para com o código CSP (caso `semwasmcsp`) | OK |
| 4 | Sem execução dinâmica não autorizada | (a) estático: 0 sites no build (`security.test.ts`); (b) Node com `Function`/`eval` interceptados: 0 chamadas na inicialização e em booleanas (`occt-csp-patch.test.ts`); (c) **suíte inteira** com o V8 proibindo geração de código (`npm run test:sem-eval`): 628 aprovados; (d) Chromium com CSP estrita: 0 mensagens de CSP no console da página e do worker (S9, S9b) | OK. Controles negativos com o glue original: (b) EvalError, (c) motor não inicia |
| 5 | Sem permissões desnecessárias | `capabilities/default.json` em lista fechada (`core:default`, janela destroy/set-title, diálogos open/save/ask/message); nenhuma `shell:`, `fs:`, `http:`, `process:`, `opener:` | OK (2 testes) |
| 6 | Sem dependências externas inesperadas | build: únicas URLs são textos (`www.w3.org` em namespaces SVG; `react.dev` em mensagens de erro do React); execução: S10, nenhuma requisição fora da origem do app | OK |
| 7 | Sem falhas silenciosas | `engine_fail.py`: cada falha forçada mostra código, tela e erro original, e vai para o console. Instrumento: F-09 corrigido (o teste não pula mais a planificação em silêncio) | OK (33/33) |
| 8 | Build de produção | todos os testes de navegador usam `apps/desktop/dist` (build de produção) ou o `.deb` instalado | OK |
| 9 | Inicialização repetida | `engine_fail.py`: 6 ciclos sair/voltar com liberação do worker: todos prontos, 270–335 ms, heap da página estável (7 MB); `occt_bench`: 5 `init` seguidos no Node | OK |
| 10 | Recuperação após falha de inicialização | `.wasm` ausente → `WASM_LOAD` → arquivo volta → "Tentar novamente" → pronto, sem reiniciar o app | OK |

## CSP mais restrita compatível

Testada com a CSP final aplicada a **todas** as respostas, inclusive o script do worker. É mais estrita do que o Tauri faz.

```
default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'
```

**Passa:** 66/66 no smoke e 33/33 no `engine_fail.py`.

**Não dá para restringir mais sem quebrar:**

| Restrição | O que quebra |
|---|---|
| sem `'wasm-unsafe-eval'` | o motor (comprovado no caso `semwasmcsp`) |
| sem `style-src 'unsafe-inline'` | ~~a interface~~ **Revisto em 14/11 (WebView2 real):** no app Tauri esse `'unsafe-inline'` já é ignorado, porque o Tauri põe um nonce no `style-src`. O app passou 228/228 assim, depois da F-10. Os estilos do React entram por CSSOM. A remoção fica proposta para a próxima etapa, com nova rodada no WebView2 |
| sem `img-src blob: data:` | miniaturas/imagens geradas |

## Windows / WebView2 — executado em 14/11/2026 (`FASE4_ETAPA5_WEBVIEW2_EXECUCAO.md`)

- **228/228**: Windows 11, WebView2 157.0.4341.46, executável portátil GNU.
- S9/S9-cdp limpos, depois da **F-10** (o `style=` do logo da abertura era bloqueado pela CSP com nonce; corrigido e coberto por `security.test.ts`).
- S11: **o worker não recebe CSP no WebView2** (igual ao Linux). A F-05 garante que o motor não depende disso.

Instrumento:

`scripts/windows/smoke/webview2_smoke.ps1` roda no app instalado, sem Node. Verificações:
- S1–S9: abre, WASM, OCCT, sólido, booleana, planificação, DXF com hash, DWG, persistência, CSP;
- S9-cdp: console da página e do worker via CDP;
- **S11 (novo):** pergunta, dentro do próprio worker do motor no WebView2, se a CSP está aplicada nele (`eval` permitido ou bloqueado). É informativo: com o glue corrigido, o motor tem de iniciar nos dois casos.
- Em falha, o S2 mostra o **código do diagnóstico** (F-06) e o erro técnico.
