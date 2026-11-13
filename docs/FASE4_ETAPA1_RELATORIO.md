# FASE 4 · ETAPA 1 — Sheet Metal 3D · Relatório técnico

Branch `feature/agtn-3d-ia`. **Sem merge na `main`**. A `main` não foi alterada.
Data: 13/11/2026.

## 1. Resultado

A ETAPA 1 está implementada e testada **no Linux**. A validação em **Windows real continua pendente**: não foi executada.

Uma peça de chapa é um **grafo paramétrico** de abas planas ligadas por dobras. O mesmo grafo gera o sólido OCCT e a planificação. As fórmulas de dobra são só as do `bend.ts` (BA, OSB, ISB, BD), sem nenhuma alteração. Os arquivos 2D de chapa (`bend`, `engine`, `tray`, `profiles`, `output`, `materials`, `rolling`, `index`, a área 2D de chapa, o CAD 2D, o DXF e o Rust) **não foram tocados**: `git diff 0f5ea29..HEAD` vazio para eles.

| Operação (nomenclatura aprovada) | Estado |
|---|---|
| Base de chapa | contorno fechado só de retas + furos; T, material, processo, R, K (tabela material × processo × R/T, com origem, ou manual); referência externa/interna; material para cima/baixo |
| Aba lateral | uma aba por aresta inteira; várias arestas por operação; canto aberto automático |
| Flange de contorno | perfil aberto de seção constante ao longo de UMA aresta reta, conferido pelo `solveProfile` |
| Dobra (por linha) | linha de esboço sobre a face da aba = centro da região de dobra; lado fixo; sentido |
| Recorte / furo | contornos fechados do esboço sobre a face da aba, passantes, na região plana |
| Ângulo personalizado | θ, R e K por aba ou por segmento |
| Planificação | Dobrado/Planificado no viewport (sólido real do mesmo grafo), painel de medidas, envio ao DESENHO nas camadas de fabricação existentes |

Não foram implementados, de propósito (ETAPA 2 em diante):
- aba de borda;
- flange em arestas;
- alívios;
- fechamento de canto;
- desdobrar/redobrar;
- DXF da planificação 3D;
- perfis estruturais;
- caldeiraria;
- montagens.

## 2. Commits

| # | Commit | Conteúdo |
|---|---|---|
| 1 | `ac6b471` | modelo + solver puros (`modules/sheetmetal/src/sheet3d`), testes cruzados |
| 2 | `864e65e` | planificação + validação |
| 3 | `9aaa3f3` | motor OCCT (`modules/sheet3d`), proveniência, interferência, ponto de extensão `SheetBackend` no `PartEvaluator` |
| 4 | `48d18a3` | persistência que preserva campos desconhecidos, worker e protocolo |
| 5 | `ca14612` | interface Chapa + e2e |
| 6 | este | relatório, regressão completa, Tauri Linux, correção no `NumField` |

## 3. Decisões das 5 questões — como ficaram no código

**2.1 Ângulo**
- `deflectionDeg` (θ) é o único ângulo guardado. `includedDeg` (α) é só derivado.
- A interface mostra θ e α lado a lado; digitar α = 135° grava θ = 45° (testado no motor e na interface).
- O texto da FASE 4 (§4.1.3) tinha θ e α invertidos; foi seguido o código (`bend.ts`).

**2.2 Proveniência**
- Rótulo semântico em cada face no momento da geração da peça (prisma ou setor).
- Propagação pelo histórico do OCCT:
  - fusão geral `booleanOp(Fuse)` com `inputFaceHashes`;
  - depois `unifySameDomainWithHistory`.
- Conferência de cada rótulo contra a superfície exata do grafo.
- Contatos previstos podem sumir. Qualquer outra face que suma é erro.
- Colisão de hash: detectada; refaz com outro limite; se esgotar → erro.
- Recuperação por geometria só se o id sumiu: uma aresta na mesma reta → aceita com aviso, mantendo o id da aba-filha; duas → "referência ambígua".

**2.3 Volume**
- Divisão exata por região:
  - aba plana até a tangência;
  - setor θ·T·(R+T/2)·L;
  - contatos com volume zero;
  - canto aberto vazio.
