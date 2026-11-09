# Changelog

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
