# FASE 5 — Importação DXF e STEP + motor 3D: homologação

Data: 2026-11-15 · Branch `feature/agtn-3d-ia` · build do instalador: commit **c3497a3** (código do app); scripts de
ciclo até e9214a4 · `main` intocada (23a2540) · sem merge, Release ou tag · versão de homologação **3.2.0-2** (não publicar).

## 1. Resumo

O AGTN Industrial CAD abre e mostra DXF e STEP/STP dentro do próprio programa.
- **DXF:** o leitor existente foi preservado e auditado contra uma biblioteca independente.
- **STEP:** abre como **documento próprio, só de leitura**, com o motor OCCT 8 já homologado. O projeto `.agtncad` não
  é alterado.
- **Windows nativo:** build MSVC, instalador NSIS e ciclo real passaram em **15/15 itens**. No app instalado: 76/76 de
  regressão e 138/138 de DXF/STEP.

**Conclusão: HOMOLOGAÇÃO PENDENTE** em um único item, superfícies curvas. É uma falha do leitor STEP do OCCT 8 com
superfície de revolução de geratriz elíptica (P-F5-01). O programa detecta e avisa, mas não corrige. Todo o resto foi
aprovado.

## 2. Escopo e regras seguidas

- Auditar os dois repositórios antes de mudar qualquer coisa.
- Não substituir o motor e não enfraquecer a CSP; não quebrar o 2D nem a planificação.
- Não sobrescrever DXF; não esconder falhas.
- Commits pequenos, só na branch.
- Instaladores anteriores (3.1.1 e 3.2.0-1) preservados. O build intermediário de 3.2.0-2 (commit 49872dc) foi guardado
  como `_superado_*` e não apagado.

## 3. Auditoria

Documento: `docs/FASE5_AUDITORIA_INTEGRACAO_DXF_STEP.md`.
- O `agtn-cad-tank-viewer` é Kotlin/JVM, com parser STEP próprio (~22,6 mil linhas). **Não usa OCCT** e não lê DXF.
- Decisão do Edson: **OCCT + reuso do viewer**. Do viewer vieram as unidades (portadas para TS), o corpus de testes com
  `reference.json`, o eixo Y para cima e os padrões de interface.
- Nenhuma dependência nova.

## 4. Arquitetura implementada

- `core/model3d/src/stepinfo.ts`: leitura leve da Part 21. Pega cabeçalho, esquema (AP203/214/242), origem, integridade
  e unidades. Tem limites de profundidade e tamanho e não executa nada.
- `core/model3d/src/stepdoc.ts`:
  - verificação prévia: vazio, limite de 200 MB, assinatura e seção DATA;
  - conversão da árvore XCAF em modelo próprio;
  - resumo B-rep: sólidos, faces, arestas, volume, área, caixa e corpos inválidos.
- Worker do motor ganhou duas operações: `openStep` (unidades + árvore no worker) e `checkBodies` (BRepCheck por corpo).
- `apps/desktop/src/stepview/StepViewer.tsx`:
  - **motor próprio** (`new Engine()`), viewport e ViewCube;
  - painel de informações e estrutura;
  - `dispose` do worker ao fechar.
- Integração com o resto do programa:
  - abre por Abrir (Ctrl+O, filtro com STEP), Start Center, arrastar e soltar, linha de comando e recentes;
  - aba "STEP" só enquanto houver documento aberto;
  - nenhum menu duplicado; nenhuma associação de arquivo criada.

## 5. Componentes reaproveitados

| Do AGTN | Do viewer |
|---|---|
| OCCT 8/occt-wasm 5.17.1, `importStepTree` (XCAF), `BodyCache`, `Viewport3D`, ViewCube, `Engine`, layout `.ws3d` | `readUnits/unitFactor` (port), 17 arquivos de teste + `reference.json`, eixo Y para cima, estados de leitura |

## 6. DXF

- Leitor sem alteração de geometria. Somente leitura: o desenho aberto fica sem caminho, então Salvar pede `.agtncad`.
  O SHA-256 do arquivo de origem é igual antes e depois.
- Agora a unidade aparece na mensagem de abertura e de importação. Os três casos:
  - `Unidade do arquivo: mm.`
  - `convertida para mm (×N)`
  - `Unidade não declarada…: interpretado como mm, sem escala.`
