# Changelog

## Em desenvolvimento (branch `feature/agtn-3d-ia`, não publicado) — FASE 4 · ETAPA 2: recursos de chapa 3D
- **Aba de borda** (antes "Aba lateral"): recuos de início e fim (faixa parcial); posição do material (por dentro,
  por fora, dobra por fora); várias arestas; cantos detectados e mostrados no painel.
- **Alívio de dobra** (retangular, oblongo, lágrima): automático w = T + g, d = SB + g; folga editável na operação
  e em Preferências (0,5 mm, não é norma).
- **Canto**: sobreposto, encosto e esquadria com folga, para qualquer θ e ângulo do canto (mesmas regras da
  bandeja 2D). Alívio de canto redondo: bloqueado com mensagem.
- **Recorte plano**: recorte desenhado na planificação que atravessa dobras (retangular, oblongo alinhado, lados
  paralelos/perpendiculares à dobra). Círculo, arco ou lado oblíquo dentro da faixa: bloqueado com mensagem.
- **Desdobrar / Redobrar** na árvore: θ nominal e BA intactos; redobrar volta exatamente à peça.
- **DXF chapa**: DXF direto da planificação (2000 padrão, R12 opcional), camadas CUT_OUTER/CUT_INNER/BEND_UP/
  BEND_DOWN/BEND_MARK/BEND_REGION/REFERENCE; o arquivo é relido e conferido antes de gravar. O DXF do DESENHO não
  mudou (bytes idênticos).
- Faixa da Chapa em grupos CHAPA / RECURSOS / DOBRAR.
- Corrigido: furo poligonal numa aba de chapa falhava (só o circular funcionava); caixas de seleção brancas e
  ilegíveis no app Linux (WebKitGTK); rótulo "Material" repetido na base de chapa.

## Em desenvolvimento (branch `feature/agtn-3d-ia`, não publicado) — FASE 4 · ETAPA 1: Sheet Metal 3D
- Aba **Chapa** na faixa 3D:
  - **Base de chapa**: contorno do esboço; T, material, processo, raio; K da tabela material × processo × R/T com a origem, ou manual.
  - **Aba lateral**: escolhida clicando a aresta no modelo; uma por aresta; canto aberto automático.
  - **Flange de contorno**: perfil de seção constante numa aresta reta, calculado pelo motor de perfis do 2D.
  - **Dobra** por linha de esboço.
  - **Recorte/furo** na aba.
- O ângulo mostra θ (dobra) e α (interno) juntos; o arquivo guarda só θ.
- Sólido 3D e planificação saem do MESMO grafo e das mesmas fórmulas do AGTN SHEET METAL 2D.
- Conferências em toda regeneração: volume pela fórmula, espessura, ângulo medido, interferência entre abas (erro com as abas e o volume) e proveniência das faces.
- **Dobrado | Planificado** no viewport. Painel com blank, área, corte, massa e a tabela D1…Dn (θ, α, R, K, BA, BD).
- **Enviar ao DESENHO** nas camadas de corte, dobra e marcação do 2D.
- `.agtncad`: campos desconhecidos (versão mais nova) são preservados ao salvar. Operação desconhecida aparece como erro claro e continua no arquivo.
- Campo numérico não regrava o valor antigo ao perder o foco sem digitação.

## Em desenvolvimento (branch `feature/agtn-3d-ia`, não publicado) — Auditoria da FASE 3
- Operação depois de uma falha não fica mais "ok" sobre o sólido antigo: estado **"não avaliada (dependência
  com erro)"**; dependente de operação suprimida é suprimido junto; faixa no viewport e nota nas propriedades
  quando o sólido exibido é o último válido.
- Referências de face/aresta não trocam de entidade em silêncio (faces coplanares): "Referência ambígua"
  quando não há escolha segura; bordas de furo podem ser escolhidas e acompanham o furo movido.
- Esboço: ângulos de 0°/180° e distância ponto–linha sem falso "sobredefinido"; "Não convergiu" separado de
  "Inconsistente"; esboços grandes ~50× mais rápidos.
