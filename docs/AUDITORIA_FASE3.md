# Auditoria final — FASE 3 (modelagem paramétrica)

Data: 13/11/2026 · Branch `feature/agtn-3d-ia` · `main` não alterada (continua em `23a2540`).

## A. Resultado geral

**Aprovado com ressalvas.** Ressalva externa: falta validar no Windows real (WebView2, instalador NSIS,
memória, hardware). Ressalvas técnicas: as limitações da seção D (nenhuma delas bloqueia).

| Conjunto | Resultado |
|---|---|
| Vitest (TS) | **27 arquivos, 360 testes: 360 aprovados, 0 reprovados** (eram 324; +36 da auditoria) |
| Rust (`cargo test --release`) | **15/15** (+1: salvamento interrompido) |
| `e2e_param.py` (Chromium, mouse/teclado reais) | **25/25** |
| `e2e_param2.py` | **22/22** |
| `e2e_audit.py` (novo: integridade da interface) | **15/15** |
| `e2e3d.py` (regressão FASE 2, inclui 2D) | **34/34** |
| `load3d.py` (38 corpos, paisagem e retrato) | OK: quadro 1,1 ms (mediana), p95 2,8 ms |
| Tauri release Linux instalado: `tauri_param.py` | **5/5** (inclui alternância 2D ↔ 3D e memória) |
| Tauri release Linux instalado: `tauri_compiled.py` | **5/5** |
| Typecheck (TS estrito) | OK |
| Build (`npm run build`, `tauri build --bundles deb`) | OK — `.deb` 12,51 MiB |

Total executado: **481 verificações automáticas, 481 aprovadas, 0 reprovadas** (+ carga `load3d` em 2 orientações).

## B. Problemas encontrados

Todos reproduzidos por teste antes da correção (os testes novos falharam no código antigo: 9 de 12 no
`audit.test.ts` e 3 de 12 no `solver.audit.test.ts`).

