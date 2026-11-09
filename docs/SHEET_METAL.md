# AGTN SHEET METAL — convenções e fórmulas

Motor: `modules/sheetmetal` (`SheetMetalEngine`). Nenhuma fórmula fica na interface.
Nenhum valor é arredondado durante o cálculo; arredondamento só na exibição.

## Convenção angular

| Símbolo | Nome | Definição | L reto |
|---|---|---|---|
| **θ** | ângulo de dobra | quanto a chapa **muda de direção** (0 < θ < 180°) | 90° |
| **α** | ângulo interno da peça | ângulo entre as abas = **180° − θ** | 90° |

Todas as fórmulas usam θ (radianos). A interface aceita θ ou α e converte explicitamente.
Exemplo: uma dobra “aberta” com abas a 135° entre si tem α = 135°, θ = 45°.

## Grandezas (mm)

- `T` espessura · `R` raio interno · `K` fator K = (distância do eixo neutro à face interna) / T
- **BA** = θ · (R + K·T) — comprimento do eixo neutro na dobra
- **OSB** = (R + T) · tan(θ/2) — da tangência ao vértice virtual **externo**
- **ISB** = R · tan(θ/2) — da tangência ao vértice virtual **interno**
- **BD** = 2·OSB − BA — desconto para dimensões externas
- **BDi** = 2·ISB − BA — desconto equivalente para dimensões internas

## Modelo geométrico

O perfil é uma sequência de **trechos retos e arcos de dobra**. Percorrendo o perfil:
- **Face A** = face à esquerda do sentido de percurso; **Face B** = face à direita (a T de distância).
- Dobra à esquerda: face A por dentro (raio R), face B por fora (R + T). Dobra à direita: o inverso.

Cada aba é informada pelo comprimento medido em uma face, **até o vértice virtual** (interseção das linhas da face —
“mold line”) ou até a extremidade livre. “Externa/interna” é traduzida para a face correspondente — nunca há mistura
implícita. Em L/U/U enrijecido todas as dobras têm o mesmo sentido: externa = face B, interna = face A.

Para cada aba *i*:

```
reto_i = L_i − Σ (r_face · tan(θ/2))   sobre as extremidades dobradas da aba
         r_face = R (face interna da dobra) ou R + T (face externa)
```

Desenvolvimento: `L = Σ reto_i + Σ BA_j`, com θ, R e K **próprios de cada dobra**.
Equivalência verificada nos testes: com todas as dimensões externas, `L = Σ externas − Σ BD_j`.

A seção é construída a partir dos vértices virtuais da face A, com arcos tangentes de raio R ou R+T; a face B é
deslocada de T com arcos concêntricos. Isso garante por construção tangência e espessura constante, e é verificado
nos testes (perpendicularidade raio×aba, distância T, perímetro, autointerseção).

## Exemplo de validação (especificação)

L com abas externas 100 × 80, T = 3, R = 3, θ = 90°, K = 0,40:

| Grandeza | Valor |
|---|---|
| OSB | 6,0000 |
| BA = (π/2)(3 + 1,2) | 6,5973 |
| BD = 12 − 6,5973 | 5,4027 |
| Retos | 94,000 e 74,000 |
| **Desenvolvido** | **174,5973** |
| Linha de dobra (da borda da aba de 80) | 77,2987 |

Mesmas medidas como **internas**: retos 97 e 77 → desenvolvido 180,5973.

Outros casos de referência nos testes (`sheetmetal.test.ts`): 45° (108,7755), 135° (71,8756), U simétrico
50×100×50 (189,4774), U assimétrico com raios/ângulos/K diferentes (224,4938), U enrijecido, referência mista.

## Limites de validade

- 0 < θ < 180°. Acima de 150° o vértice virtual se afasta muito; o programa avisa para conferir a referência.
- Dimensão externa para θ > 90° é medida ao **vértice virtual**. Desenhos que cotam até a tangência externa
  precisam de conversão manual (referência “tangente” está no roadmap).
