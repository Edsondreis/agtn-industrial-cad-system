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
- DWG: fora do escopo inicial (não há conversão fictícia).