| # | Problema | Gravidade | Causa raiz | Arquivos | Correção | Teste que comprova |
|---|---|---|---|---|---|---|
| 1 | Operação depois de uma falha ficava **"ok" sobre o sólido antigo** (ex.: rasgo falha, arredondamento seguinte "ok") | **Crítica** | `compute()` devolvia o sólido de entrada em caso de erro e o laço continuava avaliando normalmente | `core/solid/src/part.ts` | Novo estado `dependency_error`. A primeira falha numa operação que mexe no sólido quebra a cadeia: quem usa o sólido depois **não é avaliado**. Dependências explícitas (esboço, faces/arestas de origem, alvos) são conferidas antes de executar. `PartResult.failed` informa que o sólido exibido é o último válido | `audit.test.ts` › A01 (6 testes), `e2e_audit.py` |
| 2 | Base falha e o ressalto "unir" virava um sólido sozinho, marcado "ok" | **Crítica** | `apply(null, ferramenta, "join")` devolve a ferramenta | `part.ts` | Mesma regra do item 1 | "extrusão-base falha…" |
| 3 | A combinação usava o último sólido válido de um corpo-ferramenta **com erro**, e ficava "ok" (na regeneração e na prévia) | Alta | `BodyCache.external` e a prévia do worker não sabiam que a peça-ferramenta estava degradada | `core/model3d/src/evaluate.ts`, `apps/desktop/src/ws3d/engine.worker.ts` | Mapa `degraded`, `External.error` e `SyncReport.partial`. Combinação com ferramenta com erro → `dependency_error`. Corrigir a ferramenta recupera | `audit3d.test.ts` › "corpo-ferramenta…", `audit.test.ts` › combinação |
| 4 | **A referência trocava de face em silêncio** com faces coplanares: valia "a mais próxima do ponto antigo" | **Crítica** | `resolveFace`/`resolveEdge` desempatavam pela distância à semente | `part.ts` | Sem "mais parecida": (1) superfície recalculada; (2) só faces na fronteira do sólido da operação de origem; (3) semente sobre exatamente uma face. Sobrou mais de uma → **"Referência ambígua"** | "duas faces coplanares…": código antigo errava o volume em **1,74 %** (abria o topo do ressalto errado) |
| 5 | Não dava para escolher a borda de um furo (erro OCCT "no projection found") | Média | Semente = projeção do centro de massa, que no cilindro fica no eixo, fora da face | `part.ts` (`faceRefFor`) | Semente = ponto interior (centro UV + classificação, senão grade 5×5) | "mover o furo…" |
| 6 | Mover um furo perdia a referência da borda (erro explícito, mas sem acompanhar) | Média | Faces do furo sem âncora: semente com posição fixa | `part.ts`, `features.ts` (`role: "hole"`) | Âncora por centro do esboço: parede, parede do rebaixo, fundo do rebaixo | "mover o furo…" (volume idêntico) |
| 7 | Solver: ângulo 0° e 180° davam **"Sobredefinido" falso** e graus de liberdade errados | Alta | `|atan2|` tem derivada nula/descontínua em 0 e π; distância ponto-linha e tangência usavam `|·|` | `core/sketch/src/solver.ts` | Equações com sinal tirado da geometria inicial; ângulo reduzido a (−π, π] | `solver.audit.test.ts` (0°, 90°, 180°, 0,01°, 179,99°, ponto-linha 0) |
| 8 | Solver: **falha numérica relatada como "Inconsistente"** (dois pontos coincidentes com cota de 10 mm têm solução) | Alta | Jacobiano nulo no ponto inicial; qualquer não convergência era chamada de inconsistência | `solver.ts`, editor e UI do esboço | 3 reinícios determinísticos. "Inconsistente" só com prova: remover uma restrição resolve, ou mínimos quadrados estacionário com resíduo. Senão novo estado **"Não convergiu"** (o esboço é preservado do mesmo jeito) | "pontos coincidentes…" |
| 9 | Solver lento em esboço grande: 60 retângulos levavam 409 ms por resolução (cada clique) | Média | Sistema denso único (JJᵀ m×m e Gram-Schmidt sobre todas as variáveis) | `solver.ts` | Resolução por grupos independentes (união por entidades/restrições): **8 ms**. Matemática idêntica; conflitos localizados no grupo | "muitos elementos…" (< 3 s; medido 6–8 ms) |
| 10 | **Vazamento de formas OCCT**: +3 formas por regeneração; 123 ainda vivas depois de liberar tudo | Alta | `single()` devolvia o sólido de dentro do composto de `fuseAll` e o composto nunca era liberado (furos com rebaixo, extrusões com várias regiões, combinações) | `part.ts` | `single()` registra o composto como temporário | "sem vazamento…": 30 ciclos 19 → 19 formas; após liberar 0 |
| 11 | Arquivo com ids duplicados: o corpo inteiro sumia ("Operação duplicada") | Média | Exceção em `evaluate` | `core/model3d/src/persist.ts` | 2ª ocorrência renomeada (`id~2`) com aviso | "arquivo corrompido…" |
| 12 | Operação com campos ausentes podia derrubar o corpo inteiro | Média | `validateFeature` fora do `try` | `part.ts` | Vira erro da operação ("dados incompletos ou corrompidos") | "arquivo corrompido…" |
| 13 | Sólido sem volume positivo não era rejeitado; união sem contato e corte sem efeito passavam calados | Baixa | Faltava verificação | `part.ts` | Volume > 0 obrigatório; avisos "N sólidos separados" e "o corte não removeu material" (árvore ⚠ e propriedades) | A05 (3 testes) |
| 14 | Viewport e propriedades mostravam o último sólido válido **sem dizer que a árvore tinha erro** | Alta | Faltava o estado de falha da peça na interface | `Workspace3D.tsx`, `Tree3D.tsx`, `Props3D.tsx`, `FeatureProps.tsx`, `FeatureDialog.tsx`, `ws3d.css` | Faixa vermelha no viewport ("…falhou — exibindo o último sólido válido"); nota nas propriedades físicas; árvore distingue erro (vermelho) de não avaliada (âmbar) e mostra avisos | `e2e_audit.py` (7 verificações) |
| 15 | Clicar no corpo na árvore mantinha o painel da última operação (propriedades do corpo inacessíveis) | Baixa | Seleção de operação não era limpa | `Workspace3D.tsx` | Clicar no corpo limpa a operação selecionada | `e2e_audit.py` |
| 16 | Teste da FASE 3 exigia o comportamento errado do item 1 ("operações seguintes continuam") | Média | Teste confirmava o comportamento, não a correção técnica | `core/solid/src/part.test.ts` | Teste reescrito com justificativa no código | o próprio teste |
| 17 | *(introduzido nesta auditoria e corrigido antes do fechamento)* A partição do solver tratava a origem como variável → laço/erro em linhas presas na origem | Alta | `find()` sobre ponto fixo | `solver.ts` | Pontos fixos fora da partição; entidade só com pontos fixos → sistema único | pego pelo `e2e_param2.py`; teste unitário "entidades presas na origem…" |

