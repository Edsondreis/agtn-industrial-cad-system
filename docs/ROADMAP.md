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
- ✅ Elipse e spline com geometria exata, hachura (sólida e padrões, com furos), texto multilinha (3.0.0).
- 🔜 Blocos nativos, tolerâncias geométricas, hachura por ponto interno (detecção automática de contorno).

## Fase 5 — DXF ✅
Importação R12→atuais, exportação R12 e 2000 (unidades, espessuras, elipse/spline/hachura), relatório,
round-trip, validação ezdxf. DWG R12–2018 pelo conversor próprio.
- ✅ Impressão e PDF vetorial próprio (folhas A4–A0, escala, janela, cores/monocromático) (3.0.0).
- 🔜 MULTILEADER/MLINE na leitura; cotas associativas na exportação 2000.

## Módulo AGTN SHEET METAL ✅ (1ª entrega)
Perfis L, U, U enrijecido; interna/externa; K manual/tabela; calibração; seção e planificação; inserção no CAD;
DXF de fabricação.
- ✅ Calandra (cilindro e segmento) com marcação; UI básica + CONFIGURAÇÕES.
- ✅ Perfis Z, Z enrijecido, cartola e ômega; C = U enrijecido (3.0.0).
- ✅ Bandejas e bandejas enrijecidas: abas em qualquer ângulo, pestana para dentro/fora, canto sobreposto/encosto/
  esquadria/aberto, alívio retangular ou furo redondo, ordem de dobra (3.1.0).
- 🔜 Cone/redução calandrada.
- 🔜 Referência dimensional “até a tangente” para θ > 90°; bainha (hem).
- ⏳ Chapas com recortes, abas e retornos, alívios; bandeja com abas de ângulos diferentes por borda; dutos e transições; sequência de dobra;
  integração com tabelas reais da dobradeira (Delem DA66T).

## Biblioteca de chapas ✅ (1ª entrega)
Flange, bolacha, setor de anel, chapa de base, oblongos, polígono, cartela, olhal, boca de lobo.
- 🔜 Tabelas normalizadas de flanges (ASME B16.5 / EN 1092-1), esquadros, mão-francesa com furos, chapas de emenda.

## Texto para laser ✅
Vazado com pontes automáticas, emendado, marcação, 10 fontes OFL.
- 🔜 Fontes de traço único para gravação rápida; texto em arco.

## Fase 6 — Documentação ⏳
Formato nativo ✅ e recuperação ✅. Pendentes: layouts A4–A0, orientação, escala, margens, centralização,
pré-visualização de impressão e exportação PDF.

## Fase 7 — Distribuição ✅ (parcial)
Build Windows automatizado (NSIS + MSI), ícone do app, logotipo oficial AGTN (manual da marca), tela de inicialização, versão na tela Sobre.
- 🔜 assinatura de código, teste em instalação limpa documentado, atualização automática.

## Futuro 3D ⏳
Kernel B-Rep (OpenCASCADE via Rust), extrusão, revolução, booleanas, STEP/STP, STL, visualização de peças,
projeções ortográficas → desenho 2D, chapa 3D a partir da seção do SheetMetalEngine.