- Corrigido vazamento de formas do motor a cada regeneração; arquivo com ids duplicados ou campos ausentes
  abre com aviso em vez de perder o corpo.
- Avisos: união que gera sólidos separados e corte que não remove material.

## Em desenvolvimento — AGTN 3D, modelagem paramétrica
- **Peça paramétrica** com histórico no `.agtncad`: faixa **Modelar** com Esboço, Extrusão, Revolução, Varredura,
  Loft, Furo (passante, rebaixo, escareado), Arredondar, Chanfro, Casca, Espelhar, Padrão linear/circular e
  União/Corte/Interseção com outros corpos. Prévia real (OCCT) antes do OK; erro do kernel mostrado no painel.
- **Esboço** em XY/XZ/YZ (com deslocamento) ou face plana: linha, retângulo, círculo, arco, ponto, aparar,
  estender, offset (distância exata), construção; restrições (coincidente, H, V, paralela, perpendicular,
  tangente, concêntrica, igual, ponto médio, fixo) e cotas (comprimento, distância X/Y/alinhada, raio,
  diâmetro, ângulo, ponto–linha). Estado totalmente/sub/sobredefinido/inconsistente; conflito recusado com
  o nome das restrições.
- **Árvore de operações**: editar (duplo clique), recuar até aqui, suprimir, excluir com dependentes, renomear;
  erros por operação ("Referência perdida: …" quando a face/aresta deixa de existir — nunca troca sozinha).
- Seta arrastável para a profundidade da extrusão; vista volta à anterior ao sair do esboço.
- Faixa 3D em abas **Modelar** / **Corpos** (primitivas, montagem, arquivo e vistas).

## Em desenvolvimento — AGTN 3D, fundação
- Nova área **3D** (aba 3D, Start Center → Modelo 3D, comando `3D`): motor B-Rep **OCCT 8** em WebAssembly num
  Web Worker; o `.wasm` vai como recurso separado do instalador (`occt/occt-wasm.wasm`), fora do `.exe`.
- Viewport: órbita em torno do ponto clicado, pan (meio/direito), zoom no cursor, enquadrar (F / Shift+F),
  7 vistas (teclas 1–7), ViewCube clicável (faces, arestas, cantos, setas para faces vizinhas, giro 90°),
  ortográfica/perspectiva (P), grade adaptativa (G), eixos e tríedro, sombreado / sombreado com arestas / arame.
- Seleção de corpo, face, aresta e vértice pelos índices topológicos reais do OCCT; filtro inteligente.
- Propriedades exatas: área, tipo de superfície, raio, eixo, normal, comprimento de aresta, coordenadas;
  volume, área, massa por material, centro de massa, caixa envolvente.
- Medir (M ou Ctrl+clique): distância mínima exata, ΔX/ΔY/ΔZ, ângulo, folga entre planos paralelos.
- Árvore de componentes com conjuntos/subconjuntos: selecionar, ocultar (H / Shift+H), renomear (F2),
  enquadrar, agrupar (Ctrl+G), duplicar (Ctrl+D), excluir; posição relativa ao conjunto.
- Primitivas paramétricas editáveis: caixa, cilindro, esfera, cone, toro, plano, tubo, perfis L, U, I,
  tubo retangular e barra chata.
- STEP (importar/exportar com montagem e nomes), STL (malha). Modelo 3D salvo no `.agtncad` (`extras.agtn3d`),
  compatível com a 3.1.x; Undo/Redo em todas as edições. Layout para tela vertical.
- Motor liberado 2 min depois de sair da área 3D (devolve ~130 MB ao 2D).

## 3.1.1 — Tela na vertical (retrato)
- Layout automático para monitor girado (`@media (orientation: portrait)` em `styles.css`): troca sozinho quando
  a janela fica mais alta que larga e volta ao girar de novo; paisagem fica idêntica (conferido pixel a pixel).