**Decisão de projeto (documentada):** operação que depende de uma operação **suprimida** fica *suprimida
junto* (estado `suppressed` com causa), como nos CAD de histórico. Não é erro: a geometria sem ela é
intencional, então as operações independentes seguem "ok".

## C. Resultados de engenharia

**Propagação de erros.** Cinco estados inequívocos: `ok`, `error`, `dependency_error`, `suppressed`
(próprio ou pelo pai) e `rolledback` (não avaliada). Uma operação dependente nunca recebe `ok` sobre
geometria desatualizada. O cache por assinatura em cadeia garante que um estado em cache nunca vem de outra
versão da árvore. Corrigir a origem regenera a cadeia inteira, com volumes exatos (teste decisivo:
`[ok, ok, error, ok, dependency_error]` → corrigido → todos `ok`, volume = 120 000 − 4 000 − R5).
Árvore, viewport, propriedades e volume são coerentes (`e2e_audit.py`).

**Integridade das referências.** As 12 situações da especificação foram testadas:
- **Acompanham:** largura/altura do esboço, profundidade, raio anterior, posição do furo, quantidade do padrão (aumento), inserir/remover operações anteriores, faces coplanares, revolução e loft.
- **Erro explícito:** padrão reduzido até a cópia sumir; varredura com caminho maior; espelho com plano mudado.
- **Nunca troca em silêncio.** O teste confere que "acompanhou" significa volume igual ao de uma escolha nova da mesma entidade na geometria editada.
- **Determinismo:** avaliadores novos dão volume, área e nº de faces idênticos; salvar e reabrir dá volume idêntico bit a bit.

**Solver.** Diferencia convergido (`full`/`under`), redundante (`over`), inconsistente comprovado
(`inconsistent`, com as restrições citadas pelo nome) e falha numérica (`unsolved`). Casos com resposta
conhecida, todos aprovados (tolerância 1e-7 mm; relativa 1e-12 em geometria grande):
- esboço livre (4 GL), definido e parcial;
- restrições redundantes, incompatíveis e em cadeia (polígono de 20 lados);
- linhas paralelas a 0,001 mm;
- geometria de 1e6 mm e coordenadas negativas;
- 0,001 mm e cota quase zero;
- ângulos de 0°, 0,01°, 90°, 179,99° e 180°;
- 60 retângulos com 420 restrições.

A tolerância do resíduo acompanha a escala: máx(1e-9, 8·ε·|x|máx).

**Persistência.** Modelo com 45 operações + operação com erro + peça recuada + combinação entre corpos:
salvar → documento e motor novos → abrir → árvore, parâmetros, estados e volume idênticos. Depois: editar
uma operação intermediária → salvar/abrir → idêntico; Undo/Redo coerentes. O histórico de Undo/Redo é da
sessão e não vai para o arquivo (por projeto). JSON íntegro. Os casos abaixo abrem sem travar, com avisos
quando cabe:
- arquivos da FASE 2;
- arquivo sem 3D;
- campos ausentes;
- ids duplicados;
- referência a operação inexistente;
- lixo no arquivo;
- recuo fora do intervalo.

Salvamento interrompido deixa o original íntegro (teste Rust novo). Formato `.agtncad` inalterado (v1).

**Precisão geométrica.** Volumes contra fórmula com erro relativo ≤ 1e-9 (booleanas ~1e-12); varredura ≤ 1e-6.
Todo resultado é conferido com `isValid` e volume > 0.

**Desempenho.** Medido nesta máquina, que hoje está mais lenta que na FASE 3: o mesmo teste do código antigo
mede 817–905 ms agora, contra 538 ms naquela época.

| Operações | Completa | Editar 1ª | Meio | Última | Suprimir / reativar | Recuar / avançar | Salvar / abrir |
|---|---|---|---|---|---|---|---|
| 10 | 91 ms | 118 | 62 | 19 | 28 / 68 | 0 / 0 | 0,1 / 0,4 ms |
| 20 | 234 ms | 292 | 114 | 20 | 111 / 129 | 0 / 0 | 0,1 / 0,2 ms |
| 40 | 527 ms | 688 | 397 | 33 | 350 / 402 | 0 / 0 | 0,1 / 0,3 ms |
| 80 | 1 542 ms | 2 091 | 961 | 45 | 1 160 / 1 296 | 0 / 0 | 0,1 / 0,3 ms |

