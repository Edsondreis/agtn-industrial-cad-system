# Texto para corte a laser

Motor: `modules/lasertext`. O texto é convertido em **polilinhas fechadas** (geometria), porque o CAM/laser não
corta entidades TEXT.

## Modos

| Modo | Resultado | Uso |
|---|---|---|
| Vazado | letras viram furos na chapa | placas, identificação em chapa |
| Emendado | letras formam uma peça só | letreiros, nomes em aço |
| Marcação | contorno das letras na camada `MARCACAO` | gravação |

### Pontes automáticas (vazado)
Cada “ilha” (miolo de O, A, B, D, P, R, 4, 6, 8, 9, 0…) cairia da chapa. O motor detecta a ilha e subtrai da letra
uma ponte vertical pelo centro da ilha (ou horizontal, se necessário), na largura configurada. O resultado é
verificado: ilhas restantes devem ser 0. Fontes stencil já trazem pontes próprias e normalmente não recebem pontes extras.

### Emendado
Glifos são unidos (regra não-zero da fonte + união booleana). Fontes cursivas ligam as letras; espaçamento negativo
aproxima; a barra de ligação inferior garante uma peça só. O programa informa quantas peças soltas restam
(ex.: acentos e pingos de i em fontes cursivas).

## Precisão
- Altura informada = altura das maiúsculas (cap height da fonte).
- Curvas Bézier aproximadas por segmentos com erro máximo de 0,01 mm.
- Verificação: traço estimado (2·área/perímetro) menor que a espessura da chapa → aviso; ponte estreita → aviso.

## Fontes (SIL Open Font License 1.1 — `modules/lasertext/fonts/licenses`)
Black Ops One, Allerta Stencil, Big Shoulders Stencil, Saira Stencil, Stardos Stencil (stencil);
Barlow Bold, Oswald SemiBold, Roboto Condensed Bold (industriais); Pacifico, Lobster (cursivas).
Subconjunto latino com acentos do português.
