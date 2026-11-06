# DXF — suporte e limitações

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

## Importação (R12 até versões atuais, ASCII)

| Entidade | Tratamento |
|---|---|
| `LINE`, `CIRCLE`, `ARC`, `POINT` | nativo |
| `LWPOLYLINE`, `POLYLINE` 2D | nativo, com bulges; largura ignorada (aviso) |
| `TEXT`, `MTEXT` | texto (MTEXT sem formatação, aviso) |
| `INSERT` | bloco expandido com posição, rotação, escala e herança de camada/cor (até 16 níveis) |
| `DIMENSION` linear/rotacionada, alinhada, raio, diâmetro | cota nativa |
| `DIMENSION` angular/ordenada | geometria do bloco da cota |
| Extrusão (0,0,−1) | espelhamento OCS aplicado (comum em DXF de CAM) |
| `$INSUNITS` | convertido para mm (pol, pés, cm, m...); ausente → mm com aviso |
| Codificação | `$DWGCODEPAGE` até R2004; UTF-8 a partir de R2007 |

**Não suportado (contado e informado no relatório, nunca simulado):** `SPLINE`, `ELLIPSE`, `HATCH`, `SOLID`,
`3DFACE`, polilinhas 3D/malhas, `MINSERT` (só a 1ª ocorrência), DXF binário.

**Abrir vs. Importar:** *Abrir* um DXF cria um novo desenho; *Importar* adiciona ao desenho atual em uma única
operação desfazível.

## Testes

- `modules/dxf/src/dxf.test.ts`: escrita, leitura, round-trip exato, unidades, blocos, OCS, cotas, não suportados,
  DXF de planificação.
- `tests/dxf/validate_with_ezdxf.py`: audita os DXF gerados com o ezdxf (leitor independente) e confere contorno
  fechado e posições das linhas de dobra.

## Próximos passos

- Exportação R2000+ (AC1015) com `$INSUNITS`, lineweight e LWPOLYLINE.
- Importação de `ELLIPSE`/`SPLINE` quando o motor tiver essas entidades.

## DWG (desde 1.1.0) — conversor próprio

DWG é lido e gravado pelo módulo `apps/desktop/src-tauri/src/cadconv.rs`, com o motor **acadrust** (Rust puro,
MPL-2.0, embutido no executável — nada para instalar; avisos em `docs/TERCEIROS.md`).

- **Versões**: leitura e gravação de DWG R12, R14, 2000, 2004, 2007, 2010, 2013 e 2018 (AC1009–AC1032).
- **Abrir/Importar DWG** → DXF 2018 → mesmo importador DXF. Validado com DWGs do AutoCAD (R14–2018): o resultado
  é idêntico, entidade por entidade e coordenada por coordenada, ao DXF que o próprio AutoCAD gera do mesmo desenho.
- **Exportar DWG** → DXF R12 do AGTN CAD → DWG na versão das Preferências (padrão 2018).
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
