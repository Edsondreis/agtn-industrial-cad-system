# AGTN AI ASSISTANT — controle do CAD por conversa

Data: 2026-11-16 · Branch `feature/agtn-3d-ia` · versão de homologação 3.2.0-3 · `main` intocada · sem merge, tag ou Release.

## 1. Auditoria antes de implementar

- Não havia nenhum código de IA (confirmado; o `docs/PLANO_3D_IA.md` §1 já registrava "nenhum").
- Arquitetura: React/Vite no WebView2 + Rust/Tauri 2. A CSP (`tauri.conf.json`) só libera IPC no `connect-src`, ou seja,
  o WebView não fala com a internet. Por isso a chamada HTTP tem que sair do Rust, que é o desenho do plano.
- APIs reais encontradas e usadas pelas ferramentas:
  - `CadDocument.commit/addChanges/removeChanges/updateChanges` (uma transação desfazível por operação);
  - `CadController.sel/undo/zoomExtents`;
  - `@agtn/sheetmetal` `solveProfile/sectionEntities/flatPatternEntities/lookupK`;
  - `@agtn/geometry` `entityLength/polylineSignedArea/closestOnEntity/transformEntity`;
  - `FileActions.exportDxf`, a janela de Imprimir/PDF;
  - o motor 3D (worker) para volume/área/caixa B-rep.
- Provedor: Google Gemini **somente nível gratuito**, como decidido pelo Edson (12/11/2026).
  - A lista de modelos gratuitos foi conferida na página de preços do Google AI Studio em 16/11/2026: `gemini-3.8-flash`
    (padrão), `gemini-3.6-flash`, `gemini-3.5-flash-lite` e `gemini-3.1-flash-lite`.
  - Endpoint `v1beta/models/{modelo}:generateContent`: documentado e sem aviso de obsolescência em 16/11/2026.

## 2. Arquitetura

```
modules/ai (TS puro, sem UI/rede)      apps/desktop/src/ai                       src-tauri/src/ai.rs
  types · schema (validação)             tools.ts   ferramentas → APIs reais       chave: Gerenciador de Credenciais
  agent.ts  laço + permissões            controller.ts  estado do painel           HTTPS (ureq + rustls), só modelos
  gemini.ts provedor (só gratuito)       AiPanel.tsx  painel lateral recolhível      gratuitos, sem recurso pago,
  quota.ts  cota local                   transport.ts IPC → Rust                     limites de tamanho/tempo
```

Fluxo de um pedido:
1. O usuário escreve.
2. O modelo devolve chamadas de ferramenta.
3. O **núcleo** confere se a ferramenta existe e valida os argumentos: tipo, faixa, enum, campos a mais, NaN.
4. Ferramenta de leitura roda direto. Ferramenta de alteração calcula uma **prévia real** pelo motor e o laço **para**.
5. A interface mostra o cartão (título, medidas, miniatura e aviso de "altera o que já existe").
6. "Confirmar" aplica: uma transação `IA: …` no documento. Antes, confere se o desenho mudou desde a prévia; se mudou,
   **não aplica**.
7. O modelo recebe o **resultado real** (ids, rótulo da transação, erro) e responde.

O estado do aplicativo é relido a cada passo e enviado como "ESTADO ATUAL", que substitui o anterior.

Trocar de provedor no futuro: basta implementar `AiProvider` em `modules/ai`. As ferramentas e o CAD não mudam.

## 3. Ferramentas

| Ferramenta | O que faz no CAD (de verdade) | Permissão |
|---|---|---|
| `ler_documento` | contagens por tipo, extensão, camadas, seleção, desfazer, perfil em edição, corpos 3D | leitura |
| `ler_selecao` | medidas exatas da seleção (comprimento, raio, Ø, área de contorno fechado) | leitura |
| `medir_distancia` | entre dois pontos informados ou entre os 2 objetos selecionados (menor distância) | leitura |
| `calcular_area` | área exata de círculo, polilinha fechada com arcos, elipse completa | leitura |
| `info_solidos_3d` | volume/área/caixa B-rep com o **grau** (exato/inválido/não verificado/não calculável) e o motivo | leitura |
| `criar_perfil_chapa` | perfil L, U, Ue, Z, Ze, cartola, ômega pelo SHEET METAL → seção no desenho | prévia + confirmação |
| `editar_perfil_chapa` | muda espessura/medidas/raio/ângulo/comprimento; se já está no desenho, substitui os objetos | prévia + confirmação (destrutiva) |
| `gerar_planificacao` | blank com linhas de dobra, cotas e regiões; **exige K** informado ou autorização para o K da tabela do projeto | prévia + confirmação |
| `criar_chapa_retangular` | contorno fechado (com raio de canto opcional) na camada de corte | prévia + confirmação |
| `criar_folha_a4` | formato A4 (margens NBR 10068, legenda NBR 10582) em escala, opcionalmente sobre a seleção | prévia + confirmação |
| `mover_selecao` | desloca a seleção | prévia + confirmação (destrutiva) |
| `apagar_selecao` | apaga a seleção (desfazível) | prévia + confirmação (destrutiva) |
| `exportar_dxf` | abre a janela de salvar e grava o DXF; só diz "exportado" com o caminho real | prévia + confirmação |
| `exportar_pdf` | abre a janela de Imprimir/PDF (o PDF existe só depois que o usuário concluir) | prévia + confirmação |
| `desfazer_ultima_operacao` | o mesmo Ctrl+Z do CAD | direta (reversível) |
| `enquadrar_desenho` | zoom extensão | direta (reversível) |

**Ainda não integradas:**
- operações 3D de modelagem (criar/editar sólidos, features);
- edição genérica de entidades: trim, offset, fillet, cotas;
- planificação de bandeja e calandra pela IA;
- seleção de pontos na tela pela IA;
- DWG.

