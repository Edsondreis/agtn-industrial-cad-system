# Arquivos de teste do P-F5-01

- `elipsoide_vertex_loop.step` — elipsoide 600 × 300 (semi-eixos 300/150, eixo X) gravado pelo OCCT 8 (occt-wasm 5.17.1)
  como uma face de SURFACE_OF_REVOLUTION de ELLIPSE limitada por VERTEX_LOOP. O leitor cru do OCCT devolve volume
  ≈ −53 mm³ com o verificador de forma aprovando; referência: (4/3)·π·300²·150 = 56 548 667,765 mm³.
- `vessel_inconsistente.step` — `viewer_ref/vessel_revolved.step` com UMA alteração deliberada: a elipse geratriz da
  superfície externa do tampo (#94) com semi-eixo menor 90 em vez de 150. As arestas continuam a 150: geometria
  incoerente. O BRepCheck do OCCT aprova; a verificação de arestas do AGTN reprova (desvio 60 mm) e aponta a face.
