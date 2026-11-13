# Ficha do operador — importação no CAM do laser (ETAPA 4, D5)

**Objetivo:** garantir que só a geometria de corte vira trajetória. Linhas de dobra, marcas, textos e limites de
região de dobra são **informação**, nunca corte.

**Regras:**
- Esta ficha é só de **importação e simulação no CAM**. **Não cortar chapa** sem autorização expressa da AGTN.
- O DXF só fica industrialmente APROVADO quando o operador confirmar a importação correta aqui.
- Arquivos: `tests/industrial/dxf_referencia/` (20 DXF, R12 e R2000, conferidos por SHA-256 em `SHA256SUMS.txt`).

## O que cada camada é

| Camada | Conteúdo | No CAM |
|---|---|---|
| CUT_OUTER | contorno externo da peça (polilinha fechada, arcos como bulge) | **CORTAR** (contorno externo) |
| CUT_INNER | furos e recortes internos (círculos e polilinhas fechadas) | **CORTAR** (internos, antes do externo) |
| BEND_UP | linha de dobra para cima | **NÃO CORTAR** (ignorar, ou só marcar se a máquina gravar) |
| BEND_DOWN | linha de dobra para baixo | **NÃO CORTAR** |
| BEND_MARK | textos "D1 CIMA 90,0° RI2,00" | **NÃO CORTAR** |
| BEND_REGION | limites da região de dobra (opcional) | **NÃO CORTAR** |
| REFERENCE | texto com nome, blank e nº de dobras | **NÃO CORTAR** |

## Identificação

| Campo | Preencher |
|---|---|
| Fabricante da máquina | |
| Modelo da máquina | |
| Potência (1.500 W / 3.000 W / outra) | |
| Software CAM | |
| Versão do CAM | |
| Formato DXF utilizado (R12 / R2000 / os dois) | |
| Data · operador | |

## Por arquivo

Para cada arquivo, importar e conferir:
1. unidade mm, escala 1:1 (medir o blank);
2. camadas reconhecidas pelo nome;
3. só CUT_* nas trajetórias;
4. furos reconhecidos como internos;
5. sem contorno aberto e sem entidade duplicada (o CAM avisa?);
6. textos e dobras fora do corte.

| Arquivo | Importou sem erro | Unidade/escala ok (blank medido) | Camadas reconhecidas | Camadas usadas no corte | Ajuste manual necessário? (qual) | Resultado |
|---|---|---|---|---|---|---|
| 01_chapa_furos_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 01_chapa_furos_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 02_caixa_dobrada_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 02_caixa_dobrada_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 03_bandeja_710CUH25_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 03_bandeja_710CUH25_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 04_tampa_dobras_laterais_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 04_tampa_dobras_laterais_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 05_caixa_protecao_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 05_caixa_protecao_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 06_multiplas_dobras_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 06_multiplas_dobras_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 07_alivios_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 07_alivios_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 08_recortes_perto_dobra_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 08_recortes_perto_dobra_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 09_fechamento_cantos_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 09_fechamento_cantos_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 10_geometria_complexa_R2000.dxf | ☐ | | | | | ☐ ok ☐ falha |
| 10_geometria_complexa_R12.dxf | ☐ | | | | | ☐ ok ☐ falha |

## Pontos de atenção

- **Filtro de camadas:** se o CAM importa todas as camadas como corte, isso é **ajuste manual obrigatório**. Anotar
  como configurar (ex.: excluir BEND_*, REFERENCE) e se o CAM guarda essa regra.
- **Textos:** o CAM pode transformar TEXT em gravação ou corte. Confirmar que não vira trajetória.
- **R12:** não tem unidade gravada no arquivo. Confirmar que o CAM assume mm.
- **Arcos:** vêm como bulge de polilinha (padrão DXF). Se o CAM quebrar em segmentos, anotar a tolerância.
- **Kerf e sentido de corte:** são do CAM, não do arquivo. Anotar como ficaram.

## Resultado final

☐ APROVADO para importação (sem ajuste) · ☐ APROVADO com ajuste documentado: ____________ · ☐ REPROVADO

Operador: ______________________ · Engenharia: ______________________
