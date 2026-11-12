# AGTN 3D + AGTN AI ASSISTANT — Auditoria (FASE 1) e plano de implementação

Data: 12/11/2026 · Base auditada: `main` @ 23a2540 (v3.1.1)

Este documento é a entrega da FASE 1 (nenhum código existente alterado).

**Decisões do usuário (12/11/2026):** motor OCCT 8 em WASM · IA = **somente Google Gemini, nível gratuito** ·
modelo 3D dentro do `.agtncad` (extras) · solver de restrições próprio em TypeScript.

**FASE 2 concluída (12/11/2026, branch `feature/agtn-3d-ia`):** `core/solid` (kernel, topologia exata, medição,
STEP de montagem), `core/model3d` (árvore, persistência, undo/redo, cache de regeneração) e área 3D completa
(`apps/desktop/src/ws3d`). Evidências: 264 testes unitários, 34 verificações de ponta a ponta no Chromium
(`tests/e2e/e2e3d.py`), carga com 38 perfis (`tests/e2e/load3d.py`) e 5/5 no binário Tauri release instalado
(`tests/e2e/tauri_compiled.py`, Linux/WebKitGTK). Build Windows pelo CI bloqueado por cobrança da conta GitHub.

---

## 1. Estado atual (medido, não estimado)

| Verificação | Resultado |
|---|---|
| `npm test` | 15 arquivos, **202 testes passando** |
| `npm run typecheck` | OK (TS estrito) |
| `npm run build` | OK — bundle principal 402 kB (126 kB gzip) |
| Código 3D existente | **Nenhum**. Nenhuma dependência de three/WebGL/OCCT. Só a decisão D8 (planejada) |
| Código de IA existente | **Nenhum** |

### 1.1 Arquitetura atual

```
apps/desktop      React 19 + Vite 8 (UI), CadController, ferramentas (máquinas de estado), Renderer Canvas 2D
  src-tauri       Rust/Tauri 2: E/S atômica, recuperação, DWG (acadrust 0.6.8, MPL-2.0), programa padrão
modules/          dxf · sheetmetal · parts · lasertext · plot   (puros, testados em Node)
core/document     CadDocument: Map + R-tree (rbush), transações Change[] before/after, undo 500, extras, eventos
core/geometry     motor 2D puro (Vec2, entidades imutáveis, interseções, snap, offset, trim, curvas NURBS)
```

Regra que funciona e deve ser mantida: **dependências só descem; nada em `core/` ou `modules/` importa React, DOM ou Tauri.**

### 1.2 Pontos de integração encontrados

- **Documento** (`core/document/src/document.ts`): `commit(label, Change[])` = 1 transação desfazível. Existe o tipo
  `Change { kind: "extra"; key; before; after }` → dados de módulo entram no Undo/Redo sem mexer no núcleo.
  Falta: agrupar várias operações em **uma** transação (necessário para "desfazer o pedido inteiro da IA").
- **Formato `.agtncad`** (`native.ts`): JSON v1; `extras` é preservado na leitura e gravação. Versões 3.1.x antigas
  abrem um arquivo com dados 3D em `extras` e **não perdem** esses dados ao salvar.
- **Entidades** são estritamente 2D (`Vec2`). O modelo 3D **não** deve entrar na união `Entity` (quebraria DXF, plot,
  snap, R-tree). Fica em modelo próprio.
- **Comandos** (`cad/commands.ts`): registro com id, apelidos e fábrica de ferramenta interativa; `ctl.actions`
  mapeia comandos de ação. Bom para atalhos; **não** serve como API da IA (é orientado a clique/ponto).
- **Áreas de trabalho** (`ui/Chrome.tsx`): `"desenho" | "planificacao" | "pecas"` → entra `"3d"`.
- **SheetMetal**: `solveProfile` / `solveTray` já calculam seção (faces, eixo neutro) e planificação → base exata da
  chapa 3D e do vínculo 3D ↔ planificação.
- **CSP** (`tauri.conf.json`): `script-src 'self'` **bloqueia WebAssembly** → precisa de `'wasm-unsafe-eval'`.
  `connect-src` só IPC → chamadas HTTP da IA devem ir pelo Rust (o que também é o desenho correto por segurança).