- `V = Σ A·T + Σ θ·T·(R+T/2)·L`, conferido no OCCT com tolerância relativa de 1e-9.
- K = 0,5 → V = T·área plana. K = 0,33 → a diferença exata também é testada.

**2.4 Compatibilidade**
- Todo dado de chapa fica dentro das operações (`part.features`).
- O parser preserva campos desconhecidos no modelo, no nó e na fonte.
- Operação desconhecida → erro claro e é mantida no arquivo.
- Formato continua v1.

**2.5 Flange de contorno**
- Perfil aberto, uma aresta reta, seção constante.
- Validado pelo `solveProfile`: mesmas mensagens de `FLANGE_SHORT` e autointerseção.
- **Mudança em relação ao fechamento:** o perfil é dado por uma **tabela de segmentos** (comprimento, θ/α, sentido, R, K), como no AGTN SHEET METAL 2D, e não por um esboço. Motivo: um esboço exigiria um plano normal à aresta, que ainda não existe na interface. Desenhado em outro plano, o perfil apareceria num lugar diferente do flange. A tabela é exata e paramétrica, e é exatamente a entrada do `solveProfile`.

**Os quatro cuidados**
1. **Ângulos com sinal:** medidos no OCCT com normais orientadas, em torno do eixo da dobra. Testado:
   - θ ∈ {30, 45, 90, 120, 135}° nos dois sentidos;
   - α medido pelas faces de ponta;
   - lado de dentro (raio R) conferido.
   O motor faz a mesma verificação em toda regeneração: ângulo medido ≠ θ → erro.
2. **Canto aberto:** a fusão bem-sucedida não basta. As peças não vizinhas são testadas por volume comum, inclusive as dobras irmãs, que se cruzam com θ > 90°. Interferência → erro com as abas e o volume em mm³. Contato sem volume → aviso. Também são conferidos: volume total = soma das peças, nenhuma face não-contato sumida, espessura medida, caixa exata.
3. **Tolerâncias separadas** (`tolerance.ts`):

   | Tipo | Valor |
   |---|---|
   | Numérica | 1e-9 × tamanho |
   | OCCT | 1e-7 mm |
   | Dimensional | máx(1e-6 mm, 1e-9 × tamanho); ângulo 1e-7° |
   | Interferência | máx(1e-6 mm³, 1e-9 × V) |
   | Contato | 1e-6 mm |
   | Área (planificação) | máx(1e-6 mm², 1e-9 × A) |
4. **Determinismo:** a base é a aba-raiz fixa e a regra de rebatimento é única (`H = H_pai ∘ P`, `G = G_pai ∘ Rot(θ) ∘ Trans(−BA·n) ∘ P`). Testes:
   - mesma entrada → resultado igual bit a bit;
   - editar comprimento, θ, R ou T não move as outras abas;
   - salvar/reabrir → mesmo sólido, mesma proveniência, mesma planificação.

## 4. Testes (resultados reais)

| Conjunto | Resultado |
|---|---|
| Vitest (suíte completa) | **450/450**, 34 arquivos (linha de base da etapa: 360). Typecheck OK. Build OK |
| `sheet3d.test.ts` (motor puro) | 27: fórmulas, θ/α, ângulos com sinal, determinismo, volume, erros, dobra por linha, recortes |
| `cross.test.ts` | 15 |
| `flat.test.ts` | 8 |
| `build.test.ts` (OCCT) | 22 |
| `backend.test.ts` (PartEvaluator) | 11 |
| `compat.test.ts` + `compat4.test.ts` | 3 + 4 |
| e2e Chromium (mouse real) `e2e_sheet.py` | **18/18** (duas execuções seguidas) |
| e2e de regressão | `e2e3d` 34/34 · `e2e_param` 25/25 · `e2e_param2` 22/22 · `e2e_audit` 15/15 |
| DXF (`validate:dxf`, ezdxf) | OK |
| Tauri Linux release (`.deb` 12,5 MiB) | compilou; app compilado: `tauri_sheet.py` 3/3 · `tauri_param.py` 5/5 · `tauri_compiled.py` 5/5 |

