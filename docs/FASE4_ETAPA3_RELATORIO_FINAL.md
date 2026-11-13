# FASE 4 · ETAPA 3 — Relatório final: validação industrial, homologação e auditoria de engenharia

Data: 13/11/2026 · Branch `feature/agtn-3d-ia` · `main` = `23a2540` (v3.1.1), **não alterada**.
Nada foi mesclado, publicado ou liberado para produção.

## Veredito: **HOMOLOGAÇÃO PENDENTE**

O que dava para provar sem recursos externos foi provado, com evidência:
- geometria, fórmulas e proveniência;
- 10 peças de referência e 1 peça real (bandeja 710.0CUH25-01-03) igual ao DXF de produção;
- DXF R12/R2000 válidos em leitura automática;
- persistência de todas as fases;
- 2D idêntico à v3.1.1;
- desempenho e estabilidade no contêiner.

Ainda faltam validações essenciais: **Windows real, ZWCAD/AutoCAD, CAM do laser e peças reais com tolerâncias da engenharia.** Sem elas, o sistema **não está homologado para produção**.

## Matriz final

| # | Teste | Status | Documento |
|---|---|---|---|
| W1 | Build completo Windows | **PENDENTE** | WINDOWS |
| W2 | Instalação limpa | **PENDENTE** | WINDOWS |
| W3 | Atualização sobre a 3.1.1 | **PENDENTE** | WINDOWS |
| W4 | Desinstalação | **PENDENTE** | WINDOWS |
| W5 | Caminhos com espaço/acento | **PENDENTE** | WINDOWS |
| W6 | PC sem ferramentas de desenvolvimento | **PENDENTE** | WINDOWS |
| W7 | Funcional no Windows | **PENDENTE** | WINDOWS |
| G1 | Fórmulas `bend.ts` × geometria independente | **APROVADO** | GEOMETRIA |
| G2 | Bateria de casos, recursos, edição, desdobrar/redobrar | **APROVADO** | GEOMETRIA |
| G3 | Medidas no B-Rep do OCCT | **APROVADO** | GEOMETRIA |
| G4 | Proveniência sob edição | **APROVADO** | GEOMETRIA |
| I1 | 10 peças de referência (9 sintéticas + 1 real) | **APROVADO** (geometria/DXF) | VALIDACAO_INDUSTRIAL |
| I2 | Peças reais com tolerância da engenharia | **PENDENTE** | VALIDACAO_INDUSTRIAL |
| D1 | Validação automática DXF (20 arquivos) | **APROVADO** | DXF_CAM |
| D2 | Camadas por entidade | **APROVADO** | DXF_CAM |
| D3 | ZWCAD | **PENDENTE** | DXF_CAM |
| D4 | AutoCAD | **PENDENTE** | DXF_CAM |
| D5 | CAM do laser | **PENDENTE** | DXF_CAM |
| P1 | Desempenho/estabilidade no contêiner | **APROVADO** (após F-01) | PERFORMANCE |
| P2 | Desempenho em hardware real | **PENDENTE** | PERFORMANCE |
| C1 | `.agtncad` das FASES 2, 3, ETAPAS 1, 2 | **APROVADO** | VALIDACAO_INDUSTRIAL |
| C2 | DXF igual antes/depois de reabrir | **APROVADO** | VALIDACAO_INDUSTRIAL |
| R1 | Regressão 2D × v3.1.1 (hashes) | **APROVADO** | REGRESSAO_2D |
| R2 | DWG nativo | **APROVADO** (Linux) · **PENDENTE** (Windows) | REGRESSAO_2D |

Resumo, em 24 itens:
- **12 APROVADO:** G1–G4, I1, D1, D2, P1, C1, C2, R1, R2 (Linux);
- **12 PENDENTE:** W1–W7, I2, D3–D5, P2, além da parte Windows do R2;
- **0 REPROVADO**.

## O que foi executado (números exatos)

| Conjunto | Resultado |
|---|---|
| Vitest (monorepo) | **571 aprovados, 0 reprovados, 1 pulado** (o "grande" de desempenho, que roda com `AGTN_PERF=1` e passou: 3/3) · 51 arquivos · eram 522 no início da etapa |
| Typecheck TS estrito | OK |
| `cargo test --release` com DWG reais | **15/15** (Linux) |
| e2e no Chromium, mouse/teclado reais | **138/138**: `e2e3d` 34, `e2e_param` 25, `e2e_param2` 22, `e2e_audit` 15, `e2e_sheet` 18, `e2e_etapa2` 24 |
| `load3d.py` (38 corpos) | quadro 0,7 / 0,8 ms (mediana), p95 1,2 / 1,8 ms |
| ezdxf 1.4.5, leitura independente dos 20 DXF | 0 erros, 0 correções, 54 contornos de corte fechados |
| Equivalência da correção F-01 | 3 007 esboços e 27 245 regiões, saída idêntica byte a byte |

Os e2e e a suíte completa rodaram **depois** da correção F-01.

## Falhas encontradas

