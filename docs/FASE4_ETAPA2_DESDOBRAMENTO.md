# FASE 4 · ETAPA 2.5 — Revisão matemática do desdobramento

Correção técnica pedida na aprovação (ponto 5): **não basta zerar o ângulo efetivo da dobra se isso também
zerar o BA.**

## 1. As quatro grandezas, separadas

| Grandeza | Onde fica | Muda ao desdobrar? |
|---|---|---|
| Ângulo nominal θ | `SolvedBend.deflectionDeg` (vem da operação) | **não** |
| Ângulo efetivo | `SolvedBend.effectiveDeg` (θ dobrada, 0 desdobrada) | sim |
| Comprimento desenvolvido da região de dobra BA = θ·(R + K·T) | `SolvedBend.BA`, calculado do θ **nominal** (`bend.ts`) | **não** |
| Estado | `SolvedBend.folded` (operações `desdobrar` / `redobrar` na árvore) | sim |

OSB, ISB, BD, SB e a planificação também vêm do θ nominal. Nenhuma fórmula do `bend.ts` foi alterada.

## 2. Por que θ = 0 na fórmula da dobra não serve

Posição da filha dobrada no sistema da pai (ETAPA 1):

```
G_filha = G_pai ∘ Rot(eixo, θ) ∘ Trans(−BA·n) ∘ P
P: origem em B + (BA − SB)·n, x = −d, y = n      (= posição da filha na planificação)
```

Com θ = 0, `Rot` vira a identidade, mas `Trans(−BA·n)` continua lá: a filha recua BA e encosta na tangência da
pai. A região de dobra **some** (BA zerado na prática). Erro exatamente como o descrito.

## 3. O que foi implementado

Para uma dobra **desdobrada**:

```
G_filha = G_pai ∘ P          (sem Rot e sem Trans(−BA·n): a posição da planificação)
região  = prisma plano  [tangência A…B] × [0, BA] × [0, T]  no plano da pai
```

- A filha fica a **BA** da tangência da pai. O teste mede essa distância no 3D: |p₁ − p₀| = BA, com tolerância de 1e-9.
- A planificação (`H`) não depende do estado. É a mesma, dobrada ou desdobrada.
- Volume da região desdobrada = BA·L·T (com recorte, Σ Δu·Δs·T). Isso segue o modelo do fator K, que conserva
  o comprimento da **fibra neutra**. Esse volume difere de θ·T·(R + T/2)·L, salvo com K = 0,5. A diferença é do
  modelo, não um erro numérico.
- Os cantos fechados (2.3) usam a posição **nominal** (`Gn`, tudo dobrado). Por isso desdobrar uma aba não muda o
  recorte do canto, e o teste confere áreas iguais com tolerância de 1e-12.

**Redobrar** não "gira de volta" nada. A peça inteira é recalculada do histórico com o estado `dobrada`. A
geometria nominal volta exata, sem acúmulo. Os testes comparam cada matriz `G` com 1e-12 e os rótulos das faces
do sólido OCCT.

## 4. Testes de reversibilidade (`modules/sheet3d/src/unfold.test.ts`)

| Caso | Prova |
|---|---|
| Desdobrar tudo | cada aba na posição da planificação (1e-9); V = T × área plana; caixa OCCT = blank × T |
| BA conservado | a filha desdobrada fica a BA da tangência; a pestana (D2) continua dobrada sobre a aba desdobrada |
| Várias dobras, várias ordens | `[desdobra tudo, redobra tudo]`, `[D1, D1]`, `[D1 + D3, D3, D1]`, `[D2, D1, D1 + D2]` → G idênticas |
| Recortes feitos desdobrado | furo na aba e recorte plano atravessando a dobra desdobrada (prisma em fatias) → ao redobrar, igual à peça recortada dobrada |
| Parâmetros mudando | θ 60°/120°/45°, T e R diferentes: desdobrada usa o BA do novo nominal; redobrada = peça nova |
| Canto fechado | desdobrar uma das abas não muda as áreas do canto |
| Erros | REFOLD_FOLDED, UNFOLD_TWICE, REFOLD_NONE, REF_LOST |