- Comparação intercalada no mesmo ambiente (benchmark de 40 operações da FASE 3, 3 rodadas): antes
  817/896/905 ms, depois 1 023/841/959 ms → **cerca de +8 % (dentro do ruído de ±12 %)**. É o custo da
  validação (volume positivo, nº de sólidos). O volume da entrada vem do cache, para não ser calculado duas
  vezes.
- Editar a última operação continua incremental (20–45 ms). Editar a primeira regenera tudo e custa cerca de
  1,3× a completa: inclui liberar o cache anterior.
- Solver: 60 retângulos em 8 ms (antes 409 ms).

**Memória.**
- Sem vazamento de formas OCCT depois da correção 10.
- Heap WASM estável em 128 MB.
- App Tauri compilado (Linux, render por software): 932–968 MB RSS (app + WebKit) após modelagem.
- O motor continua sendo liberado 2 min depois de sair do 3D (FASE 2).

**CAD 2D.** Suíte unitária completa aprovada (desenho, edição, cotas, chapa, DXF, DWG, impressão,
persistência), além do Rust de DWG/DXF e de E/S atômica. O teste 2D do `e2e3d.py` passou, e a alternância
2D ↔ 3D foi testada no navegador e no app compilado. Nada do 2D foi alterado nesta auditoria.

## D. Pendências

**Bloqueadores (Linux):** nenhum.

**Validação Windows: pendente, externa, não confundir com esta aprovação.** O CI do GitHub está bloqueado
por cobrança da conta. Continuam pendentes:
- Windows real;
- WebView2;
- instalador NSIS;
- consumo de memória no Windows;
- funcionamento em hardware real.

**Melhorias recomendadas**
1. Âncoras para faces de revolução, varredura e loft. Hoje usam semente; uma mudança de perfil dá erro explícito em vez de acompanhar.
2. Âncora da face cônica do escareado.
3. Solver: trocar JJᵀ (que eleva ao quadrado o número de condição) por QR quando surgir caso mal condicionado. A busca de conflitos fica limitada a 80 restrições por grupo.
4. "Não convergiu" com vários conflitos simultâneos usa o critério de mínimos quadrados estacionário. Pode, raramente, chamar de "não convergiu" um sistema realmente inconsistente; nunca o contrário.
5. Editar a primeira operação: liberar o cache em lote (hoje cerca de 1,3× a regeneração completa).

**Limitações conhecidas** (mantidas da FASE 3)
- Sem projeção de arestas do modelo no esboço.
- Sem elipse, spline ou filete 2D.
- Manipulador visual só na extrusão.
- Sem "espessar".
- Região do perfil escolhida por lista.
- A operação dependente de uma suprimida é suprimida junto (por projeto).

## E. Evidências

- Testes novos:
  - `core/sketch/src/solver.audit.test.ts` (13)
  - `core/solid/src/audit.test.ts` (17)
  - `core/model3d/src/audit3d.test.ts` (6)
  - `tests/e2e/e2e_audit.py` (15)
  - Rust `interrupted_save_keeps_original`
- Resultados: `tests/output/e2e_*/resultado.json`; logs do terminal registrados neste relatório.
- Capturas: `tests/output/e2e_audit/01_falha_intermediaria.png`, `02_apos_correcao.png` e as das FASES 2/3.
- Modelo de teste: `AGTN_AUDIT_OUT=pasta npx vitest run core/model3d/src/audit3d.test.ts` grava
  `auditoria_45_operacoes.agtncad` (45 operações, erro, peça recuada, combinação). Abre no AGTN CAD.

## F. Git

- Branch: `feature/agtn-3d-ia`.
- Commits: `c7c4378` (correções e testes principais) e `6998e72` (fechamento: relatório, interface e
  testes de fechamento). 28 arquivos alterados desde `fe4c7f3` (+1 998 / −138 linhas): `core/solid/src/part.ts`,
  `features.ts`; `core/sketch/src/solver.ts`; `core/model3d/src/evaluate.ts`, `persist.ts`, `features.ts`;
  `apps/desktop/src/ws3d/` (Workspace3D, Tree3D, Props3D, protocol, engine.worker, part/*, sketch/*, ws3d.css);
  `src-tauri/src/lib.rs` (só teste); testes e documentação.
- Status final: árvore limpa, tudo enviado para `origin/feature/agtn-3d-ia`.
- `main` não alterada: `origin/main` = `23a2540` (v3.1.1). Sem merge, sem cherry-pick.