| ID | Gravidade | Módulo / arquivo | Descrição | Como reproduzir | Esperado | Obtido | Causa raiz | Correção | Teste que comprova | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| F-01 | **MÉDIA** | `core/sketch/src/profile.ts` (só 3D) | Detecção de regiões do esboço lenta com muitos furos | `profiles()` num esboço com 120 círculos | < 1 s | 8 262 ms; chapa 2000×1000 com 120 furos: 9,3 s por edição | `sameComponent()` comparava todos os vértices de todos os pares de laços, O(N²·P²) | pré-filtro exato por caixa envolvente (mesma resposta, sem comparar ponto a ponto) | 32 ms; peça grande 1,1 s; saída idêntica byte a byte em 3 007 esboços; 571/571; e2e 138/138 | **CORRIGIDA** (`1d3eba4`) |
| F-02 | **BAIXA** | `tests/industrial/pecas_reais/README.md` | O README dizia que o comparativo de peças reais confere a posição das dobras e os vértices; o teste só confere a quantidade de linhas de dobra | ler o README × `realparts.test.ts` | documentação igual ao teste | documentação prometia mais | texto escrito antes do teste | README corrigido; a conferência ponto a ponto fica para quando chegarem as peças | revisão do texto contra o código | **CORRIGIDA** (nesta entrega) |

Nenhuma falha **CRÍTICA** ou **ALTA** foi encontrada no que foi testado. Isso não cobre o que ficou PENDENTE.

## Correções e arquivos modificados

**Código de produto:** só `core/sketch/src/profile.ts`, com o pré-filtro da F-01. Não existe na main, e o 2D não foi tocado. Sem alteração em:
- `bend.ts` e `tray.ts`;
- `modules/dxf` (só um teste novo), `core/geometry`, `core/document` e `modules/plot`;
- o exportador 2D;
- o formato `.agtncad`.

**Testes novos:**
- `modules/sheet3d/src/audit3.test.ts`, `perf3.test.ts` e `persist3.test.ts`;
- `modules/sheet3d/src/industrial/parts.ts`, `industrial.test.ts`, `realref.test.ts` e `realparts.test.ts`;
- `modules/dxf/src/regressao2d.test.ts`.

**Dados de referência:**
- `tests/regressao2d/`: desenho e hashes gerados pela main e o gerador;
- `modules/sheet3d/src/fixtures/fase2_projeto_3d.agtncad` e `fase3_peca_parametrica.agtncad`;
- `tests/industrial/pecas_reais/`: README e modelo de ficha;
- `tests/industrial/CHECKLIST_DXF.md`.

**Script:** `scripts/windows/homologacao.ps1`.

**Documentos:** `docs/FASE4_ETAPA3_*.md` (8).

Nenhum teste foi excluído e nenhum critério foi relaxado.

## Commits (branch `feature/agtn-3d-ia`, enviados)

| Commit | Conteúdo |
|---|---|
| `fa604c6` | auditoria inicial, auditoria geométrica, 10 peças de referência, peça real, estrutura de peças reais, script Windows |
| `1d3eba4` | persistência de todas as fases, regressão 2D × v3.1.1, desempenho e correção F-01 |
| (este) | relatórios da ETAPA 3, checklist DXF, README de peças reais corrigido |

## Riscos

| Risco | Gravidade | Situação |
|---|---|---|
| CSP nova (`'wasm-unsafe-eval'`, `worker-src blob:`) no WebView2 | **ALTA até ser vista** | funciona no Chromium e no WebKitGTK; no WebView2 não foi testada. Se bloquear, o 3D não abre no Windows |
| Instalador NSIS nunca gerado nesta etapa | ALTA até o W1 | sem build Windows, não se sabe o tamanho, a assinatura nem a inclusão do `occt-wasm.wasm` |
| K das peças | MÉDIA | os testes usam K padrão; a peça física depende do K calibrado da AGTN (material × T × ferramenta) e do retorno elástico, que o CAD não mede |
| CAM importar todas as camadas | MÉDIA (operacional) | linhas de dobra e texto de referência viriam como corte. Precisa de filtro de camadas no CAM (D5) |
| R12 sem unidade gravada | BAIXA | inerente ao R12; preferir R2000 |
| Desempenho medido só no contêiner | MÉDIA | P2 pendente |

## O que a AGTN precisa fornecer

1. **Rodar `homologacao.ps1`** no PC Windows e me mandar `homologacao.log`, `resumo.json` e o instalador gerado. Isso destrava W1, R2 no Windows e, em seguida, W2–W7 e P2.
2. **Liberar uma pasta do PC** nesta sessão (ou copiar o zip para lá) e **aprovar o controle de tela** do ZWCAD e do app instalado, para D3 e W7. Ou o próprio Edson preenche o `CHECKLIST_DXF.md`.
3. Dizer se há **AutoCAD** disponível (D4).
4. **Operador do laser:** importar os 20 DXF no CAM, preencher a coluna "CAM importa" e informar o nome e a versão do CAM e a máquina (D5).
5. **Peças reais:** de 5 a 10, cada uma com desenho, o DXF que já foi produzido com sucesso, material, T, R e K calibrado (I2).
6. **Tolerâncias aprovadas pela engenharia** para blank, área, corte e posição de dobra (I2).
7. **Instalador da 3.1.1**, para o teste de atualização (W3).

## Próximo passo

Com o log do W1, faço W2–W7 e P2 no PC e atualizo este relatório. Mesmo com tudo aprovado, **merge na main e publicação só com autorização expressa do Edson.**
