# FASE 3 — Modelagem paramétrica · Relatório técnico

Branch `feature/agtn-3d-ia` (sem merge na `main`). Commits da fase: `1dde23c`, `83a7921`, `ee8b64b`, `198efc7`,
`9aab93a` e o desta documentação.

## 1. Resumo

A peça paramétrica é uma lista ordenada de operações guardada no `.agtncad` (`extras.agtn3d`, fonte `part`).
Cada operação lê o sólido das anteriores e é regenerada pelo OCCT 8 real (WebAssembly, worker). O esboço tem
solver próprio em TypeScript. Edição de qualquer operação regenera as seguintes; referência perdida vira erro
explícito na operação, nunca troca silenciosa de face/aresta.

```
core/sketch      esboço: tipos, solver (Newton passo mínimo + análise de posto), edição, perfis/regiões
core/solid       features.ts (tipos + validação), part.ts (PartEvaluator: avaliação incremental, referências)
core/model3d     features.ts (inserir/editar/suprimir/recuar/excluir com dependentes), evaluate.ts (peças no cache)
apps/desktop/src/ws3d
  sketch/        editor.ts (ferramentas), overlay.ts (desenho no plano), SketchBar.tsx (faixa + cota)
  part/          FeatureDialog.tsx (painel + prévia), FeatureProps.tsx, partUi.ts
  Workspace3D    sessão de esboço, painel de operação, árvore, manipulador, modelo exibido recuado
```

## 2. Funcionalidades implementadas

### 2.1 Esboço 2D
- Planos XY, XZ, YZ (com deslocamento) e **faces planas** de peças (primitiva vira peça automaticamente).
- Ferramentas: linha (em cadeia, fecha no ponto inicial), retângulo, círculo, arco (3 pontos), ponto, aparar,
  estender, offset (pela posição do clique ou **distância exata**), cota, construção, excluir.
- Atalhos: L, R, C, A, P, T, E, O, D, Esc, Delete, Ctrl+Z / Ctrl+Y (histórico próprio do esboço).
- Restrições geométricas: coincidente, ponto sobre linha/círculo, ponto médio, horizontal, vertical, paralela,
  perpendicular, tangente, concêntrica, igual, fixo. Automáticas ao desenhar: H/V (±2°), ponto sobre curva,
  canto do retângulo coincidente com ponto existente (ex.: origem).
- Cotas: comprimento, distância (alinhada/horizontal/vertical), ponto–linha, raio, diâmetro, ângulo.
  Campo junto ao cursor, duplo clique na cota edita, o esboço se ajusta na hora.
- Estado de definição sempre visível: **Totalmente definido / Subdefinido (N GL) / Sobredefinido / Inconsistente**,
  cores por estado; restrição que tornaria o esboço inconsistente é **recusada** com o nome e o valor das
  restrições em conflito (ex.: "Em conflito: Comprimento 200 (D3), Distância X 50 (D9)").
- Editar esboço existente: duplo clique na árvore; a peça aparece recuada até ele; ao concluir, regenera tudo.
- Ao entrar no esboço a câmera fica normal ao plano; ao sair volta à vista anterior.

### 2.2 Solver
- Equações por restrição; Newton com passo de norma mínima `dx = −Jᵀ(JJᵀ+λI)⁻¹F` e busca em linha (mexe o mínimo).
- GL = n − posto (Gram-Schmidt incremental); pontos livres; redundantes ("sobredefinido"); inconsistência com
  busca dos conflitos por remoção.
- Desempenho: 40 retângulos definidos < 2 s (teste); esboços usuais em poucos ms.

### 2.3 Operações (todas OCCT real, parâmetros editáveis, prévia antes do OK)
| Operação | Parâmetros |
|---|---|
| Extrusão | esboço, regiões, um sentido / simétrica / dois sentidos, inverter, passante (corte), novo/unir/cortar/interseção, **seta arrastável** |
| Revolução | esboço, regiões, eixo (eixos do esboço ou linha), ângulo, resultado |
| Varredura | perfil, trajetória (cadeia de linhas/arcos), resultado |
| Loft | seções em ordem, regrado, resultado |
| Furo | centros = pontos/círculos do esboço, Ø, profundidade/passante, inverter, rebaixo, escareado |
| Arredondar / Chanfro | arestas escolhidas no modelo, raio / distância |
| Casca | faces abertas escolhidas, espessura |
| Espelhar | plano XY/XZ/YZ + deslocamento ou face plana; operações escolhidas ou corpo inteiro |
| Padrão linear / circular | operações, eixo X/Y/Z ou aresta/face cilíndrica, quantidade, passo/ângulo, inverter |
| União / Corte / Interseção | com outros corpos do modelo (ferramentas ficam ocultas e continuam editáveis) |

### 2.4 Árvore paramétrica
- `Peça N › Esboço_1, Extrusão_1, Esboço_2, Extrusão_2, Arredondar_1…` (nomes automáticos, renomeáveis).
- Estado por operação: ok, **erro (!) com a mensagem**, suprimida (riscada), recuada (esmaecida), tempo de
  regeneração. Barra de recuo azul; "avançar ao fim".
