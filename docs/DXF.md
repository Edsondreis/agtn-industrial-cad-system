# DXF — suporte e limitações

A exportação tem duas versões (escolha em Exportar DXF; a última escolhida fica salva):

- **DXF R12** — padrão; o formato mais aceito por máquinas e CAM. Peças e planificações sempre saem em R12.
- **DXF 2000 (AC1015)** — guarda elipse, spline, hachura, texto de várias linhas, unidade e espessura de linha.

## Exportação: DXF 2000 (AC1015), ASCII, Windows-1252 (desde 3.0.0)

`modules/dxf/src/writer2000.ts`. Estrutura completa exigida pelo AutoCAD 2000+: handles únicos, `$HANDSEED`,
tabelas com `BLOCK_RECORD`, `*Model_Space`/`*Paper_Space`, dicionário raiz, layouts e estilo de plotagem "Normal".
A janela `*Active` abre já enquadrada no desenho.

| Item | Exportado como |
|---|---|
| Linha, círculo, arco, ponto | `LINE`, `CIRCLE`, `ARC`, `POINT` |
| Polilinha | `LWPOLYLINE` (bulges) |
| Elipse / arco elíptico | `ELLIPSE` |
| Spline (inclusive NURBS racional) | `SPLINE` (pontos de controle, nós, pesos) |
| Hachura | `HATCH` com contornos de polilinha (arcos por bulge), sólida ou com as linhas do padrão |
| Texto de uma linha / várias linhas | `TEXT` / `MTEXT` (`\P`); fora do Windows-1252 vai como `\U+XXXX` |
| Cota | explodida (`LINE`/`SOLID`/`ARC`/`TEXT`), como no R12 |
| Unidade | `$INSUNITS = 4` (mm), `$MEASUREMENT = 1` |
| Espessura de linha | código 370 em camadas e objetos (arredondada ao valor padrão do AutoCAD) |

Validação: arquivos auditados pelo ezdxf sem erros e sem correções; lidos pelo conversor DWG (acadrust) e
regravados em DWG 2004–2018 com ELLIPSE/SPLINE/HATCH/MTEXT/LWPOLYLINE preservados; ida e volta
AGTN → DXF 2000 → DWG 2018 → DXF → AGTN com desvio < 1e-13 mm.

## Exportação: DXF R12 (AC1009), ASCII, Windows-1252

Escolhido por ser lido por praticamente todo CAD/CAM (AutoCAD, DraftSight, BricsCAD, LibreCAD, CAMs de laser,
plasma e dobra).

| Item | Exportado como |
|---|---|
| Linha, círculo, arco, ponto | `LINE`, `CIRCLE`, `ARC`, `POINT` |
| Polilinha (com arcos) | `POLYLINE` + `VERTEX` (bulge, código 42) + `SEQEND`; flag fechada |
| Texto | `TEXT` (°, Ø, ± como `%%d`, `%%c`, `%%p`) |
| Cota | explodida em `LINE`/`SOLID`/`ARC`/`TEXT` na camada da cota |
| Camadas | tabela `LAYER`: nome, cor ACI, tipo de linha; oculta = cor negativa; bloqueada = flag 4 |
| Tipos de linha | tabela `LTYPE` (CONTINUOUS, DASHED, HIDDEN, CENTER, PHANTOM, DOT) |

Coordenadas com precisão total de ida e volta (sem notação científica).

**Limitações do R12 (documentadas):**
- Não há unidade no arquivo (`$INSUNITS` é R2000+). O AGTN CAD sempre exporta em **mm**; configure o software de
  destino para milímetros.
- Não há espessura de linha (lineweight) — fica apenas no AGTN CAD.
- Cotas não são associativas no arquivo exportado.
- Nomes de camada: apenas A–Z, 0–9, `$ - _`, até 31 caracteres (o gerenciador de camadas valida).
- Elipse e spline viram `POLYLINE` de segmentos retos (erro < 0,05 % do tamanho); hachura com padrão vira as
  `LINE`s do padrão; hachura sólida vira o contorno; texto de várias linhas vira um `TEXT` por linha.

## Importação (R12 até versões atuais, ASCII)

