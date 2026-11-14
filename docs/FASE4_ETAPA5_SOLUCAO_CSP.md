# FASE 4 · ETAPA 5 — Solução da F-05 e CSP final

## Resumo

O glue do Emscripten gerava código com `new Function` em 2 lugares do embind. No **build**, esses 2 geradores foram trocados por closures de comportamento idêntico, o mesmo que o Emscripten emite com `-sDYNAMIC_EXECUTION=0`.

- O `.wasm` não mudou.
- A CSP continua ativa, sem `'unsafe-eval'`, e ficou **mais restrita**.
- O motor inicia com a CSP aplicada **também ao worker**, que era o cenário que falhava (antes 20/30, agora 66/66).

## Alternativas comparadas

| | A. Recompilar o occt-wasm (`EMBIND_AOT` / `DYNAMIC_EXECUTION=0`) | **B. Trocar os 2 geradores no build** (escolhida) | C. Motor fora do WebView (nativo/serviço por IPC) | D. Liberar na CSP |
|---|---|---|---|---|
| Resolve a F-05? | sim, na origem | sim | sim (não haveria JS do OCCT) | só "liberando" |
| Compatibilidade | total, se o build do occt-wasm aceitar as opções (há relatos de erro com `EMBIND_AOT` em classes) | total: mesma API, mesmo `.wasm`, mesmo comportamento; equivalência testada | reescrever toda a ponte TS ↔ OCCT (core/solid, worker, protocolo) | total |
| Desempenho | AOT: igual ou melhor que hoje; `DYNAMIC_EXECUTION=0`: mais lento por chamada | ver `FASE4_ETAPA5_DESEMPENHO.md` (init mais rápido; chamadas curtas no ruído) | IPC por chamada; malhas grandes pelo IPC | igual |
| Tamanho | igual | glue −110 bytes | +binário nativo do OCCT (dezenas de MB) e +toolchain C++ | igual |
| Manutenção | **fork do motor**: emsdk 5.0.3 + Rust + OCCT + horas de build a cada versão | 1 arquivo (`core/solid/src/occt-csp-patch.ts`), preso ao SHA-256 do glue; o build **para** se o occt-wasm mudar | muito alta | nenhuma |
| Windows | igual hoje | igual hoje | novo risco (DLLs, antivírus, processo filho) | igual |
| Segurança | ótima | ótima: sem `'unsafe-eval'` | boa | **ruim**: `'unsafe-eval'` vale para a página inteira (o Tauri só aplica CSP ao HTML; não dá para restringir ao worker) |
| Viável aqui? | **não**: sem emsdk, OCCT e rede para baixá-los; horas de compilação | **sim** | não nesta etapa (desproporcional) | — rejeitada |

**Recomendação de longo prazo:** pedir ao mantenedor do occt-wasm que publique o pacote com `-sEMBIND_AOT=1` (ou `-sDYNAMIC_EXECUTION=0`). Quando isso acontecer, a correção B vira desnecessária. A proteção de SHA-256 obriga a revisá-la na atualização de qualquer jeito.

## Como a correção funciona

`core/solid/src/occt-csp-patch.ts` → `patchOcctGlue(code)`:

1. Confere o SHA-256 do glue de entrada (`bee2d10b00b461bc4e8c693b68bdaaabfdc7f6c10efd08d4c47715732da45160`, occt-wasm 5.17.1). Se for outro arquivo, o build **para**.
2. Substitui `createJsInvoker` (do início até o `return new Function(args1, invokerFnBody)`) por uma fábrica. Ela recebe os mesmos argumentos, na mesma ordem de `craftInvokerFunction`: `humanName`, `throwBindingError`, `invoker`, `fn`, `runDestructors`, `fromRetWire`, `toClassParamWire`, os conversores de cada argumento e os destrutores. Devolve a mesma função:
   - converte `this` (métodos) e cada argumento com a mesma pilha de destrutores (ou `null`);
   - chama `invoker(fn, [thisWired,] argsWired…)`;
   - roda os destrutores (pilha, ou destrutor por parâmetro na mesma ordem);
   - converte o retorno;
   - `length` = número de argumentos, como a original.