- Perfis de seção constante, dobras simples, sem alívios ou recortes (próximas fases). Bandejas: ver abaixo.

## Fator K

- Tabela padrão com **estimativas de partida** para dobra no ar por faixa de R/T ([0,1) · [1,3) · ≥3):
  alumínio 0,33/0,40/0,50 · aço carbono e galvanizado 0,38/0,43/0,50 · inox 0,40/0,45/0,50.
  São referências empíricas clássicas, **não valores certificados**, e aparecem identificadas como tal.
- Regras por material, processo, faixa de espessura e de R/T, com origem: teórico, estimado, manual, calibrado.
  Seleção: calibrado → manual → estimado → teórico; depois a faixa mais estreita.
- Tabelas, ensaios e configurações salvas ficam no projeto (`extras.sheetmetal`).

## Calibração por ensaio

Ensaio em L: tira de comprimento plano `Lp`, dobrada em θ medido, abas externas medidas `a` e `b`:

```
BD_obs = a + b − Lp
BA_obs = 2·(R + T)·tan(θ/2) − BD_obs
K_obs  = (BA_obs/θ − R) / T
```

O registro guarda material, processo, espessura nominal/medida, ferramenta, abertura V, raio do punção, ângulos
programado/medido, medidas antes/depois. Uma regra criada a partir do ensaio recebe origem **calibrado** e faixa
±5 % em T e ±10 % em R/T.

## Saída para fabricação

Camadas (nomes sem acento por compatibilidade com DXF R12):

| Camada | Conteúdo | DXF padrão |
|---|---|---|
| `CONTORNO_CORTE` | contorno fechado (polilinha) | sim |
| `LINHAS_DOBRA` | linha no centro de cada região de dobra — **não é corte** | sim |
| `REGIAO_DOBRA` | limites (tangências) da região de dobra | não |
| `COTAS` | comprimento, largura, posições e distâncias entre dobras | não |
| `CENTROS` | eixo neutro (seção) | não |
| `ANOTACOES` | sentido (CIMA/BAIXO), θ, R, K de cada dobra; título | não |
| `SECAO_PERFIL` | seção transversal | não |

“CIMA” = a face interna da dobra fica voltada para o observador na planificação.

## Arquitetura para novos perfis

`PROFILE_DEFS` declara abas, dobras e sentidos; o motor resolve qualquer sequência, inclusive sentidos alternados
(Z, cartola, ômega). Para esses perfis é preciso mapear explicitamente cada dimensão para a face medida
(`refToFace` recusa mapeamento implícito em perfis com sentidos alternados).

## Calandra

```
Ri = D/2 (diâmetro interno) ou D/2 − T (diâmetro externo)
Re = Ri + T        Rn = Ri + K·T
Desenvolvido = θ · Rn        (volta completa: π · (Di + 2·K·T))
```

- K padrão 0,50 (eixo neutro no meio da espessura; estimativa de partida, ajustável em CONFIGURAÇÕES).
- Segmento (< 360°): informa corda e flecha externas.
- Avisos: R/T < 5 (capacidade da calandra) e volta completa (pré-dobra das pontas / folga de solda).
- Como a calandra não marca a chapa, a planificação leva, na camada `MARCACAO`:
  `CALANDRAR RAIO EXTERNO|INTERNO R…` (a referência escolhida), os raios/diâmetros interno e externo, ângulo,
  espessura e desenvolvimento. Com “Marcação como geometria” ligada, o texto vira contorno para o laser gravar.

## Bandeja e bandeja enrijecida

Motor: `solveTray` / `trayFlatEntities` / `trayViewEntities` (`modules/sheetmetal/src/tray.ts`).