- Barra de cima em duas linhas (ferramentas em cima; DESENHO / PLANIFICAÇÃO / PEÇAS em abas largas embaixo);
  rótulos de botão ocultos, só ícones.
- DESENHO: prancheta em cima, Propriedades e Camadas lado a lado embaixo.
- PLANIFICAÇÃO e PEÇAS: vistas em cima, os dois painéis lado a lado embaixo (antes a 3ª coluna saía da tela).
- Barra de status rola de lado em vez de cortar; Start Center em uma coluna; impressão e atalhos em uma coluna.
- Largura mínima da janela 1024 → 640 px (para 1080×1920 com escala de 125%/150% do Windows).
- Conferido em 1080×1920, 864×1536 e 720×1280.

## 3.1.0 — Bandejas e bandejas enrijecidas na planificação
- **Bandeja** (`solveTray`, `modules/sheetmetal/src/tray.ts`): abas nas 4 bordas (comprimento por aba, 0 = sem
  aba), medidas externas ou internas, **ângulo das abas** qualquer (evasê para fora ou para dentro).
- **Bandeja enrijecida**: pestana (retorno) por borda, ângulo próprio, para dentro ou para fora.
- **Cantos**: sobreposto, encosto (fechado), **esquadria** (meia-esquadria, plano bissetor — para abas inclinadas)
  e aberto; lado que fecha o canto e folga de solda. Pestanas sempre em esquadria quando as duas vizinhas têm.
- **Alívio**: retangular (natural) ou **furo redondo** no cruzamento das linhas de dobra (Ø automático ou
  informado; polígono menos círculo com arcos no contorno).
- Saída igual aos perfis: `CONTORNO_CORTE`, `LINHAS_DOBRA`, `REGIAO_DOBRA`, marcação `D# CIMA/BAIXO θ RI`
  legível (0°/90°) na ordem de dobra (pestanas → abas cobertas → abas que fecham), cotas de batente; DXF R12.
- Vista: planta (projeção de abas e pestanas, mostra o canto) + seções ao longo de A e de B pelo motor de perfis,
  com cotas EXT/INT.
- Painel: blank, fundo, peso líquido, corte, tabela das abas/pestanas (reto e avanço), θ, Ri/K, BA, altura
  vertical, ordem de dobra.
- `subtractCircle`; verificação de sobreposição na chapa plana.
- Gabarito real `bandeja_710.0CUH25-01-03.dxf` reproduzido exatamente; retos conferidos contra `solveProfile`;
  202 testes.

## 3.0.0 — Impressão/PDF, elipse/spline/hachura, DXF 2000, arrastar e soltar, perfis Z/cartola/ômega
- **Imprimir / PDF** (`@agtn/plot`, comando `PLOT`/`IMPRIMIR`/`PDF`, Ctrl+P): folha, orientação, área
  (tudo/tela/janela), escala (ajustar ou 1:N), centralizar, margem, cores, espessuras. PDF 1.4 vetorial próprio
  (Helvetica WinAnsi, recorte na área) e SVG para a impressora do sistema (página CSS do tamanho da folha).
- **Entidades novas** em `core/geometry` (`curves.ts`): `ellipse`, `spline` (B-spline/NURBS, de Boor;
  interpolação por pontos de ajuste igual ao AutoCAD), `hatch` (contornos com bulge, sólida ou padrão,
  regra par-ímpar). Desenho, seleção, snap (centro/quadrantes/extremidades), alças, propriedades, transformações
  (inclusive afim não uniforme), explodir, stretch, formato `.agtncad`.
- Comandos `EL`/`ELIPSE` e `H`/`HACHURA`; texto com várias linhas (`\n`).
- **Leitura DXF**: `ELLIPSE`, `SPLINE`, `HATCH` (arestas linha/arco/elipse/spline, padrões, degradê como sólida),
  `MTEXT` com `\P` e ponto de anexação, `SOLID`/`TRACE`, `LEADER`, `ACAD_TABLE`, `POLYLINE` 3D plana,
  espessura de linha (370) dos objetos.