- Arquivos grandes a não engordar: `App.tsx` (646), `controller.ts` (866), `SheetMetalWorkspace.tsx` (974).
- CI: testes em Ubuntu + build NSIS/MSI em `windows-latest`. Sem toolchain C++/CMake extra hoje.

---

## 2. Motor geométrico 3D — avaliação

Requisito: B-Rep real (não malha), booleanas, fillet, chanfro, shell, sweep, loft, STEP, projeção para 2D,
distribuição sem instalação externa, uso comercial.

| Opção | Licença | Prós | Contras |
|---|---|---|---|
| **A. OCCT 8 em WASM (`occt-wasm` 5.17)** no WebView, em Web Worker | wrapper MIT/Apache; WASM LGPL-2.1 (OCCT) | Mesmo processo da UI; roda em Node → testes no Vitest como o resto do `core`; sem C++ no CI; STEP/XCAF (montagens e nomes), BREP binário, HLR (linhas visíveis/ocultas), operações "WithHistory" | 21 MB (≈4,5 MB brotli); mantenedor único (projeto de 2026); **sem IGES** no build oficial; WASM ~1,5–3× mais lento que nativo |
| B. OCCT nativo via Rust (`cadrum` 0.8, OCCT 8 estático) | MIT + OCCT LGPL | Desempenho nativo, multithread | IPC a cada operação; link **estático** de LGPL obriga a fornecer objetos para relink; testes de geometria só em Rust; build mais pesado |
| C. replicad + opencascade.js próprio | MIT + LGPL | Projeto desde 2021, API de alto nível | Build OCCT 7.x; 48 MB; API de "código-CAD", menos controle de topologia |
| D. Manifold / truck | Apache | Leves | Manifold = malha (proibido pelo requisito); truck imaturo (fillet/shell/STEP limitados) |

### Prova de viabilidade executada (Node, `occt-wasm` 5.17.1)

- Inicialização do kernel: **132 ms**.
- Chapa 500×300×10 com 4 furos Ø20 a 30 mm das bordas (booleana real): volume 1 487 433,6294 mm³,
  erro vs. fórmula **2×10⁻¹⁰ mm³**; sólido válido; 10 faces, 24 arestas.
- STEP exportado (29,9 kB) e reimportado: volume idêntico.
- Projeção HLR retorna arestas visíveis/ocultas separadas (base das vistas 2D).
- Tanque 2000×1500×1200, chapa 4, tampa aberta (shell): volume **exato** com espessura +4 (para dentro).
  Atenção: espessura negativa cresce para fora e, com junta "arco", arredonda cantos → a ferramenta da AGTN vai
  fixar o sinal e a junta "interseção" e testar isso.
- Uma sequência fillet → chanfro em arestas vizinhas falhou com `KERNEL_ERROR` → o produto precisa de mensagens de
  erro claras e de rollback da operação (previsto na árvore paramétrica).

### Recomendação: **Opção A**, isolada atrás de uma interface própria

- `core/solid` define `SolidKernel` (interface TS). Implementação `OcctWasmKernel`. Se um dia for preciso, troca-se por
  nativo (B) sem tocar em UI, documento ou IA.
- Versão fixada (`=5.17.1`) e o `.wasm` versionado no repositório (não depende do npm no futuro).
- **LGPL**: o `.wasm` vai como arquivo separado em `resources/` do instalador (não embutido no `.exe`), carregado em
  tempo de execução → o usuário pode substituí-lo (exigência da LGPL); aviso + link do código-fonte em `TERCEIROS.md`.
- **IGES**: fica para depois — compilar o `occt-wasm` com TKDEIGES (scripts públicos) quando o STEP estiver pronto.

---

## 3. Arquitetura proposta