- Cobertura contra o **ezdxf** (`tests/dxf/make_fase5_fixtures.py`, `modules/dxf/src/fase5.test.ts`, 27/27):
  - R12 e R2000;
  - LINE, POLYLINE (com bulge), LWPOLYLINE, ARC, CIRCLE, ELLIPSE, SPLINE, POINT, TEXT, MTEXT, INSERT/BLOCK (rotação e
    escala), HATCH, DIMENSION;
  - camadas e cores;
  - coordenadas negativas e de 1e7;
  - `$INSUNITS` mm, cm e ausente;
  - 3DFACE, RAY e XLINE contadas e avisadas;
  - arquivo truncado, lixo, coordenada não numérica e binário.

## 7. STEP

Estados: "Carregando arquivo" → "Interpretando geometria" → "Gerando visualização" → "Arquivo pronto" / "Falha na leitura".

Visualização:
- 7 vistas (frente, trás, superior, inferior, esquerda, direita, iso);
- Ajustar;
- sólido + arestas, sólido ou arame;
- orto ou perspectiva;
- Y para cima;
- iluminação do viewport 3D.

Navegação:
- girar, deslocar e zoom;
- seleção de face, aresta ou vértice com medidas exatas.

Preserva:
- vários sólidos;
- conjuntos, hierarquia, nomes e cores;
- B-rep (BREP do OCCT por corpo, não uma malha única irreversível).

**O documento STEP não é editável.**

## 8. Unidades

- A unidade do arquivo é lida do próprio STEP:
  - SI_UNIT com prefixo;
  - CONVERSION_BASED_UNIT (in, ft) com fator.
- O OCCT converte a geometria para mm. O painel mostra a unidade original, por exemplo `in (1 in = 25,4 mm)`.
- A exibição pode ser em mm, cm, m ou in. Muda só os números mostrados.
- Sem unidade: aparece **"desconhecida"** e um aviso, sem escala silenciosa.
- Mais de uma unidade no mesmo arquivo: aviso.

## 9. Medidas: B-rep × malha

| Medida | Origem | Natureza |
|---|---|---|
| Volume, área, caixa, contagens topológicas | OCCT (`props`, `topology`) sobre o B-rep | **exata** (tolerância do modelo) |
| Área, comprimento e raio da seleção | OCCT `info` | **exata** |
| Imagem na tela | malha gerada pelo OCCT | **aproximada**, só exibição |

## 10. Segurança

- CSP de produção sem mudança: sem `unsafe-eval`.
- Na fumaça do app instalado, 0 violações em todos os 13 arquivos, contando página e worker.
- `test:sem-eval` 699/699 no Windows.
- Arquivo importado é tratado como não confiável: verificação prévia, limite de tamanho, parser sem `eval`, erro do
  motor vira "Falha na leitura".
- Memória liberada ao fechar o documento (§13).

## 11. Testes automatizados

| Suíte | Linux (dev) | Windows nativo (PC) |
|---|---|---|
| vitest | 699 ok + 1 falha esperada + 2 pulados | **699 ok + 1 falha esperada + 2 pulados (702)** |
| test:sem-eval | igual | **igual** |
| typecheck | ok | ok |
| cargo test --release | — | **14/14** |
| STEP × `reference.json` (11 de 12 arquivos exatos, erro relativo < 1e-6) | ok | ok |
| E2E Chromium (`tests/e2e/e2e_step.py`) | **35/35** | — |
| Build de produção + CSP real (`tests/e2e/step_smoke_chromium.py`) | **90/90** | — |
| e2e3d / e2e_sheet (regressão 3D e chapa) | 34/34, 18/18 | — |

A "falha esperada" é `vessel_revolved.step` × referência (`it.fails`). Ela documenta P-F5-01 e acusa quando o motor
passar a ler certo.

## 12. Testes no app instalado (WebView2 real, Windows 11 25H2)

Ciclo `docs/evidencias/fase5_windows/ciclo/ciclo.log` (2026-11-15 13:09–13:16): **15/15 APROVADO**.

| Item | Resultado |
|---|---|
| W2 metadados | produto e versão 3.2.0-2; stub NSIS; sem assinatura (P-01) |
| I1 instalação limpa | 3 arquivos; exe x64 igual ao build (só o marcador do Tauri difere); **WASM incluído** e igual |
| I1 sem associação .step/.stp | ok |
| I2 atalho / I3 exe e reabrir | 684 ms / 524 e 527 ms; 0 módulos fora do Windows ou da instalação |
| I4 regressão 2D/3D/planificação/DXF/DWG/.agtncad/CSP | **76/76** |
| I5 DXF e STEP pela linha de comando | **138/138** (13 arquivos, inclusive pasta com espaço e acento) |
| W6 sem ferramentas de desenvolvimento | ok |
| I6 desinstalação | pasta e atalhos removidos; dados do usuário mantidos |
| U1–U4 atualização 3.2.0-1 → 3.2.0-2 | backup feito; 342 arquivos do perfil, **0 alterados**; projeto intacto; recentes preservados |
| U5 funcional depois de atualizar | **22/22** |
| U6 desinstalação final | estado final igual ao inicial (nenhum AGTN instalado) |