Detalhe dos testes cruzados:
- **Com `solveProfile`:** perfis L, U, Z e cartola com R/K/θ diferentes, nas medidas externa e interna. Iguais a 1e-9: linhas de dobra, início e fim da região, desenvolvimento, retos e pontos de tangência das faces A/B na peça dobrada.
- **Com `solveTray`:** 710.0CUH25-01-03 em canto aberto, interna, θ 60°, abas diferentes. Iguais: área, blank, regiões de dobra, contorno (vértices) e comprimento de corte. As linhas de dobra coincidem com as do canto sobreposto real, a menos de uma translação.

Detalhe do e2e `e2e_sheet.py`:
- esboço cotado;
- base;
- aba escolhida clicando a aresta;
- volume = grafo (1e-6);
- K da tabela com origem "estimado";
- planificação 50 + 30 − BD;
- α 135° mostra θ 45°;
- editar o comprimento;
- flange de contorno: planificação 140 − 3·BD;
- Ctrl+Z/Ctrl+Y;
- T 3 mm;
- Dobrado/Planificado + painel;
- salvar/reabrir idêntico;
- DESENHO com contorno, 3 linhas de dobra, 6 limites e marcação `D1 CIMA 90,0° RI2,00`…

## 5. Tempos de processamento

| Caso | Tempo |
|---|---|
| Grafo (solve) de 20 abas | 1,0 ms |
| OCCT, 20 abas (10 laterais + 10 retornos, base de 10 lados), Node | 576–778 ms: peças 124, interferência 272, fusão 142–293 |
| Interface (Chromium), peça com 4 abas / 3 dobras | regeneração 98 ms (grafo + OCCT); barra de status "regen 157 ms" |

A meta de referência de 500 ms para 20 abas **não foi atingida** (≈0,6–0,8 s). O que mais pesa é o teste de interferência par a par. Ele fica como está, porque é a garantia do cuidado 2. A otimização fica registrada como pendência.

## 6. Ambiente compilado

- `npm run tauri build -- --bundles deb`: release OK, instalado com `dpkg`.
- `tauri-driver` + `WebKitWebDriver`, sob `xvfb`:
  - `tauri_sheet.py` **3/3**: base 100 × 50 × 2; aba clicando a aresta, com volume = grafo; Planificado 100 + 30 − BD.
  - `tauri_param.py` **5/5**: esboço cotado, extrusão, editar cota e regenerar, 2D → 3D; memória 991 MB RSS (app + WebKit, render por software).
  - `tauri_compiled.py` **5/5**: protocolo `tauri://`, motor OCCT carregado do recurso do instalador, sólidos, seleção de face real; memória 924 MB RSS.
- `.deb` final: `AGTN Industrial CAD_3.1.1_amd64.deb`, SHA-256 começando por `2aea65682c590999`.

## 7. Limitações conhecidas (ETAPA 1)

**Geometria**
- Base: contorno só de retas.
- Recortes: só internos (não tocam borda nem região de dobra).
- Dobra por linha:
  - só na base ou em parte de outra dobra por linha;
  - a linha deve cruzar duas arestas perpendiculares, longe dos cantos;
  - as arestas cruzadas do lado fixo não podem receber aba depois.

**Encadeamento**
- Depois de uma operação sólida genérica, a planificação fica inválida, com o motivo.
- Uma operação de chapa depois de uma genérica → erro.

**Recuperação de referência**
- Usa a posição gravada no momento da escolha. Se uma cota mudou e a linha foi refeita, a recuperação não acontece e a referência fica "perdida" (erro explícito).

**Outros**
- K da tabela de partida = estimado: aparece um aviso na árvore.
- Planificação: envio ao DESENHO feito; DXF direto da planificação 3D fica para a ETAPA 2.
- Desempenho: ver §5.
- Correção num componente compartilhado da interface:
  - `NumField` passou a ignorar a perda de foco sem digitação;
  - antes, θ ↔ α ou Esc podiam regravar o texto antigo;
  - vale também para o 2D, cujas regressões continuam verdes.
- **Windows real:** não testado (GitHub Actions bloqueado por cobrança). Nenhuma validação Windows foi declarada.

## 8. Evidências

- Capturas:
  - `tests/output/e2e_sheet/01_planificado.png`
  - `02_dobrado.png`
  - `03_desenho.png`
  - `20_app_compilado_planificado.png`
- `tests/output/e2e_sheet/resultado.json`
- Fixture de compatibilidade: `core/model3d/src/fixtures/fase4_desconhecido.json`.
