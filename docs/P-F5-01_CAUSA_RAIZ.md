# P-F5-01 — Superfícies de revolução que fecham num polo (tampos elípticos): causa raiz e correção

Data: 2026-11-16 · Branch `feature/agtn-3d-ia` · base 223714e (3.2.0-2) · `main` intocada · sem merge, tag ou Release.

**Situação: CORRIGIDO nesta branch.** Causa raiz provada; correção implementada sem alterar geometria; casos de referência
e regressão aprovados; precisão demonstrada contra referências independentes (fórmula fechada e referência do viewer
gerada com CadQuery); a proteção contra resultado não confiável foi reforçada e continua sinalizando os casos inválidos.
Pendente apenas a confirmação no app instalado no Windows (sem PC Windows nesta sessão — ver §9).

## 1. Sintoma

`vessel_revolved.step` (costado Ø600 × 900, parede 6, tampo 2:1): o OCCT entregava volume 8 397 477,163 mm³ contra
11 739 729,623 mm³ da referência (**−28,47 %**), caixa até x = 900 em vez de 1 050 e sólido inválido no BRepCheck.

## 2. Onde a geometria é perdida (provado etapa por etapa)

| Etapa | Resultado | Evidência |
|---|---|---|
| Arquivo (escritor) | geometria coerente: elipses, pcurves e parâmetros conferidos à mão; o mesmo escritor, com outra parametrização, gera arquivo que é lido exato | `01`, `02` |
| Cálculo de volume | exato no B-rep construído em memória (erro 2,8e-7, piso do integrador) | `01` |
| **Tradução STEP → B-rep (leitor do OCCT)** | **a face sobre SURFACE_OF_REVOLUTION sai só com o círculo da borda; a aresta de costura (a elipse) some, a faixa V colapsa em [0, 0], área 0** | `00` |
| Malha / exibição | consequência: não há o que triangular na calota | — |

Detalhes do isolamento:
- **Não é a elipse:** revolução de **círculo** com polo falha igual; o tampo **prolato** e a calota **truncada** (sem polo) não falham (`01`).
- **Não é a versão:** occt-wasm 5.17.1 e **5.17.2** (o mais novo, 14/11/2026) e o OCCT **nativo 7.8.1 e 8.0.1** dão o mesmo
  volume, 8 397 477,163 mm³ (`04`). Não é regressão do 8.
- **Não é** o modo de pcurve (`read.surfacecurve.mode` 0, ±2, ±3), a coordenada do vértice do polo, a ordem das pcurves
  da costura, o sentido da aresta, a ausência de pcurves nem o sentido da face (`05`).
- **Não é o ShapeFix isolado:** tirar a aresta degenerada de uma face boa e rodar `ShapeFix_Wire`/`ShapeFix_Face` repõe o
  polo certo nos dois sentidos (`06`). O defeito está antes, na tradução do laço (`StepToTopoDS_TranslateEdgeLoop`).
- **Gatilho:** o STEP não tem aresta degenerada; o polo é só um vértice por onde a costura passa duas vezes. O resultado
  depende **de qual ponto o EDGE_LOOP começa**. Matriz no arquivo original, mudando só o início dos 2 laços (`03`):