3. Substitui o corpo de `__emval_create_invoker` por um chamador por closure. Mantém os 4 tipos (0 chamada, 1 método com `this`, 2 `new`, 3 lista) e a ordem de avaliação (alvo/método → argumentos → chamada). Mantém `emval_returnValue` quando não é `void`.
4. Confere que cada trecho existia exatamente uma vez e que a saída **não** tem `Function(`, `new Function`, `eval(` nem `setTimeout("…")`.

**Onde é aplicada:**

| Lugar | Como |
|---|---|
| Build do app (página e worker) | plugin `agtn-occt-wasm` em `apps/desktop/vite.config.ts` (`plugins` e `worker.plugins`) |
| `vite dev` | `optimizeDeps.exclude: ["occt-wasm"]`, porque o pré-empacotamento pularia o plugin |
| Testes | plugin `agtn-occt-csp` + `server.deps.inline: [/occt-wasm/]` em `vitest.config.ts`: os 600 testes usam a **mesma** ponte do app |

## Provas

| Prova | Antes | Depois |
|---|---|---|
| Glue: geração de código (estático) | 2 sites | 0 |
| Build de produção: arquivos com geração de código | 2 (as 2 cópias do glue) | **0** (`security.test.ts`) |
| Motor no Node com `Function`/`eval` interceptados (`occt-csp-patch.test.ts`) | **falha** com EvalError (controle negativo, glue original) | inicia; sólido, união, corte, interseção e caixa com volumes exatos; **0** chamadas |
| Suíte inteira com o V8 proibindo geração de código (`npm run test:sem-eval`) | glue original: motor não inicia (controle negativo) | **600 aprovados** (ver regressão) |
| Chromium, build de produção, CSP também no worker (`csp_chromium_smoke.py` MODO=estrito) | **20/30** (S2/S3 falham nos 5 projetos) | **66/66** |
| Chromium, CSP como o Tauri aplica (MODO=tauri) | 61/61 | 66/66 (com a nova S10, sem requisição externa) |
| App Tauri compilado no Linux (`tauri_smoke.py`) | 65/65 | ver `FASE4_ETAPA5_REGRESSAO.md` |
| Falhas forçadas + recuperação + 6 inicializações (`engine_fail.py`, CSP estrita) | — | **33/33** |

## CSP final

```
default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'self'
```

| Diretiva | Mudança | Por quê |
|---|---|---|
| `script-src 'self' 'wasm-unsafe-eval'` | igual | `'wasm-unsafe-eval'` é a permissão **mínima** para compilar WebAssembly. Não permite `eval` nem `Function` em JavaScript. Sem ela o motor não inicia: comprovado no caso `semwasmcsp` (código CSP) |
| `worker-src 'self'` | **tirado `blob:`** | nada cria worker de Blob (varredura do build) |
| `object-src 'none'` | **novo** | o app não usa `<object>`/`<embed>` |
| `base-uri 'self'` | **novo** | o app não usa `<base>`; impede redirecionar caminhos relativos |
| `style-src 'unsafe-inline'` | igual | estilos em linha do React/three (não executam código); vinham da v3.1.1 |
| `connect-src` | igual | só o próprio app e o IPC do Tauri |

Comparada com a v3.1.1 (`script-src 'self'`), a única permissão acrescentada desde a FASE 2 é `'wasm-unsafe-eval'`, indispensável e mínima.

## O que continua dependendo do ambiente

- **Nada de geração de código.** O motor não depende mais de o Tauri ou o WebView2 deixarem de aplicar a CSP ao worker. Com a CSP no worker ou sem ela, funciona: as duas situações foram testadas no Chromium.
- **WebView2 real:** continua obrigatório para homologar.
  - O teste novo **S11** (`webview2_smoke.ps1`) pergunta ao próprio worker, no WebView2, se a CSP é aplicada a ele. É informativo.
  - S2, S3 e S9 provam que o motor inicia sem violação.