- **Escrita DXF 2000** (`writer2000.ts`): handles, BLOCK_RECORD, layouts, dicionários; LWPOLYLINE, ELLIPSE, SPLINE,
  HATCH, MTEXT, `$INSUNITS`, 370. R12 converte as curvas novas em polilinhas/linhas. Exportar DWG usa DXF 2000.
- **Arrastar e soltar** (evento nativo do Tauri): abre arquivo; vários → conversor; conversor aberto → lista.
- **Planificação**: perfis Z, Z enrijecido, cartola, ômega; motor aceita face diferente em cada ponta da aba
  (`faceEnd`) para medidas de fora a fora em dobras de sentidos opostos; tabela de abas com medida
  externa/interna por ponta.
- **CI**: assinatura de código opcional (`windows/sign.ps1`, secrets `SIGN_COMMAND` ou PFX) + `signtool verify`.

## 1.1.0 — DWG próprio, conversor DWG ↔ DXF e programa padrão
- **Conversor DWG próprio, embutido** (`cadconv.rs`, motor acadrust MPL-2.0): nada para instalar. DWG R12 até
  2018 — abrir (Ctrl+O, recentes, duplo clique), importar, exportar. Validado contra DXF gerado pelo AutoCAD.
- **Converter DWG ↔ DXF** no Start Center (e em Arquivo/Ferramentas, comando `CONVERTER`): vários arquivos,
  inverter/forçar DXF/forçar DWG, versão R12–2018, pasta de destino, sem alterar os originais.
- **Programa padrão**: o instalador pergunta se `.dwg` e `.dxf` devem abrir no AGTN Industrial CAD
  (Sim aplica direto; Não mantém o programa anterior). Preferências → "Tornar padrão para .dwg/.dxf" aplica
  direto (também no executável portátil) e mostra quando já é padrão.
- **Instância única**: duplo clique com o app já aberto abre o arquivo na janela existente.
- **Correção**: perfil U (ex.: 100×200×100, T3, R3) acusava "a seção se autointercepta" sem cruzamento real —
  erro numérico na tangência reta↔arco da verificação; tangência agora decidida pela distância geométrica.

## 1.0.0 — Primeira versão estável
- Versão 1.0.0 publicada como Release no GitHub (instalador NSIS, MSI, executável e SHA256SUMS).
- Mesmas funcionalidades da 0.3.0; notas em `docs/release-notes/v1.0.0.md`.

## 0.3.0 — Nova geração de interface
- **Start Center**: Novo projeto (desenho 2D, planificação, biblioteca, texto laser), Abrir arquivo, Recentes
  persistentes (reabrir, remover, abrir pasta, arquivo não encontrado), recuperação, Preferências.
- **Início**: volta ao Start Center sem perder o documento; "Continuar" retoma o desenho aberto.
- **Design system** reescrito (`apps/desktop/src/styles.css`): tokens de cor, tipografia Segoe UI Variable,
  espaçamentos, botões, abas, campos, diálogos, rolagem, estados.
- **Campos de medida tipados** (`MeasureField`): externa, interna, espessura, ângulo, raio, fator K, com unidade.
- Notificações (toasts), indicador de carregamento ao abrir arquivos, chip "não salvo".
- Esc fecha qualquer diálogo (antes exigia foco dentro dele).
- Planificação, biblioteca e texto laser carregados sob demanda: pacote inicial 425 kB → 341 kB.
- Produto renomeado para **AGTN Industrial CAD** (instalador: `AGTN Industrial CAD_0.3.0_x64-setup.exe`).
- Rust: comando `reveal_in_folder` (abrir local do arquivo no Explorer).
- Sem alteração nos motores de cálculo (geometria, planificação, calandra, peças, DXF, texto laser).

## 0.2.0
Calandra, biblioteca de chapas, texto para laser, logotipo oficial AGTN, aba CONFIGURAÇÕES na planificação.

## 0.1.0
CAD 2D, camadas, cotas, `.agtncad`, DXF, perfis L/U/U enrijecido.
