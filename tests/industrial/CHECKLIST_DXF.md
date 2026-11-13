# Checklist de abertura dos DXF — ZWCAD / AutoCAD / CAM (ETAPA 3, D3–D5)

> ETAPA 4: substituído por `FICHA_CAD.md` (ZWCAD/AutoCAD) e `FICHA_CAM_LASER.md` (operador). Mantido como histórico.

Abra cada arquivo e marque. Se algo falhar, anote a mensagem e mande captura.

Esperado em TODOS: abre sem mensagem de erro; unidade mm; escala 1:1 (medir o blank com DIST); contornos fechados (comando LIST/PROPRIEDADES: Fechada = Sim); sem objetos sobrepostos (OVERKILL não acha nada); camadas CUT_OUTER, CUT_INNER, BEND_UP, BEND_DOWN, BEND_MARK, BEND_REGION, REFERENCE.

| Arquivo | Blank esperado (mm) | Contornos internos | Linhas de dobra | Abre sem erro | Unidade mm | Blank medido | Fechados | OVERKILL limpo | Camadas ok | CAM importa |
|---|---|---|---|---|---|---|---|---|---|---|
| 01_chapa_furos_R2000.dxf | 300.000 × 200.000 | 6 | 0 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 01_chapa_furos_R12.dxf | 300.000 × 200.000 | 6 | 0 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 02_caixa_dobrada_R2000.dxf | 492.985 × 392.985 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 02_caixa_dobrada_R12.dxf | 492.985 × 392.985 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 03_bandeja_710CUH25_R2000.dxf | 574.660 × 559.660 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 03_bandeja_710CUH25_R12.dxf | 574.660 × 559.660 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 04_tampa_dobras_laterais_R2000.dxf | 600.000 × 319.477 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 04_tampa_dobras_laterais_R12.dxf | 600.000 × 319.477 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 05_caixa_protecao_R2000.dxf | 504.739 × 404.739 | 12 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 05_caixa_protecao_R12.dxf | 504.739 × 404.739 | 12 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 06_multiplas_dobras_R2000.dxf | 1000.000 × 175.970 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 06_multiplas_dobras_R12.dxf | 1000.000 × 175.970 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 07_alivios_R2000.dxf | 300.000 × 199.477 | 0 | 2 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 07_alivios_R12.dxf | 300.000 × 199.477 | 0 | 2 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 08_recortes_perto_dobra_R2000.dxf | 400.000 × 236.492 | 4 | 3 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 08_recortes_perto_dobra_R12.dxf | 400.000 × 236.492 | 4 | 3 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 09_fechamento_cantos_R2000.dxf | 417.111 × 417.111 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 09_fechamento_cantos_R12.dxf | 417.111 × 417.111 | 0 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 10_geometria_complexa_R2000.dxf | 354.144 × 243.626 | 2 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |
| 10_geometria_complexa_R12.dxf | 354.144 × 243.626 | 2 | 4 | ☐ | ☐ | | ☐ | ☐ | ☐ | ☐ |

No CAM do laser (D5): importar só CUT_OUTER + CUT_INNER; conferir que o CAM reconhece os furos como internos, o sentido de corte e o kerf; nenhuma linha de dobra pode virar corte (BEND_* devem ser ignoradas ou marcadas). Anotar: nome/versão do CAM, máquina (1.500 W / 3.000 W), resultado.

Observação: R12 não guarda unidade no arquivo (a variável $INSUNITS não existe no R12) — o leitor assume a unidade do desenho; conferir que abre em mm.
