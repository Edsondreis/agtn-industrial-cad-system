# FASE 4 · ETAPA 5 — Auditoria arquitetural do motor 3D (F-05)

Data: 13/11/2026 · Branch `feature/agtn-3d-ia` (início em `c32f309`, local = remoto, sem alterações pendentes) ·
`main` = `23a2540` (v3.1.1), não alterada.

## 1. Como o motor 3D inicia

```
UI (Workspace3D.tsx) ── engine().start() ──▶ engine.ts (página)
  1. loadWasm():
     - Tauri: comando Rust read_engine("occt-wasm.wasm") → recurso occt/occt-wasm.wasm (21,3 MB) → IPC → ArrayBuffer;
     - navegador: fetch("/__engine/occt-wasm.wasm"), middleware do Vite.
  2. new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" }):
     worker dedicado "agtn-motor-3d", script do próprio app (assets/engine.worker-*.js), mesma origem.
  3. postMessage({ op: "init", wasm }, [wasm]): o ArrayBuffer é transferido, não copiado.

engine.worker.ts (worker)
  4. OcctSolidKernel.create({ wasm }) → occt-wasm OcctKernel.init()
       → import do glue do Emscripten (occt-wasm.js, empacotado no worker)
       → WebAssembly.instantiate(binário, imports)            ◀ precisa de 'wasm-unsafe-eval'
       → registro das ligações embind (milhares de funções C++)  ◀ AQUI o glue original usava new Function
  5. Responde { kernel: "OCCT 8 (WebAssembly)", ms }. Daí em diante a comunicação é por postMessage
     (pedido/resposta com id; sync coalescido; malhas por Transferable).
```

## 2. Varredura de geração de código (build de produção, antes da correção)

Todos os `.js` de `apps/desktop/dist/assets` (18 arquivos):

| Arquivo | `Function(`/`new Function` | `eval(` | `setTimeout("…")` | `new Worker` | `import()` | `WebAssembly.instantiate*` |
|---|---|---|---|---|---|---|
| `occt-wasm-*.js` (glue, cópia do worker) | **2** | 0 | 0 | 0 | 1 (`node:module`, só no Node) | 2 |
| `occt-wasm-*.js` (glue, cópia carregável pela página) | **2** | 0 | 0 | 0 | 1 | 2 |
| `Workspace3D-*.js` | 0 | 0 | 0 | 1 (o worker do motor) | 1 | 0 |
| `engine.worker-*.js` | 0 | 0 | 0 | 0 | 1 | 0 |
| demais 14 (2D, chapas, three.js, React, Tauri) | 0 | 0 | 0 | 0 | — | 0 |

Blob URLs: `createObjectURL` aparece só em `fonts-*.js` e `index-*.js`, para download de arquivo e fontes. Nenhum worker é criado de Blob, e `worker-src blob:` não era usado.

## 3. Respostas às perguntas da etapa

| # | Pergunta | Resposta (com evidência) |
|---|---|---|
| 1 | Qual biblioteca gera o código dinâmico? | O **embind do Emscripten**, que faz a ligação JS ↔ C++, dentro do glue publicado pelo pacote `occt-wasm` 5.17.1 (`node_modules/occt-wasm/dist/occt-wasm.js`, SHA-256 `bee2d10b…`). Não é o OCCT (C++) nem o `.wasm`. |
| 2 | Em qual arquivo / função? | No glue, só em dois lugares. (a) `createJsInvoker(argTypes, isClassMethodFunc, returns, isAsync)`: monta o texto do invocador e faz `return new Function(args1, invokerFnBody)`. É chamado por `craftInvokerFunction` para **cada** função/método/construtor C++ registrado. (b) `__emval_create_invoker(argCount, argTypesPtr, kind)`: monta o chamador de métodos JS a partir do C++ (`emscripten::val`) e faz `new Function(Object.keys(captures), functionBody)(…)`. |
| 3 | OCCT, Emscripten ou outra dependência? | Emscripten (embind, compilado com `DYNAMIC_EXECUTION` padrão = 1 e sem `EMBIND_AOT`). |
| 4 | Existe alternativa oficial de compilação antecipada? | Sim, duas opções do Emscripten. `-sDYNAMIC_EXECUTION=0` troca os geradores por closures (mais lento por chamada). `-sEMBIND_AOT=1` gera os invocadores no build, sem custo. As duas exigem **recompilar o occt-wasm** (emsdk 5.0.3 + Rust + OCCT; README do occt-wasm, "Building from Source"). |
| 5 | Dá para inicializar sem eval? | Sim. A correção desta etapa troca os 2 geradores por closures equivalentes no build. O motor inicia com o V8 **proibindo** geração de código (`--disallow-code-generation-from-strings`) e no Chromium com a CSP aplicada também ao worker. |
| 6 | Worker principal ou secundários? | Só no worker dedicado do motor (`agtn-motor-3d`). O glue não cria workers (0 `new Worker`, 0 Blob), e o occt-wasm não usa o `worker.js` próprio dele no app. A cópia do glue que a página pode carregar nunca é executada na página (a página só usa enums/classes de erro do pacote). |
| 7 | Quais diretivas CSP são realmente necessárias? | `script-src 'self' 'wasm-unsafe-eval'` (scripts do app + compilação de WebAssembly); `worker-src 'self'`; `connect-src 'self' ipc: http://ipc.localhost` (IPC do Tauri no Linux/macOS e no Windows); `img-src 'self' data: blob:` (miniaturas e imagens geradas); `style-src 'self' 'unsafe-inline'` (estilos em linha do React/three); `default-src 'self'`. |
| 8 | O que pode ser mantido integralmente? | Tudo acima, **sem** `'unsafe-eval'`. Dá para endurecer: tirar `blob:` do `worker-src` (não usado) e acrescentar `object-src 'none'` e `base-uri 'self'`. Feito nesta etapa. |

## 4. Integração com Tauri e WebView2 (o que muda entre plataformas)

| Ponto | Linux (WebKitGTK) | Windows (WebView2 / Chromium) |
|---|---|---|
| Origem do app | `tauri://localhost` | `http://tauri.localhost` |
| IPC | `ipc:` | `http://ipc.localhost` |
| CSP | cabeçalho só nas respostas `.html` (Tauri 2.12.5, `manager/mod.rs`, `is_html`) | igual (mesmo código do Tauri) |
| CSP do worker | sem cabeçalho → sem CSP | Chromium aplica ao worker a política da **resposta** do script dele, que vem sem cabeçalho. Então hoje também não tem CSP, mas **isso não foi visto no WebView2 real** |
| `.wasm` | recurso do pacote, lido pelo Rust | idem (`resources` do NSIS) |

**Conclusão da causa raiz:** o motor só funcionava porque a CSP **não chegava** ao worker. Era uma dependência de comportamento do Tauri/WebView2, não uma propriedade do app. Com o glue corrigido, o motor funciona **com ou sem** CSP no worker. A dependência externa deixa de ser crítica.

## 5. Outras descobertas

| ID | Gravidade | Descoberta |
|---|---|---|
| F-09 | MÉDIA (instrumento) | O teste de fumaça da ETAPA 4 **pulava em silêncio** S6/S7 (planificação/DXF) quando a planificação chegava do worker depois dos volumes. Na execução final da ETAPA 4, o projeto `grande_120furos` teve 8 verificações em vez de 15. Corrigido: o teste espera até 60 s e **falha** se a planificação não chegar. O relatório da ETAPA 4 citava "58/58" sem saber disso. |
| — | INFO | Pipeline de publicação: ver `FASE4_ETAPA5_RELATORIO_FINAL.md` §Versão (F-08). |
