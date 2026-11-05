# Roadmap

Legenda: ✅ entregue · 🔜 próxima · ⏳ planejado

## Fase 1 — Fundação ✅
Arquitetura, aplicativo desktop Tauri 2, identidade visual, janela principal, prancheta, zoom/pan, coordenadas, grade.

## Fase 2 — Desenho 2D ✅
Linha, polilinha, retângulo, círculo, arco, polígono, ponto, texto; seleção (clique, janela, cruzamento, tipo);
exclusão; Undo/Redo transacional.

## Fase 3 — Edição profissional ✅
Mover, copiar, rotacionar, escala, espelhar, offset, trim, extend, fillet, chanfro, stretch, explodir, unir,
alças; snaps; ortho; polar; linha de comando.
- 🔜 Fillet/chanfro entre arcos e dentro de polilinhas; trim com cerca (fence); array retangular/polar.

## Fase 4 — Engenharia ✅ (parcial)
Camadas, propriedades editáveis, cotas linear/alinhada/angular/raio/diâmetro associativas, medição de distância,
área e perímetro no painel, texto.
- 🔜 Elipse e spline (com geometria exata), hachura, blocos nativos, texto multilinha, tolerâncias.

## Fase 5 — DXF ✅
Importação R12→atuais, exportação R12, relatório, round-trip, validação ezdxf.
- 🔜 Exportação R2000+ com unidades e espessuras.

## Módulo AGTN SHEET METAL ✅ (1ª entrega)
Perfis L, U, U enrijecido; interna/externa; K manual/tabela; calibração; seção e planificação; inserção no CAD;
DXF de fabricação.
- 🔜 Perfis Z, C, cartola, ômega (motor já suporta sentidos alternados).
- 🔜 Referência dimensional “até a tangente” para θ > 90°; bainha (hem).
- ⏳ Chapas com recortes, abas e retornos, alívios; caixas; dutos e transições; sequência de dobra;
  integração com tabelas reais da dobradeira (Delem DA66T).

## Fase 6 — Documentação ⏳
Formato nativo ✅ e recuperação ✅. Pendentes: layouts A4–A0, orientação, escala, margens, centralização,
pré-visualização de impressão e exportação PDF.

## Fase 7 — Distribuição ✅ (parcial)
Build Windows automatizado (NSIS + MSI), ícone provisório, tela de inicialização, versão na tela Sobre.
- 🔜 Logotipo oficial AGTN, assinatura de código, teste em instalação limpa documentado, atualização automática.

## Futuro 3D ⏳
Kernel B-Rep (OpenCASCADE via Rust), extrusão, revolução, booleanas, STEP/STP, STL, visualização de peças,
projeções ortográficas → desenho 2D, chapa 3D a partir da seção do SheetMetalEngine.