| Laço externo começa em | Laço interno começa em | Resultado |
|---|---|---|
| círculo da borda (#147) ou costura indo da borda ao polo (#148) | qualquer um, exceto #260 | calota(s) colapsada(s), inválido |
| **costura saindo do polo (#172)** | **costura saindo do polo (#260)** | **válido, 11 739 729,218 mm³, área 4 135 203,650 mm²** |

  O OCCT nativo lê o arquivo assim normalizado com erro de 5e-15 no volume (`04`). A linha exata dentro do tradutor do
  OCCT que depende do início do laço não foi isolada (não há build do OCCT com depuração nesta sessão); a etapa, o
  gatilho e a condição foram provados por experimento controlado.

## 3. Segundo caso da mesma classe (achado pela suíte)

Elipsoide inteiro gravado como **uma face** de revolução de ELLIPSE limitada por **VERTEX_LOOP** (o próprio OCCT grava
assim): o leitor aplica os limites naturais; a elipse inteira gira, as duas metades geram a mesma superfície com
normais opostas e o volume se anula (**−53 mm³ para 56 548 667,765 mm³**) — **com o BRepCheck aprovando**. Com CIRCLE
o leitor já acerta.

## 4. Alternativas avaliadas

| | Alternativa | Resultado | Decisão |
|---|---|---|---|
| A | Atualizar occt-wasm / OCCT | 5.17.2 e OCCT nativo 7.8.1/8.0.1 falham igual | descartada (evidência `04`) |
| B | Parser Kotlin do viewer | lê a revolução por **malha**: o próprio teste dele aceita 2 % e marca a área como `MESH` (não exata) | descartada: daria número aproximado, não B-rep |
| C | Tratamento matemático específico | **escolhida**, com fundamento abaixo | implementada |

## 5. Correção (core/solid/src/step-pole.ts)

Antes de entregar o texto ao leitor do OCCT, numa **cópia em memória** (o arquivo em disco não é tocado):

1. **Faces de revolução com costura que toca o eixo:** o EDGE_LOOP é girado para começar pela passagem da costura que
   **sai do polo**. Um `edge_loop` é uma lista **cíclica** (ISO 10303-42): o ponto de partida não tem significado
   geométrico nem topológico. **Nenhuma** coordenada, curva, superfície, parâmetro, orientação ou entidade muda — só a
   ordem cíclica das referências. Critério de polo: distância do vértice ao eixo / distância da outra ponta < 1e-6.
2. **VERTEX_LOOP em revolução de cônica fechada centrada no eixo:** a face passa a apontar para uma **cópia** da
   SURFACE_OF_REVOLUTION cuja geratriz é a **mesma** cônica recortada (TRIMMED_CURVE, por parâmetro) entre os dois
   pontos onde ela cruza o eixo — calculados analiticamente: a·cos t·(X×d)·N + b·sin t·(Y×d)·N = 0. A superfície é o
   mesmo conjunto de pontos (a outra metade só repetia pontos). A entidade original fica intacta. Só com ângulo plano em
   radiano (senão é pulado e registrado).
3. Casos que não se encaixam (polo nas duas pontas da costura, cônica fora do eixo, formato inesperado) ficam **como
   vieram** e são registrados; a proteção (§6) continua valendo para eles.

Não há fator, compensação empírica, malha no lugar de B-rep nem aviso escondido. O B-rep continua sendo o do OCCT.

## 6. Proteção contra resultado não confiável (§1.6)

O caso adulterado de propósito mostrou que **o BRepCheck sozinho não basta**: superfície com semi-eixo 90 e arestas a 150
foi aprovada, com volume 430 000 mm³ para 11,7 milhões. Agora cada corpo passa por `checkGeometry`:
- forma (BRepCheck);
- **arestas sobre as superfícies**: o ponto do meio de cada aresta é projetado na superfície da face. Limite
  max(0,01 mm; 1e-5 × maior dimensão); arquivos sãos medem ≤ 1e-10 mm, o adulterado mede 60 mm. Custo: 27 200 pontos em
  0,34 s no arquivo de 21 MB com 400 sólidos;
- **volume coerente**: sólido fechado com volume ≤ 1e-6·área^1,5 (sobreposto/do avesso) é reprovado.

Classes de medida (`MeasureGrade`): **exato** (B-rep verificado), **aproximado** (malha — no documento STEP nenhuma medida é
desse tipo), **inválido**, **não calculável** (casca), **não verificado**. Só "exato" mostra volume, área e dimensões;
"inválido" mostra **"não confiável"**, a faixa vermelha "não aptas para uso em engenharia ou fabricação" e a lista
corpo → face nº (tipo de superfície) → motivo/desvio. A tela também informa quando a leitura foi normalizada.

## 7. Testes

Suíte `core/solid/src/step-pole.test.ts` (32 testes). Cada caso é escrito pelo OCCT (que começa o laço pela borda) e
relido em **todas** as posições iniciais de laço (simula outros escritores), pelo caminho do app.

Tolerâncias: volume e área 1e-6 relativo — o integrador do occt-wasm tem erro medido de 2,8e-7 contra a fórmula fechada em
sólidos construídos em memória (sem STEP) e o arquivo traz 13–15 algarismos; caixa 1e-3 mm + 1e-7·tamanho. No composto de 3
sólidos o erro de 7,95e-7 é o mesmo do composto construído em memória (diferença lido × construído < 1e-9): vem do
integrador, não da leitura.

| Caso | Unid. | Volume referência (mm³) | Volume AGTN (mm³) | Dif. abs. (mm³) | Dif. % | Área AGTN (mm²) | Área ref. (mm²) | Válido | Desvio aresta (mm) | Sem correção (vol. %) | Variantes de laço |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|
| vessel_revolved.step (viewer, CadQuery/OCCT 8) | mm | 11,739,729.623 | 11,739,729.218 | -0.404 | -3.44e-06 | 4,135,203.650 | 4,135,203.650 | sim | 2.8e-14 | -28.47 % (inválido) | 64 |
| tampo 2:1 (ASME/DIN 28013) Ø600 | mm | 28,274,333.882 | 28,274,325.927 | -7.955 | -2.81e-05 | 672,978.060 | 672,978.060 | sim | 3.2e-14 | -100.00 % (inválido) | 3 |
| tampo 2:1 Ø3000 | mm | 3,534,291,735.289 | 3,534,290,740.916 | -994.372 | -2.81e-05 | 16,824,451.512 | 16,824,451.512 | sim | 1.4e-13 | -100.00 % (inválido) | 3 |
| tampo 1,9:1 Ø1200 | mm | 238,099,653.746 | 238,099,586.756 | -66.989 | -2.81e-05 | 2,725,160.468 | 2,725,160.468 | sim | 8.0e-14 | -100.00 % (inválido) | 3 |
| tampo 3:1 Ø800 | mm | 44,680,428.851 | 44,680,416.280 | -12.571 | -2.81e-05 | 1,109,732.040 | 1,109,732.040 | sim | 3.7e-14 | -100.00 % (inválido) | 3 |
| tampo hemisférico (círculo) Ø500 | mm | 32,724,923.475 | 32,724,914.268 | -9.207 | -2.81e-05 | 589,048.623 | 589,048.623 | sim | 2.3e-14 | -100.00 % (inválido) | 3 |
| tampo prolato h>R Ø300 | mm | 14,137,166.941 | 14,137,162.964 | -3.977 | -2.81e-05 | 312,318.232 | 312,318.232 | sim | 3.4e-14 | -0.00 %  | 3 |
| tampo achatado 6:1 Ø100 | mm | 43,633.231 | 43,633.219 | -0.012 | -2.81e-05 | 16,256.223 | 16,256.223 | sim | 4.6e-15 | -100.00 % (inválido) | 3 |
| vaso oco Ø1000×1500 e8 | mm | 43,580,709.456 | 43,580,707.952 | -1.503 | -3.45e-06 | 11,507,872.062 | 11,507,872.062 | sim | 1.2e-13 | -28.49 % (inválido) | 64 |
| calota truncada 70° | mm | 28,123,184.903 | 28,123,176.163 | -8.740 | -3.11e-05 | 672,716.966 | 672,716.966 | sim | 6.3e-12 | -0.00 %  | 4 |
| vaso Ø600×400 em inch (1 inch = 25.4 mm) | inch | 141,371,669.412 | 141,371,659.100 | -10.312 | -7.29e-06 | 1,426,960.297 | 1,426,960.297 | sim | 2.8e-14 | -33.33 % (inválido) | 12 |
| vaso Ø600×400 em cm (1 cm = 10 mm) | cm | 141,371,669.412 | 141,371,659.100 | -10.312 | -7.29e-06 | 1,426,960.297 | 1,426,960.297 | sim | 2.8e-14 | -33.33 % (inválido) | 12 |
| vaso Ø600×400 em m (1 m = 1000 mm) | m | 141,371,669.412 | 141,371,659.100 | -10.312 | -7.29e-06 | 1,426,960.297 | 1,426,960.297 | sim | 2.8e-14 | -33.33 % (inválido) | 12 |
| vaso Ø600×200 eixo +Y | mm | 84,823,001.647 | 84,822,991.335 | -10.312 | -1.22e-05 | 1,049,969.179 | 1,049,969.179 | sim | 2.8e-14 | -44.44 % (inválido) | 12 |
| vaso Ø600×200 eixo −Z | mm | 84,823,001.647 | 84,822,991.335 | -10.312 | -1.22e-05 | 1,049,969.179 | 1,049,969.179 | sim | 2.8e-14 | -44.44 % (inválido) | 12 |
| vaso Ø600×200 eixo oblíquo | mm | 84,823,001.647 | 84,822,991.335 | -10.312 | -1.22e-05 | 1,049,969.179 | 1,049,969.179 | sim | 1.9e-11 | -44.44 % (inválido) | 12 |
| 3 sólidos num arquivo | mm | 86,301,870.784 | 86,301,802.207 | -68.577 | -7.95e-05 | 5,724,191.375 | 5,724,191.375 | sim | 9.7e-14 | -27.15 % (inválido) | 64 |
| vaso Ø600×300 com bocal Ø80 no tampo (ref. construída) | mm | 111,946,256.897 | 111,946,256.897 | -0.000 | -8.92e-13 | 1,295,568.065 | 1,295,568.065 | sim | 2.2e-08 | -0.00 %  | 60 |
| elipsoide 600×300 (VERTEX_LOOP) | mm | 56,548,667.765 | 56,548,667.765 | -0.000 | -1.32e-14 | 780,469.443 | 780,469.443 | sim | 1.8e-13 | -100.00 %  | 1 |
| esfera Ø600 por revolução de CIRCLE (VERTEX_LOOP, à mão) | mm | 113,097,335.529 | 113,097,335.529 | +0.000 | +0.00e+00 | 1,130,973.355 | 1,130,973.355 | sim | 1.8e-13 | +0.00 %  | 1 |

"Sem correção" = leitor do OCCT direto no mesmo arquivo. "Variantes de laço" = quantas posições iniciais foram testadas.
Casos deliberadamente não confiáveis: geometria incoerente (reprovada e face apontada), leitura sem normalização (face
colapsada apontada, área 0), arquivo truncado (nunca válido), ângulo em graus (recorte pulado, proteção reprova).

## 8. Regressão

- vitest: **729 ok, 0 falha esperada**, 5 pulados (só Windows) — antes 696 ok + 1 falha esperada. `test:sem-eval`: igual.
- typecheck ok.
- E2E Chromium `e2e_step.py`: **40/40** (5 novos do P-F5-01). Build de produção com a CSP real `step_smoke_chromium.py`:
  **114/114** (antes 90; inclui os 2 arquivos novos). `e2e3d.py` 34/34, `e2e_sheet.py` 18/18.
- CSP: nenhuma violação; nenhum `unsafe-eval`.

## 9. Limitações restantes

- **Windows real não rodado** nesta sessão (sem PC Windows). Rodar `webview2_step_smoke.ps1` (já inclui os 2 arquivos novos)
  e o ciclo do instalador antes de homologar.
- Costura com polo nas duas pontas dentro de um EDGE_LOOP não é normalizada (não houve caso real; registrada e protegida).
- VERTEX_LOOP com ângulo plano em grau não recebe o recorte (registrado e protegido).
- A linha exata do tradutor do OCCT não foi isolada; vale abrir um relato no OCCT com `vessel_revolved.step` e a matriz §2.
- Custo da normalização: ~0,5 s para 2,5 MB com 400 faces de revolução; arquivo sem revolução: ~0 (atalho por texto).