Fundo A (comprimento, X) × B (largura, Y). Abas nas quatro bordas — inferior (S) e superior (N) no lado A,
esquerda (O) e direita (L) no lado B — com comprimento próprio (0 = borda sem aba). Ângulo θ das abas comum
(90° = parede reta; < 90° abre para fora; > 90° fecha para dentro). **Enrijecida**: pestana (retorno) na ponta de
cada aba, comprimento por borda (0 = sem pestana), ângulo θ₂ e sentido **para dentro** (enrijecimento) ou
**para fora** (aba de fixação).

```
SB(θ) = (R+T)·tan(θ/2) externo  ·  R·tan(θ/2) interno        BA = θ·(R + K·T)
fundo plano   a = A − Σ SB(θ1)                 (bordas com aba)
reto da aba   f = H − SB(θ1) − SB(θ2)          (sem pestana: H − SB(θ1))
reto pestana  p = P − SB(θ2)
```

H é medido **ao longo da parede**, até os vértices virtuais, como nos perfis (em 90° é a altura); com pestana para
fora a medida externa da aba é de fora a fora (igual ao Z). Os retos e as posições das linhas de dobra são
conferidos nos testes contra o motor de perfis (`solveProfile`) para cada seção. A altura vertical da aba dobrada
aparece no resultado.

### Canto

A ponta de cada faixa do desenvolvimento (aba, pestana) vem de uma regra na peça dobrada, aplicada em cada
posição `v` do desenvolvimento — por isso vale para qualquer ângulo (a aresta sai inclinada quando precisa):

| Canto | Aba que fecha (lado A ou B) | Aba vizinha |
|---|---|---|
| Sobreposto | até a face externa da vizinha − folga | para na borda do fundo |
| Encosto | até a face externa da vizinha | até a face interna da que fecha − folga (canto fechado) |
| Esquadria | plano bissetor do canto (fibra mais interna) − folga/2 | idem (meia-esquadria) |
| Aberto | borda do fundo | borda do fundo |

Em 90°: sobreposto avança R+T (gabarito 710.0CUH25), encosto R+T e R, esquadria R nas duas. Com aba inclinada
use **esquadria**: a ponta da aba inclina cos θ por mm de aba (aresta da quina).

Pestanas: com pestana nas duas vizinhas, sempre em esquadria (a 45° em 90°) — senão se cruzariam; com pestana
só de um lado, a pestana para dentro vai até a face interna da aba vizinha e a para fora até a face externa.
A região de dobra vai de borda a borda da faixa anterior; o degrau que sobra é o alívio retangular.

**Alívio redondo** (opcional): furo no cruzamento das linhas de dobra das abas, em cada canto com duas abas.
Ø automático = √2·BA + T arredondado a 0,5 mm (alcança o canto do fundo); aviso se o Ø não alcançar.

Ordem de dobra: pestanas primeiro; depois as abas (cobertas antes das que fecham o canto). Marcação
`D1 CIMA 90,0° RI2,00` ao lado de cada linha (pestana para fora = BAIXO). Se as abas se cruzarem na chapa plana
(pestana grande demais para o canto escolhido) o cálculo para com erro.

### Validação

- Gabarito real `tests/dxf/fixtures/bandeja_710.0CUH25-01-03.dxf` (CH 3,18; 535 × 520 × 25,4; Ri 2; K 0,33;
  sobreposto pelo lado A): contorno de 20 vértices e 4 linhas de dobra idênticos.
- Retos e linhas de dobra = motor de perfis em 7 combinações (θ 60/75/120°, pestanas para dentro/fora,
  medidas internas, pestana a 45°, abas e pestanas diferentes por borda).
- Esquadria: inclinação da aresta = cos θ e simetria entre vizinhas; pestana em esquadria a 45°.
- DXF R12 (com os arcos dos furos de alívio) passa na auditoria do ezdxf.

## Marcação de dobra

Cada linha de dobra recebe ao lado, na camada `MARCACAO`, `D1 CIMA 90,0° RI3,00` (sentido, ângulo, raio interno).