```
apps/desktop/src/
  three/            Viewport 3D (three.js, MIT): câmera, órbita, ViewCube, grade 3D, seleção por ID de face/aresta
  ws3d/             Área AGTN 3D: árvore de features, propriedades, barra de ferramentas 3D
  ai/               Painel AGTN AI ASSISTANT (UI apenas)
core/
  solid/      NOVO  SolidKernel (interface) + OcctWasmKernel (worker) + malha para o viewport
  model3d/    NOVO  Documento 3D: peças, features paramétricas, sketches, montagens, regeneração, serialização
  sketch/     NOVO  Sketch 2D em plano + solver de restrições
  document/         + transação agrupada (begin/end) — mudança aditiva
modules/
  drawing/    NOVO  Vistas 2D a partir do 3D (HLR) → entidades do core/geometry, associativas
  io3d/       NOVO  STEP/STL/OBJ (e 3MF) — malha ≠ sólido, sempre identificado
  ai/         NOVO  Provedores (interface), contexto do documento, registro de ferramentas tipadas, validação,
                    níveis de risco, transações, histórico. Sem UI, sem rede direta
src-tauri/          + comandos: ai_chat_stream (HTTP com streaming), credenciais (Windows Credential Manager)
```

Fluxo exigido no pedido, garantido pela estrutura: **IA interpreta/planeja → ferramenta tipada valida → motor CAD
calcula → documento registra (transação) → Undo/Redo**.

### 3.1 Persistência 3D
- Modelo 3D em `extras["agtn3d"]` do `.agtncad` (formato continua v1, compatível com 3.1.x).
- Peças paramétricas: árvore de features em JSON (regenerável). Corpos importados de STEP: BREP binário em base64.
- Malhas (STL/OBJ) ficam marcadas como `mesh` — nunca aparecem como sólido CAD.
- Teste obrigatório: criar → salvar → reabrir → regenerar → mesmo volume/área/bbox.

### 3.2 Paramétrico e nomeação topológica
- Cada feature guarda parâmetros e referências. Referências a arestas/faces usam **seletores geométricos estáveis**
  (ex.: "arestas verticais da face +Z", "face plana de normal −Y") + histórico do OCCT. Quando uma referência some
  após edição, a feature fica em erro com aviso — nunca escolhe outra aresta em silêncio.

### 3.3 Chapa 3D ↔ planificação
- Feature "Chapa" criada a partir dos parâmetros do `SheetMetalEngine` (perfil L/U/Z…, bandeja): o sólido 3D é gerado
  da seção calculada; a planificação vem do mesmo motor → sempre válida.
- Sólido qualquer **não** recebe planificação. O sistema informa que a geometria não é desenvolvível pelo motor atual.

### 3.4 IA — Google Gemini, somente nível gratuito (decisão do usuário, 12/11/2026)

**Provedor único: Gemini API (Google AI Studio), Free Tier.** Sem Claude API, sem Ollama/modelos locais, sem
qualquer serviço que gere cobrança. A interface de provedor continua existindo no código (boa arquitetura), mas só o
Gemini é implementado e habilitado.

Garantia de custo zero — como funciona de verdade:
- O nível gratuito do Gemini vale para projetos Google **sem faturamento (Cloud Billing) ativado**. A chave tem que ser
  criada no AI Studio num projeto sem cartão/faturamento. Sem faturamento, o Google não tem como cobrar: ao estourar a
  cota a API só devolve **HTTP 429** (`RESOURCE_EXHAUSTED`).
- O programa **não consegue consultar** pela API se o projeto da chave tem faturamento. Por isso: na configuração da
  chave o AGTN mostra o aviso "use uma chave de projeto SEM faturamento" e uma confirmação do usuário.
- O AGTN **nunca** troca de modelo sozinho para um modelo pago, nunca usa recursos pagos (grounding/busca, cache de
  contexto, Batch, imagem/vídeo). Lista de modelos permitidos = modelos com "Free of charge" na tabela de preços;
  o usuário escolhe entre eles. Lista revisável por atualização do programa (o Google muda os modelos com frequência).
- Controle local de cota por modelo: contadores de requisições por minuto (RPM), por dia (RPD, renova à meia-noite
  do Pacífico) e tokens por minuto (TPM), com limites configuráveis (padrão conservador). Antes de enviar, se o
  contador local diz que vai estourar, o assistente avisa e espera — não envia.
- Ao receber 429: lê o `RetryInfo` (tempo de espera) da resposta, mostra "Cota gratuita esgotada — aguardando
  renovação (hh:mm)" e **não repete em loop**. Cota diária esgotada → assistente pausado até a renovação; o CAD segue
  funcionando normal.
- Painel mostra o consumo do dia (requisições e tokens estimados) por modelo.