- Ações: editar (duplo clique), recuar até aqui, suprimir/reativar, excluir (bloqueado quando há dependentes,
  mostra quem usa; "Excluir com N dependente(s)" explícito). Painel "Operação" com parâmetros e estado.
- Undo/Redo do documento em tudo (cada OK, edição, supressão, recuo, exclusão é uma transação).

### 2.5 Referências estáveis
- Faces geradas são ancoradas na operação de origem (topo/fundo/lateral pela curva do esboço; faces de
  primitiva por nome) e recalculadas com os parâmetros atuais; demais faces por superfície + ponto.
- Aresta = interseção de duas faces referenciadas + ponto de desempate.
- Sem candidata → a operação falha com **"Referência perdida: …"**; a peça segue com o sólido anterior e as
  operações seguintes continuam sendo avaliadas.

## 3. Testes executados

| Conjunto | Resultado |
|---|---|
| `npm test` (Vitest) | **24 arquivos, 324 testes passando** (eram 264 na FASE 2) |
| `npm run typecheck` | OK (TypeScript estrito) |
| `npm run build` | OK |
| `tests/e2e/e2e_param.py` (Chromium, mouse/teclado reais) | **25/25** |
| `tests/e2e/e2e_param2.py` | **22/22** |
| `tests/e2e/e2e3d.py` (regressão FASE 2, inclui 2D) | **34/34** |
| `tests/e2e/tauri_param.py` — app Tauri **release instalado** (.deb, WebKitGTK) | **3/3** (esboço → extrusão 192 000 → cota 150 → 240 000) |
| `tests/e2e/tauri_compiled.py` — regressão FASE 2 no app compilado | **5/5** · memória 933 MB RSS (app + WebKit, render por software) |

Testes com geometria conhecida (unitários `core/solid/src/part.test.ts`, `core/model3d/src/part3d.test.ts` e e2e):

- Extrusão 120×80×20 = 192 000 mm³; corte passante Ø20 a partir da face = 192 000 − π·10²·20.
- Arredondar R5 na aresta vertical remove (25 − 25π/4)·20; cota 120 → 150 regenera furo e arredondamento:
  233 609,51 mm³ exatos, todas as operações "ok".
- Chanfro 2 mm × 150 mm; padrão linear 3 × 35 mm; furo Ø8,5 com rebaixo Ø15×5; padrão circular 4 × 360°;
  espelho no YZ + 50 mm (volume dobra); casca 3 mm com topo aberto = 100·60·40 − 94·54·37; união com corpo
  encostado (+8 000); revolução de anel π(80² − 40²)·60; varredura Ø10 × 100; loft regrado quadrado 40 → 20
  em 50 mm = 50/3·(1600 + 400 + 800). Tolerâncias ≤ 0,5 mm³ (loft/varredura ≤ 1 mm³).
- Falhas: raio impossível → erro do kernel na prévia e OK bloqueado; cancelar não altera; padrão com alvo sem
  sólido próprio → mensagem clara; referência perdida (retângulo trocado por círculo) → "Referência perdida".
- Undo/Redo (documento e esboço), supressão, recuo, excluir com dependentes, salvar/reabrir (`.agtncad` com o
  histórico; volume idêntico após regenerar do zero), cancelar esboço sem efeitos.
- Desempenho: 40 operações — regeneração completa **538 ms**, editar a última **23 ms** (cache incremental).
- 2D: teste de regressão REC no DESENHO dentro do `e2e3d.py` e toda a suíte unitária 2D/chapa/DXF/DWG passando.

Capturas: `tests/output/e2e_param/*.png` e `tests/output/e2e_param2/*.png` (geradas pelos scripts).
Instalador Linux desta fase: `.deb` 12,51 MiB (motor OCCT continua como recurso separado).

## 4. Limitações conhecidas

1. **Windows real ainda não validado** (pendência da FASE 2): o CI do GitHub está bloqueado por cobrança da conta.
   O binário Tauri release foi testado só no Linux (WebKitGTK).
2. Esboço em face exige peça paramétrica ou primitiva; sólido importado (STEP) entra só como ferramenta de
   combinação.
3. Sem projeção de arestas do modelo para o esboço (referências externas no esboço) e sem cotas dirigidas
   (só cotas que comandam).
4. Ferramentas de esboço ainda ausentes: elipse, spline, filete/chanfro 2D, espelho/padrão 2D, texto.
5. Manipulador visual só na profundidade da extrusão; demais valores pelos campos em mm.
6. "Espessar" (citado no plano original) não foi pedido nesta fase e não foi feito.
7. Seleção de região na extrusão é por lista (área de cada região), não por clique no viewport.
8. Prévia substitui o corpo inteiro (não mostra só a diferença em outra cor).
9. Numeração de faces/arestas segue a ordem do OCCT: a referência estável cobre edições de parâmetros e de
   esboço, mas mudanças topológicas grandes podem gerar "Referência perdida" (comportamento desejado: avisa).