| Entidade | Tratamento |
|---|---|
| `LINE`, `CIRCLE`, `ARC`, `POINT` | nativo |
| `LWPOLYLINE`, `POLYLINE` 2D | nativo, com bulges; largura ignorada (aviso) |
| `TEXT`, `MTEXT` | texto; MTEXT mantém as quebras de linha (`\P`), frações empilhadas e o ponto de anexação |
| `ELLIPSE` | elipse nativa (inclusive arco elíptico) |
| `SPLINE` | spline nativo (B-spline/NURBS); só com pontos de ajuste → interpolado como o AutoCAD faz |
| `HATCH` | hachura nativa: contornos de polilinha, linha, arco, arco elíptico e spline; sólida, degradê (como sólida) e padrões |
| `SOLID`, `TRACE` | hachura sólida (ex.: setas de cota) |
| `LEADER` | polilinha + seta |
| `ACAD_TABLE` | geometria do bloco gráfico da tabela |
| `POLYLINE` 3D | projetada no plano XY (aviso) |
| `INSERT` | bloco expandido com posição, rotação, escala e herança de camada/cor (até 16 níveis) |
| `DIMENSION` linear/rotacionada, alinhada, raio, diâmetro | cota nativa |
| `DIMENSION` angular/ordenada | geometria do bloco da cota |
| Extrusão (0,0,−1) | espelhamento OCS aplicado (comum em DXF de CAM) |
| `$INSUNITS` | convertido para mm (pol, pés, cm, m...); ausente → mm com aviso |
| Codificação | `$DWGCODEPAGE` até R2004; UTF-8 a partir de R2007 |

Blocos com escala não uniforme: círculos e arcos viram elipses exatas; polilinhas com arcos ainda não.

**Não suportado (contado e informado no relatório, nunca simulado):** `MULTILEADER`, `MLINE`, `TOLERANCE`,
`XLINE`, `RAY`, `WIPEOUT`, `IMAGE`, `PDFUNDERLAY`, `3DFACE`, `3DSOLID`, `REGION`, `MESH`, malhas/poliface,
`MINSERT` (só a 1ª ocorrência), DXF binário.

Validação da leitura: `tests/dxf/fixtures/curvas.dxf` (gerado pelo ezdxf por `make_curves_fixture.py`) — elipses
e splines coincidem com o ezdxf (desvio < 0,01 mm), áreas das hachuras exatas, traços do padrão iguais aos do ezdxf.

**Abrir vs. Importar:** *Abrir* um DXF cria um novo desenho; *Importar* adiciona ao desenho atual em uma única
operação desfazível.

## Testes

- `modules/dxf/src/dxf.test.ts`: escrita, leitura, round-trip exato, unidades, blocos, OCS, cotas, não suportados,
  DXF de planificação.
- `tests/dxf/validate_with_ezdxf.py`: audita os DXF gerados com o ezdxf (leitor independente) e confere contorno
  fechado e posições das linhas de dobra.

## Próximos passos

- `MULTILEADER` e `MLINE` na leitura; cotas como `DIMENSION` associativas na exportação 2000.

## DWG (desde 1.1.0) — conversor próprio

DWG é lido e gravado pelo módulo `apps/desktop/src-tauri/src/cadconv.rs`, com o motor **acadrust** (Rust puro,
MPL-2.0, embutido no executável — nada para instalar; avisos em `docs/TERCEIROS.md`).

- **Versões**: leitura e gravação de DWG R12, R14, 2000, 2004, 2007, 2010, 2013 e 2018 (AC1009–AC1032).
- **Abrir/Importar DWG** → DXF 2018 → mesmo importador DXF. Validado com DWGs do AutoCAD (R14–2018): o resultado
  é idêntico, entidade por entidade e coordenada por coordenada, ao DXF que o próprio AutoCAD gera do mesmo desenho.
- **Exportar DWG** → DXF 2000 do AGTN CAD → DWG na versão das Preferências (padrão 2018). Elipse, spline,
  hachura e texto de várias linhas chegam ao DWG como objetos nativos (desde 3.0.0).
- **Converter DWG ↔ DXF** (Start Center): lote, inverter/forçar formato, versões R12–2018.
- **Robustez**: leitura estrita e, se falhar, tolerante (recupera o que for possível); limite de memória por
  leitura; cada conversão roda em processo filho (`agtn-cad.exe --agtn-cadconv …`) para que um arquivo
  corrompido nunca feche o aplicativo; tempo-limite de 10 min por arquivo.
- Ida e volta **fiel em DWG 2004–2018** (mesmos objetos). Em **2000, R14 e R12**, objetos que o formato antigo
  não comporta (tabelas de dados, hachuras modernas, multileaders…) passam por DXF R12 e viram geometria simples
  (linhas, textos) — o desenho fica igual na tela, mas não editável como o objeto original.
- Se o ODA File Converter já estiver instalado, é usado só como segunda tentativa quando o motor próprio falha.
- Testes: `cadconv.rs` (todas as versões, ida e volta, arquivo lixo, CLI) e amostras reais em `tests/dwg`
  regravadas em 8 versões de DWG e 8 de DXF no CI.
