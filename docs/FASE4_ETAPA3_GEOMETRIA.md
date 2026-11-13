# FASE 4 · ETAPA 3 — Integridade geométrica, matemática e paramétrica

Data: 13/11/2026 · Executado no contêiner Linux (occt-wasm 5.17.1 / OCCT 8) · Testes: `modules/sheet3d/src/audit3.test.ts` (27).
Saída medida: `tests/output/auditoria_geometria.json`.

## Resultado

| # | Verificação | Status |
|---|---|---|
| G1 | Fórmulas do `bend.ts` contra geometria pura (independente) | **APROVADO** |
| G2 | Bateria de casos (§5.2) + recursos + edição + desdobrar/redobrar | **APROVADO** |
| G3 | Medidas lidas no B-Rep do OCCT (espessura, raios, eixos, ângulo, caixa) | **APROVADO** |
| G4 | Proveniência sob edição paramétrica | **APROVADO** |

O `bend.ts` continua sendo a fonte única das fórmulas e não foi alterado. O mesmo grafo continua gerando o sólido 3D e a planificação. O teste **não** é um segundo motor: ele mede o que o motor produziu contra geometria elementar escrita à parte (seção da chapa, arco neutro integrado, interseção de tangentes).

## G1 — fórmulas

50 combinações: θ ∈ {1, 15, 30, 45, 60, 90, 120, 135, 150, 170}° × (R, T, K) ∈ {(0,5; 1; 0,33), (2; 2; 0,43), (6; 3,18; 0,45), (20; 6,35; 0,5), (0; 2; 0,33)}. Fórmulas:
- BA = θ(R + K·T)
- OSB = (R + T)·tan(θ/2)
- ISB = R·tan(θ/2)
- BD = 2·OSB − BA

| Grandeza | Referência independente | Maior erro |
|---|---|---|
| BA | comprimento da fibra neutra integrado com 20 000 cordas | **9,2 × 10⁻¹⁰** relativo (é o erro da própria integração) |
| OSB, ISB | interseção das retas tangentes às faces externa/interna | < 10⁻⁹ × máx(1, valor) |
| BD | 2·OSB(tangentes) − BA(integrado) | < 10⁻⁷ × máx(1, OSB) (limite da integração) |

Convenções conferidas:
- θ = deflexão, e θ = 0 é chapa plana;
- α = 180° − θ;
- K vem da tabela/operação com a origem registrada (não é constante universal).

## G2/G3 — sólido e planificação contra um modelo de seção independente

O modelo de seção é escrito no próprio teste. Ele percorre as faces A e B da chapa: trechos retos = H − SB do início − SB do fim, e arcos de raio R e R+T. Para cada caso foram conferidos:
- sólido válido (`isValid`), exatamente 1 sólido, 0 arestas livres;
- volume do OCCT = fórmula V = ΣA·T + Σθ·T·(R+T/2)·L;
- caixa envolvente precisa do OCCT = caixa da seção;
- raios dos cilindros = {R, R+T} em cada dobra;
- eixos dos cilindros passando pelos centros dos arcos da face B;
- normais das faces planas = direções das abas;
- planificação: blank, área, comprimento de corte = 2(W + comprimento), posição das linhas de dobra, BA;
- sem autointerseção.

Casos:
1. chapa plana;
2. dobras de 90°, 45° e 135°;
3. duas dobras em sentidos opostos (Z);
4. três dobras sequenciais com alturas diferentes;
5. raios diferentes por dobra (1, 3, 6, 8);
6. T = 1 mm e T = 6,35 mm;
7. K diferente por dobra;
8. medidas internas.

| Medida | Maior desvio em toda a bateria |
|---|---|
| Volume OCCT × fórmula independente | **8,6 × 10⁻¹⁶** relativo |
| Blank AGTN × seção independente | **1,4 × 10⁻¹⁴ mm** |
| Caixa OCCT × seção | **7,1 × 10⁻¹⁵ mm** |

Tolerâncias do teste: 10⁻⁹ relativa no volume, 10⁻⁶ mm na caixa e 10⁻⁷ mm nos raios. São tolerâncias numéricas de verificação, **não** tolerâncias de fabricação.

### Recursos

Para cada recurso: sólido fechado e válido e volume do OCCT = volume do grafo. Onde existe referência independente, ela também foi conferida.
- recuos 20/30 (faixa parcial);
- alívio retangular, oblongo e lágrima;
- furo a 0,5 mm da tangência;
- recorte plano atravessando a dobra;
- caixa com 4 cantos sobrepostos;
- caixa com 4 cantos em esquadria.

Recorte que **encosta** na região de dobra sem atravessá-la: bloqueado com `CUT_EDGE`. Nunca é aproximado; é limitação documentada.

### Edição e repetição

- Editar H, θ, T e R e voltar ao valor original dá peça idêntica (nada acumula).
- Desdobrar/redobrar 10 vezes seguidas dá volume **idêntico bit a bit** (81 498,26500014796 mm³) e mesmas G.

## G4 — proveniência

- Rótulos das faces, chaves da planificação e chaves dos furos não mudam ao editar H e T (mesma topologia): 32 faces, 3 chaves de planificação.
- Em cada build: nenhuma face sem origem no grafo, e nenhum rótulo fora da superfície que o grafo gerou.
- Teste de adulteração: trocar um rótulo de propósito faz o build parar com "Proveniência inconsistente".
- O laço do recorte plano não cruza nenhuma aresta da planificação (entalhe exato).

## Peça real (geometria)

A bandeja 710.0CUH25-01-03 refeita pelo caminho 3D deu a mesma planificação do DXF de produção (`realref.test.ts`):
- os mesmos 20 vértices, a 10⁻⁶ mm;
- mesmas linhas de dobra;
- perímetro 2310,0798905514 mm;
- blank 574,6599726378568 × 559,6599726378568 mm.

O módulo 2D de bandejas (v3.1.1) dá 574,6599726378566: diferença de 2 × 10⁻¹³ mm entre os dois caminhos.

## Limitações (continuam explícitas, nenhuma foi removida)

- Alívio de canto redondo: bloqueado.
- Círculos, arcos e oblíquos cruzando dobras: bloqueados.
- Recortes só dentro do contorno.
- Canto só entre abas irmãs.
- Encosto e esquadria exigem folga positiva.
- Solda não modelada.
- Aba em leque não suportada.
