# Arquitetura do AGTN CAD

## Visão geral

```
┌──────────────────────────── apps/desktop ────────────────────────────┐
│ React (UI: painéis, menus, linha de comando, PLANIFICAÇÃO)            │
│   └─ CadController ── ferramentas (máquinas de estado) ── Renderer   │
│                         │                                 (Canvas 2D) │
├─────────────────────────┼─────────────────────────────────────────────┤
│ modules/sheetmetal      │ modules/dxf                                 │
├─────────────────────────┴─────────────────────────────────────────────┤
│ core/document  (CadDocument, camadas, transações, R-tree, seleção)    │
│ core/geometry  (entidades, interseções, snap, transformações, edição) │
├───────────────────────────────────────────────────────────────────────┤
│ Tauri 2 / Rust: janela, diálogos, E/S atômica, recuperação            │
└───────────────────────────────────────────────────────────────────────┘
```

Dependências só descem: `geometry` não conhece nada; `document` usa `geometry`; módulos usam ambos; a UI usa todos.
Nenhum pacote de `core/` ou `modules/` importa React, DOM ou Tauri — todos rodam em Node nos testes.

## Decisões

### D1 — Tauri 2 + React/TypeScript + Rust
- **Por quê:** executável pequeno (WebView2 do sistema, sem embutir Chromium), inicialização rápida e baixo consumo
  de RAM em relação a Electron; Rust para a camada nativa.
- **Alternativas avaliadas:** Electron (≈ 150 MB, RAM alta), Qt/C++ (licenciamento LGPL/comercial e ciclo de UI mais
  lento), WPF/.NET (só Windows, motor geométrico ficaria acoplado à plataforma).

### D2 — Motor geométrico em TypeScript (não em Rust/WASM) nesta fase
- A interação CAD (snap, preview, hit-test) acontece a cada movimento do mouse; manter a geometria no mesmo processo
  da UI evita serialização por IPC a cada quadro.
- Precisão idêntica: JavaScript usa IEEE-754 float64, o mesmo `f64` do Rust.
- O motor é puro e isolado (`core/geometry`), então pode ser portado para Rust/WASM se perfis de desempenho
  justificarem, sem tocar na UI.
- Rust fica com o que precisa ser nativo: arquivos, diálogos e, no futuro, o kernel 3D (ver D8).

### D3 — Entidades imutáveis + transações reversíveis (Undo/Redo)
- Cada edição gera novos objetos com o mesmo `id`. Uma transação guarda `before/after` de cada alteração
  (entidades, camadas, configurações, dados de módulos). Undo/Redo aplica o inverso/direto — sem recomputar nada.
- Atualizações de cotas associativas entram na mesma transação, então desfazer restaura tudo junto.

### D4 — Índice espacial R-tree (`rbush`, MIT)
- Seleção por clique/janela, snap e renderização consultam apenas a região relevante.
  Carga em lote ao abrir arquivos. `rbush` é pequeno, maduro e sem dependências.

### D5 — Renderização Canvas 2D em duas camadas
- Camada principal (grade + entidades) só é redesenhada quando documento, seleção ou vista mudam.
- Camada de sobreposição (cursor, snap, rubber band, pré-visualização) é redesenhada a cada movimento do mouse — barato.
- Traçados agrupados por estilo em `Path2D` (um `stroke` por cor/espessura/tipo de linha).
- Coordenadas convertidas para tela em float64 antes de chegar ao Canvas: a precisão do modelo não depende do zoom.
- Evolução prevista: WebGL2 para desenhos muito grandes (mesma interface `drawEntities`).

### D6 — Unidade interna única: milímetro
- Todo valor armazenado está em mm. A unidade do desenho (mm/cm/m) só afeta exibição e entrada.
  Elimina conversões espalhadas e erros de escala.

### D7 — DXF próprio, sem biblioteca externa
- As bibliotecas JS de DXF avaliadas ou só leem, ou geram versões modernas parcialmente, ou têm manutenção irregular.
  O escritor R12 e o leitor foram implementados conforme a referência DXF da Autodesk e **validados por um leitor
  independente (ezdxf)** nos testes. Ver `docs/DXF.md`.

### D8 — Preparação para 3D (não implementado)
- O 2D não contém nenhum código 3D improvisado. O caminho previsto:
  - `core/solid` em Rust usando **OpenCASCADE** (via `opencascade-rs`/FFI; licença LGPL 2.1 com exceção — avaliar
    linkagem dinâmica) para B-Rep, extrusão, revolução, booleanas e leitura STEP/STP.
  - Visualização WebGL2/WebGPU separada da prancheta 2D.
  - Projeções ortográficas de sólidos geram entidades 2D do `core/geometry` (o desenho técnico continua no motor 2D).
  - O `SheetMetalEngine` já modela a seção por faces e eixo neutro; a extrusão da seção ao longo do comprimento é a
    base da futura chapa 3D.

### D9 — Formato nativo JSON versionado
- Legível, diferenciável em controle de versão, ida e volta exata de float64 (`JSON.stringify` usa a representação
  mínima de ida e volta). Campo `version` permite migrações. Dados de módulos ficam em `extras` (ex.: tabelas de K),
  sem acoplar o núcleo ao módulo.

### D10 — Gravação atômica e recuperação
- O Rust grava em arquivo temporário, `fsync` e `rename` — um projeto nunca fica pela metade.
- A cada 60 s, se houver alterações não salvas, o desenho vai para `%LOCALAPPDATA%\br.com.agtn.cad\recuperacao.agtncad`;
  ao abrir, o programa oferece recuperar.

## Fluxo de uma operação

1. Usuário clica ou digita (`@50<30`) → `CadController` resolve o ponto (snap → grade → ortho/polar).
2. A ferramenta ativa recebe o ponto; ao concluir, monta uma lista de `Change` e chama `commit`.
3. `CadDocument.commit` aplica, atualiza o R-tree, recalcula cotas associativas e empilha a transação.
4. O documento emite evento → camada principal marcada para redesenho no próximo quadro; painéis React re-renderizam.

## Atalhos e linha de comando

Letras digitadas vão para a linha de comando e só executam com Enter/Espaço — não há conflito com `Ctrl+Z`,
`Ctrl+S` etc. O botão direito equivale a Enter. Esc cancela. Ver menu **Ajuda → Comandos e atalhos**.
