# FASE 4 · ETAPA 5 — Motor 3D: arquitetura depois da estabilização

## O que **não** mudou

- Motor OCCT 8 em WebAssembly (`occt-wasm` 5.17.1, fixado). O `.wasm` (21,3 MB, SHA-256 `cea5998c…`) é o mesmo e continua um recurso separado e substituível (LGPL), lido pelo Rust `read_engine`.
- Worker dedicado `agtn-motor-3d`, protocolo pedido/resposta por `postMessage`, `sync` coalescido, malhas por `Transferable`.
- Também sem mudança:
  - `core/solid` (`OcctSolidKernel`, `PartEvaluator`), `core/model3d`, `modules/sheet3d` (grafo, build, flat, proveniência);
  - `bend.ts`, `tray.ts`;
  - formato `.agtncad`;
  - o 2D inteiro.

## O que mudou

| Arquivo | Mudança |
|---|---|
| `core/solid/src/occt-csp-patch.ts` (novo) | correção F-05 do glue (2 geradores embind → closures), presa ao SHA-256 do glue |
| `apps/desktop/vite.config.ts` | o plugin `agtn-occt-wasm` aplica a correção (página e worker); `optimizeDeps.exclude: ["occt-wasm"]` no `vite dev` |
| `vitest.config.ts` | os testes usam o glue corrigido (`agtn-occt-csp` + `server.deps.inline`) |
| `apps/desktop/src/ws3d/engine.ts` | etapas (wasm → worker → init → comunicação); erro do worker antes/depois de pronto; `messageerror`; prazo de 90 s na inicialização; falha libera o worker (permite "Tentar novamente"); tempo de leitura do `.wasm` medido (`wasmLoadMs`) |
| `apps/desktop/src/ws3d/engine.worker.ts`, `protocol.ts` | a resposta de erro leva o nome do erro original e a etapa |
| `core/solid/src/occt.ts` | o erro de inicialização guarda `Nome: mensagem` (antes só a mensagem) |
| `apps/desktop/src/ws3d/diagnostics.ts` (novo), `Workspace3D.tsx`, `ws3d.css` | diagnóstico F-06 |
| `apps/desktop/src-tauri/tauri.conf.json` | CSP mais restrita (`worker-src 'self'`, `object-src 'none'`, `base-uri 'self'`) |

## Ciclo de vida do motor

```
off ──start()──▶ loading ──▶ ready ──(sair do 3D: libera após agtn.engineIdleMs, padrão 2 min)──▶ off
                    │                       ▲
                    └──▶ error(diag) ──"Tentar novamente": dispose() + start()──┘
```

- Inicialização repetida: provada com 6 ciclos seguidos (270–335 ms cada, heap da página estável).
- Falha de inicialização: o worker é encerrado, `ready` é zerado e o próximo `start()` recomeça do zero.

## Atualizar o occt-wasm no futuro (procedimento obrigatório)

1. Atualizar a versão em `core/solid/package.json` e rodar `npm ci`.
2. O build e os testes **param** com `occt-csp-patch: occt-wasm.js com SHA-256 … esperado …`. É intencional.
3. Conferir no glue novo se ainda existe `createJsInvoker` com `new Function`.
   - Se o mantenedor passou a compilar com `-sEMBIND_AOT=1` ou `-sDYNAMIC_EXECUTION=0`, **remover** a correção.
   - Senão, adaptar os trechos e o SHA-256.
4. Rodar `npm test`, `npm run test:sem-eval`, `tests/e2e/csp_chromium_smoke.py` (MODO=estrito), `tests/e2e/engine_fail.py` e, no Windows, `webview2_smoke.ps1`.

## LGPL

- A correção muda só o glue JavaScript (texto legível, publicado no instalador dentro do worker). O `.wasm` do OCCT não é tocado.
- O usuário continua podendo trocar `occt/occt-wasm.wasm` por outro build compatível do mesmo glue, como antes.
- A correção é um arquivo-fonte do repositório (`core/solid/src/occt-csp-patch.ts`).
