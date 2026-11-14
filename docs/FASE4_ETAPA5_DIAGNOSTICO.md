# FASE 4 · ETAPA 5 — Diagnóstico do motor 3D (F-06)

## Antes

- Qualquer falha mostrava "Não foi possível iniciar o motor 3D" e o texto do erro, que era sempre o mesmo genérico: "Não foi possível iniciar o motor 3D (OCCT)".
- O motivo real (por exemplo, a violação de CSP) chegava do worker em `details`, mas **não era exibido nem registrado**.
- Não havia como tentar de novo sem fechar o app.

## Agora

```
Não foi possível iniciar o ambiente 3D.
O componente geométrico foi encontrado, mas não pôde ser carregado: o arquivo está danificado ou é incompatível.
O desenho 2D permanece disponível.
Reinstale o AGTN Industrial CAD. Se continuar, envie o diagnóstico ao suporte.
[ Tentar novamente ]  [ Copiar diagnóstico ]  [ Detalhes técnicos ]
```

- "Detalhes técnicos" abre o diagnóstico completo, que pode ser selecionado:
  - código e etapa;
  - o erro **original** (por exemplo, `RuntimeError: Aborted(CompileError: WebAssembly.instantiate(): expected magic word…)`);
  - versão do app, navegador/WebView, origem, Tauri, núcleos e memória.
- "Copiar diagnóstico" põe esse texto na área de transferência.
- O diagnóstico também vai para o console (`[AGTN] motor 3D: …`) e para `window.__agtnEngineDiag`, que o teste de fumaça do WebView2 lê.
- A barra de status mostra `Motor 3D com erro (CÓDIGO)`.
- "Tentar novamente" encerra o worker e recomeça do zero, sem reiniciar o app. Depois de uma falha, o worker é sempre liberado.

## Classificação

`apps/desktop/src/ws3d/diagnostics.ts`. A etapa vem do `engine.ts`/worker; o tipo do erro vem do nome e do texto originais.

| Código | Quando | Mensagem ao usuário (resumo) |
|---|---|---|
| `WASM_LOAD` | o `.wasm` não foi lido (Rust `read_engine` ou HTTP falhou) | arquivo do componente geométrico não pôde ser lido; instalação incompleta |
| `WASM_COMPILE` | `CompileError`/`LinkError`, magic word, `WebAssembly.instantiate` falhou | arquivo danificado ou incompatível |
| `WORKER_START` | erro do worker **antes** de responder à inicialização (script ausente, módulo inválido) | o processo de cálculo 3D não pôde ser iniciado |
| `CSP` | `EvalError`, "Content Security Policy", "violates the following", "Refused to compile" | a política de segurança bloqueou o componente (problema do app, não do arquivo) |
| `OCCT_INIT` | o módulo carregou, mas o kernel não inicializou | o componente geométrico não conseguiu ser inicializado |
| `MEMORY` | `RangeError` de memória, `Aborted(OOM)`, "could not allocate memory" | memória insuficiente; fechar outros programas |
| `COMMUNICATION` | sem resposta em 90 s, `DataCloneError`, `messageerror`, worker caiu depois de pronto | a comunicação com o processo de cálculo foi interrompida |

Ordem de precedência: CSP → memória → leitura → compilação → worker → comunicação → OCCT. Exemplo: um WebAssembly bloqueado por CSP gera `CompileError`, mas é classificado como `CSP`.

**Falhas de operação** (o motor está bom, a operação não):

| Rótulo | Quando |
|---|---|
| **Falha na operação booleana** | extrusão/revolução/varredura/loft com união, corte ou interseção; furo; combinação de corpos |
| **Falha ao gerar o sólido** | demais operações; corpo sem sólido |
| **Falha na planificação** | planificação inválida; recorte da planificação |

Elas aparecem no aviso (`Falha na operação booleana — Peça 1 › Corte 2: …`) e na árvore, como antes. Se a regeneração inteira falhar (motor caiu, memória), aparece o diagnóstico com código.

## Testes

| Teste | Resultado |
|---|---|
| `diagnostics.test.ts` (12): cada código com a mensagem **real** do Chromium/Emscripten; precedência CSP > compilação; erro original preservado; mensagem ao usuário sem jargão; rótulos de operação | 12/12 |
| `engine_fail.py` (Chromium, build de produção, CSP estrita), 33 verificações. Para `.wasm` 404, `.wasm` corrompido, script do worker 404 e CSP sem `'wasm-unsafe-eval'`: (1) a falha é detectada; (2) o código é certo; (3) a tela diz que o 2D continua; (4) o erro original está no diagnóstico; (5) foi registrado no console; (6) os detalhes técnicos mostram código e etapa; (7) o 2D continua utilizável. Mais: recuperação com "Tentar novamente" e 6 inicializações seguidas | 33/33 |

**Sem teste de ponta a ponta:**
- `MEMORY` e `COMMUNICATION`: forçar falta de memória ou travar o worker sem alterar o app não é reprodutível aqui. A classificação é coberta por teste unitário com as mensagens reais.
- `OCCT_INIT`: é o caso residual.