Privacidade (importante para desenhos industriais):
- Pelos termos do Google, conteúdo enviado no **nível gratuito pode ser usado para melhorar produtos do Google e pode
  ser lido por revisores humanos**; o próprio Google orienta não enviar informação confidencial no nível gratuito.
- Por isso: na primeira utilização o AGTN mostra esse aviso e pede consentimento explícito. O contexto enviado é o
  mínimo necessário (resumo estruturado: contagens, seleção, cotas, dimensões) — nunca o arquivo inteiro, nunca nome
  de cliente/pasta, salvo se o usuário mandar no próprio texto. Opção "modo restrito": só dimensões da seleção.

Segurança:
- Chamadas HTTP feitas no **Rust** (streaming `streamGenerateContent` via canal Tauri). A chave fica no **Gerenciador
  de Credenciais do Windows** (crate `keyring`), nunca no JS, no `.agtncad`, no código ou no executável.
- Function calling do Gemini → ferramentas tipadas do AGTN com validação; níveis `leitura`, `simples` (executa direto,
  desfazível), `destrutiva/grande` (prévia + confirmação). Cada pedido = 1 transação. Interromper cancela e desfaz o
  parcial.
- Sem internet, sem chave ou sem cota: o CAD funciona normal; o painel oferece um interpretador local determinístico
  de comandos simples (retângulo, círculo, furos, mover, desfazer) — testado e sem rede.

---

## 4. Fases (cada uma: implementar → testar → corrigir → só então avançar)

| Fase | Entrega verificável | Critério de aceite |
|---|---|---|
| 2 — Fundação 3D | `core/solid` + worker, viewport three.js, órbita/pan/zoom, ViewCube, 7 vistas, grade/eixos, modos arame/sombreado/sombreado+arestas, primitivas (caixa, cilindro, esfera, cone, toro, plano, tubo, perfil), seleção face/aresta/vértice/sólido, medição, persistência | volume/área/bbox testados contra fórmula; salvar/reabrir idêntico; CSP com WASM; build Windows com `.wasm` em resources |
| 3 — Modelagem | sketch em XY/XZ/YZ e faces planas, solver de restrições, extrusão, revolução, sweep, loft, booleanas, fillet, chanfro, shell, furo, padrões, espelho, espessar, árvore paramétrica com edição e regeneração, undo/redo | cada operação com teste de volume/topologia; edição de feature anterior regenera dependentes |
| 4 — Industrial | chapa 3D via SheetMetal + planificação vinculada, perfis U/L/tubo, flanges, tanques/tampas, montagens (restrições, BOM, interferência, vista explodida), STEP com montagem/nomes, STL/OBJ | STEP reimportado no próprio app e conferido; planificação 3D = planificação 2D atual |
| 5 — Fundação IA | `modules/ai`, provedor Gemini (free tier), controle de cota, Rust streaming, credenciais, painel, contexto, ferramentas de leitura | testes com provedor simulado (sem rede) e contrato de cada ferramenta |
| 6 — IA operando | ferramentas de escrita 2D/3D, confirmação, cancelamento, transação por pedido, referências contextuais | testes de ponta a ponta: frase → ferramentas → geometria → undo restaura |
| 7 — Integração | vistas 2D associativas do 3D (HLR + cotas), desempenho, retrato/CNC, atalhos | desenho atualiza quando o modelo muda |
| 8 — Auditoria final | testes, typecheck, build, instalador limpo | relatório final (itens 1–12 do pedido) |

Estimativa honesta: isto é trabalho de várias sessões longas por fase. Cada fase sai como PR próprio
(versões 3.2, 3.3…), sem quebrar o 2D.

---

## 5. Riscos conhecidos

1. Mantenedor único do `occt-wasm` → mitigado por versão fixada, `.wasm` no repo e interface `SolidKernel`.
2. Solver de restrições de sketch é a peça mais difícil do paramétrico.
3. Nomeação topológica (edição de feature anterior quebra fillets) → seletores estáveis + erro explícito.
4. Gemini gratuito: cotas baixas e mudanças frequentes de modelos/limites pelo Google; dados do nível gratuito podem
   ser usados pelo Google. A validação das ferramentas impede que um erro do modelo vire geometria errada.
5. Tamanho do instalador: +~22 MB (WASM) +~0,7 MB (three.js).