## 13. Desempenho e memória (app instalado)

Memória do app + WebView2:

| Arquivo | Tamanho | Leitura | Visualização | Privada aberto → fechado | Conj. trabalho aberto → fechado |
|---|---|---|---|---|---|
| box_100x50x20 | 15 KB | 500 ms | 61 ms | 534 → 322 MB | 522 → 456 MB |
| tank_assembly (4 sólidos) | 76 KB | 535 ms | 240 ms | 539 → 337 MB | 540 → 468 MB |
| grande_120_caixas | 2,0 MB | 1,27 s | 0,43 s | 599 → 388 MB | 607 → 516 MB |
| grande_400_placas | 21 MB | 6,4 s | 7,2 s | 808 → 562 MB | 889 → 667 MB |

Ao fechar, o worker do motor é encerrado e libera ~200–250 MB.

## 14. Instalador e versão

- 3.2.0-2 é compatível com o mecanismo de versão do Tauri/Windows: pré-lançamento numérico, NSIS ok, produto e arquivo
  = 3.2.0-2.
- `D:\AGTN_DEV\homologacao\AGTN Industrial CAD_3.2.0-2_x64-setup.exe`:
  - 8 875 779 bytes;
  - SHA-256 `EF4DA3DDB5FB4BD8C33F65799E25558AF4E7C2D6688FA83C289FEA1934798900`;
  - commit c3497a3.
- Também conferidos: o `agtn-cad.exe` do build (SHA-256 `11DC8D6D…`) e o WASM (`CEA5998C…`). Ver
  `docs/evidencias/fase5_windows/SHA256SUMS_3.2.0-2.txt`.
- Os instaladores foram entregues fora do PC, porque o PC deixa de estar disponível. Ver `docs/CONTINUIDADE.md` §5.

## 15. Tabela de resultados

| Item | Resultado |
|---|---|
| Abrir DXF R12 | APROVADO |
| Abrir DXF R2000 | APROVADO |
| Abrir STEP | APROVADO |
| Abrir STP | APROVADO |
| Múltiplos sólidos | APROVADO |
| Superfícies curvas | **PENDENTE** — cilindro, cone, esfera, toro, loft B-spline e filetes exatos; `vessel_revolved` (revolução de elipse) lido inválido pelo OCCT, **sinalizado na tela** |
| Assemblies | APROVADO |
| Unidades | APROVADO |
| Zoom e rotação | APROVADO |
| Arquivos grandes | APROVADO (21 MB / 400 sólidos) |
| Regressão 2D/3D | APROVADO |
| Segurança CSP | APROVADO |
| Instalador Windows | APROVADO (15/15) |

## 16. Pendências e riscos

- **P-F5-01:** defeito do leitor STEP do OCCT 8 (occt-wasm 5.17.1) em SURFACE_OF_REVOLUTION com geratriz ELLIPSE.
  - Volume −28%; caixa até x=900 em vez de 1050.
  - `fixShape` e `healSolid` não corrigem.
  - Saídas possíveis: versão nova do motor; reconstrução da face; ou ler esse caso com o parser do viewer.
- P-01: instalador sem assinatura.
- P-02/P-03 (herdadas): resíduos de associação.
- P-12: validação com peças e arquivos reais da AGTN (D3–D5, I2).
- Achados corrigidos durante a fase:
  - checkout no Windows com CRLF no `Cargo.lock` (teste ajustado);
  - variáveis PowerShell que diferem só por maiúscula (`$h`/`$H`, `$v`/`$V`);
  - lista de arquivos via `powershell -File`;
  - medidas em notação científica e rótulos cortados no visualizador.

## 17. Conclusão

**HOMOLOGAÇÃO PENDENTE.** A única pendência é P-F5-01, uma limitação do motor STEP numa classe de superfície curva, que
o programa detecta e avisa. Todos os outros critérios foram aprovados com evidência no Windows real.

A 3.2.0-2 é a **versão final desta fase** e a base para continuar em outro computador (`docs/CONTINUIDADE.md`). Não é
versão comercial e não deve ser publicada sem autorização.