A IA recusa esses pedidos dizendo que a ferramenta não existe.

## 4. Segurança e permissões

- O modelo não tem acesso ao sistema operacional, terminal, arquivos, rede ou execução de código. Só existem as
  ferramentas da tabela. Nome desconhecido ou argumento inválido volta como erro, e isso está testado.
- Ferramenta de leitura que tentar devolver prévia é bloqueada, porque o risco declarado manda.
- Nada que altera o documento roda sem "Confirmar". Recusar devolve "cancelado pelo usuário" ao modelo.
- Cancelar (botão durante "Pensando…", ou com prévia pendente) interrompe e não aplica nada.
- Limite de 8 passos por pedido.
- Chave da API:
  - fica no Gerenciador de Credenciais do Windows (`keyring`, serviço "AGTN Industrial CAD");
  - não fica no JS, no `.agtncad`, no código nem em log;
  - o Rust nunca a devolve; o painel só pergunta *se* existe;
  - vai no cabeçalho `x-goog-api-key`, nunca na URL;
  - mensagens de erro passam por `redact`.
- O Rust recusa modelo fora da lista gratuita e corpo que declare recurso pago (busca, cache, execução de código, mapas).
- O que sai do computador:
  - o texto do usuário;
  - um resumo mínimo (contagens por tipo, extensão, seleção, camada atual, perfil em edição, nº de corpos 3D);
  - os resultados das ferramentas.
  - **Nunca** sai o arquivo, o nome dele, pastas ou geometria completa. Testado: o contexto não tem caminho nem nome de
    arquivo.
- Privacidade do nível gratuito: o aviso aparece obrigatoriamente no primeiro uso e exige consentimento (no nível
  gratuito o Google pode usar o conteúdo para melhorar produtos e revisores humanos podem ler). Sem consentimento, nada
  é enviado.

## 5. Configuração (no app instalado)

1. Criar a chave no Google AI Studio num projeto **sem faturamento** (sem cartão). Sem faturamento o Google não cobra:
   ao acabar a cota ele devolve 429 e o AGTN espera.
2. AGTN → **Assistente** → engrenagem:
   - ler o aviso e marcar o consentimento;
   - colar a chave → **Guardar**;
   - escolher o modelo, só entre os gratuitos;
   - ajustar os limites locais (padrão: 5 por minuto e 100 por dia).
3. Precisa de internet. Sem chave, sem rede ou sem cota, o painel avisa e o CAD continua normal.

## 6. Cota e custos

- **Custo: zero.** Só modelos gratuitos, sem recurso pago, e a chave é de projeto sem faturamento.
- Cota local conferida **antes** de enviar.
- 429 do Gemini: o AGTN lê o `RetryInfo`; se for limite diário, espera até a meia-noite do Pacífico. Bloqueia até lá e
  não repete em loop.
- Os limites reais por modelo não estão publicados na documentação. Ficam no console do AI Studio, por projeto, e por
  isso os limites locais são configuráveis.
- Peso no programa:
  - o assistente só é carregado quando o painel é aberto: na abertura, +2,6 kB (518,1 → 520,7 kB);
  - o painel em si soma 60 kB;
  - memória JS de uma conversa inteira com inserções: +2,3 MB;
  - sem processo ou worker extra.

## 7. Testes (todos sem rede)

| Suíte | Resultado |
|---|---|
| `modules/ai/src/ai.test.ts` — validação, permissões, prévia/confirmação, cancelamento, cota, contexto relido, formato real do Gemini (`thoughtSignature`, `functionCall`/`functionResponse`, 429/`RetryInfo`, erros) | **26/26** |
| `apps/desktop/src/ai/tools.test.ts` — CAD real: diálogo do exemplo inteiro (perfil U → seção → K perguntado → K do projeto → blank → Ctrl+Z), edição com substituição, chapa/área exata, mover/apagar, prévia velha não aplica, distância, A4, exportação real/cancelada, 3D exato × inválido | **11/11** |
| `apps/desktop/src/ai/controller.test.ts` — consentimento, fluxo, cancelar (pendente e durante a espera), modelos só gratuitos, persistência | **6/6** |
| `src-tauri/src/ai.rs` (cargo test, servidor HTTP local) — só gratuitos, recurso pago recusado, sem chave, chave no cabeçalho, 429 repassado, tempo esgotado/rede, chave nunca em erro | **8/8** (Linux) |
| E2E Chromium `tests/e2e/e2e_ai.py` — painel real com modelo roteirizado | **20/20** |

Regressão completa: vitest 776 ok, `test:sem-eval` igual, typecheck ok, e2e_step 40/40, produção + CSP 114/114,
e2e3d 34/34, e2e_sheet 18/18. Nenhum `unsafe-eval`; CSP inalterada.

## 8. Limitações

- **Não testado com o Gemini real**: sem chave nem PC Windows nesta sessão. O formato foi conferido com a documentação
  de 16/11/2026 e coberto por testes de contrato. O primeiro uso real deve ser acompanhado.
- **O Rust da IA foi compilado e testado no Linux**, num crate isolado. A ligação com o Tauri (`lib.rs`) e o
  `keyring/windows-native` só compilam no build MSVC do Windows. Isso precisa entrar no próximo ciclo do instalador.
- A qualidade das respostas depende do modelo gratuito. As ferramentas impedem ação errada, mas o modelo pode entender
  mal um pedido: por isso existe a prévia.
- Conversa por sessão, sem gravação no projeto. Ao trocar de modelo, a conversa recomeça.
- Cancelar não interrompe a requisição HTTP já em voo no Rust: a resposta é descartada ao chegar.
