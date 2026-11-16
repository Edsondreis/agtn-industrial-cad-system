# Evidências do P-F5-01 (causa raiz)

Sondas usadas para isolar o defeito, na ordem do relatório (`docs/P-F5-01_CAUSA_RAIZ.md`). Rodam fora do app, com o
occt-wasm do `node_modules` (Node 22) ou com o OCCT nativo pelo `cadquery-ocp` (Python 3; `pip install cadquery-ocp`
para o 8.0.1, `pip install "cadquery-ocp<7.9"` num venv para o 7.8.1).

| Script | O que mostra |
|---|---|
| `00_sonda_faces.mjs <repo> <arquivo.step>` | volume, validade e cada face (tipo, área, faixa UV, arestas) como o OCCT entrega |
| `01_ida_volta_parametrizacao.mjs <repo>` | calotas construídas no OCCT, conferidas com a fórmula, escritas e relidas: elipse E círculo falham com polo; truncada e prolata não |
| `02_polo_vmin_vmax.mjs <repo>` | mesma geometria, só o sentido do parâmetro da geratriz muda: polo em vmax falha, polo em vmin lê exato |
| `03_matriz_inicio_laco.py` | arquivo ORIGINAL, só o ponto de partida dos 2 laços muda (9 combinações): só começando no polo fica válido e exato |
| `04_occt_nativo_7_8_e_8_0.py <arquivos>` | o OCCT nativo 7.8.1 e 8.0.1 repetem o erro (−28,47 %) e leem o arquivo normalizado com erro 5e-15 |
| `05_edicoes_minimas_sem_efeito.py` | coordenada do polo, ordem das pcurves, sentido da aresta, sem pcurves, sentido da face: nada disso resolve |
| `06_shapefix_isolado.py` | o ShapeFix sozinho repõe o polo certo: o defeito está antes, na tradução do laço |
| `07_desvio_aresta_superficie.mjs <repo> <arquivos>` | a verificação de arestas sobre as superfícies: ≤ 1e-10 mm em arquivos sãos, 60 mm no inconsistente |
| `vessel_revolved_normalizado.step` | o arquivo de referência com os 2 laços girados (única diferença: 2 linhas) |
