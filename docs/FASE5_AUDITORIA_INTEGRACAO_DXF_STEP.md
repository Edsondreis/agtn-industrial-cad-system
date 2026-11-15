# FASE 5 — Auditoria de integração DXF e STEP

Data: 2026-11-14 · Branch: `feature/agtn-3d-ia` (base d08cf8a) · `main` congelada em 23a2540

## 1. Os dois repositórios

| | AGTN Industrial CAD (este) | agtn-cad-tank-viewer (referência) |
|---|---|---|
| Commit auditado | d08cf8a (3.2.0-1) | 9b4a917 (2.7.3, 2026-11-12) |
| Linguagem | TypeScript, React, Rust (Tauri) | Kotlin/JVM |
| Plataforma | Windows (Tauri 2.12.5 + WebView2) e navegador | Android (:app) e PC (:desktop, Compose + JOGL) |
| Motor 3D | OCCT 8 em WebAssembly (`occt-wasm` 5.17.1), num Web Worker | parser STEP **próprio**: `core/step` + `brep` + `tess` (~22,6 mil linhas em 90 arquivos no `:core`). **Sem OCCT** |
| Visualização | three.js 0.187.0 (`Viewport3D`, ViewCube) | OpenGL (JOGL 2.5.0) / Compose Canvas |
| DXF | leitor e gravador próprios (`modules/dxf`, leitura de 13+ entidades) | só **exporta** DXF (`DxfExporter.kt`); não lê DXF |
| Licença | AGTN | proprietária AGTN ("Todos os direitos reservados"); terceiros: Earcut (ISC) |

Versões do viewer: Kotlin 2.2.21, Compose Multiplatform 1.9.1, AGP 8.13.2, coroutines 1.10.2, JOGL 2.5.0. O `:core` só depende de JUnit (para testes).

## 2. Arquitetura encontrada

**AGTN.** O STEP já entrava no programa por **importação** (`Workspace3D.importStep`): o arquivo era lido pelo OCCT
(`importStepTree`, XCAF com nomes, cores, matrizes e BREP binário), e o resultado era **gravado no modelo 3D do
projeto `.agtncad`** como corpos `source: brep`. Isso altera o projeto, e o pedido da FASE 5 é abrir sem alterar.
O motor (`Engine`) é uma classe que pode ter várias instâncias. Cada instância tem seu worker e seu OCCT
(~130 MB). O `BodyCache` gera malha, arestas, propriedades exatas e topologia por corpo. O `Viewport3D` recebe o
resultado (`applySync`) e tem 7 vistas, enquadramento, orto/perspectiva, modos sombreado/arestas/arame e seleção
de face, aresta ou vértice.

**Viewer.** O pipeline é este:
1. `StepFile` lê a Part 21 com mmap.
2. `StepReader` converte AP203/214/242 em B-rep próprio.
3. `Tessellator` gera a malha.
4. A cena é desenhada em OpenGL.

As unidades saem de `readUnits/unitFactor` (GLOBAL_UNIT_ASSIGNED_CONTEXT → LENGTH_UNIT → SI_UNIT com prefixo, ou
CONVERSION_BASED_UNIT com MEASURE_WITH_UNIT). Quando a unidade falta, ele avisa. Há uma opção de eixo Y para cima.
O corpus de testes tem 34 `.step`. O `reference.json` traz volume, área, caixa, faces, arestas e sólidos de 12
arquivos, gerados com CadQuery/OCCT por scripts próprios (`gen_fixtures_*.py`).

## 3. Componentes: reaproveitáveis × incompatíveis

| Componente do viewer | Decisão | Motivo |
|---|---|---|
| Parser STEP/B-rep/tesselador Kotlin | **Não incorporado** | Linguagem e plataforma diferentes (JVM). Portar 22 mil linhas duplicaria o motor já homologado (OCCT 8), sem ganho de exatidão para o caso geral |
| Leitura de unidades (`readUnits`/`unitFactor`) | **Portado** para TS (`core/model3d/src/stepinfo.ts`) | O OCCT converte tudo para mm e não diz ao app qual era a unidade do arquivo. A lógica do viewer resolve isso sem motor geométrico |
| Corpus de testes + `reference.json` | **Copiados 17 arquivos** (12 com referência + 4 reais + json) para `tests/step/viewer_ref/` | São valores independentes, gerados por outro caminho, que servem de prova. Mesmo dono (AGTN) |
| Eixo Y para cima | **Reaproveitado o conceito** (rotação de 90° em X só na exibição) | Arquivos de CAD Y-up aparecem deitados |
| Padrões de interface (estados de leitura, painel de informações) | **Reaproveitados** (5 estados pedidos, painel com unidade, contagem e medidas) | |
| OpenGL/JOGL, Compose | **Incompatível** | O AGTN já tem o viewport three.js homologado |
| DXF do viewer | **Nada a reaproveitar** | O viewer não lê DXF; o leitor do AGTN fica **preservado** |

Decisão do usuário (2026-11-14): **"OCCT + reuso do viewer"**. Nenhuma dependência nova.

## 4. Dependências a incorporar

Nenhuma, nem npm nem cargo. O WASM do OCCT já está no instalador (`occt/occt-wasm.wasm`).

## 5. Riscos encontrados

1. **Defeito do leitor STEP do OCCT 8 (occt-wasm 5.17.1), achado na auditoria.** Em `vessel_revolved.step`,
   as calotas elípticas (SURFACE_OF_REVOLUTION com geratriz ELLIPSE) saem achatadas:
   - caixa até x = 900 em vez de 1050;
   - volume 8 397 477 mm³ em vez de 11 739 730 mm³;
   - `BRepCheck` reprova a forma;
   - `fixShape` e `healSolid` não corrigem.

   O parser Kotlin do viewer lê esse arquivo certo. **Mitigação:** cada corpo passa pelo verificador do OCCT e a
   tela avisa que a geometria é inválida e que as medidas podem estar erradas. Não se esconde nada. Correção do
   motor fica pendente.
2. Memória: cada documento STEP tem seu próprio motor (~130 MB). **Mitigação:** o worker é encerrado ao fechar
   (testado: os workers voltam à contagem inicial).
3. Arquivo malformado ou truncado. **Mitigação:** verificação prévia (vazio, tamanho máximo 200 MB, assinatura
   ISO-10303-21, seção DATA, terminador); erros do OCCT viram "Falha na leitura" com a mensagem.
4. Segurança: entrada não confiável. O parser de cabeçalho não executa nada e tem limites de profundidade e
   tamanho. A CSP não foi tocada e não se usa `unsafe-eval`.
5. Medidas da malha × exatas: volume, área e caixa vêm sempre do B-rep (OCCT); a malha serve só para desenhar.

## 6. Estratégia

- **STEP abre como documento próprio, só de leitura**, numa aba "STEP" que existe enquanto ele está aberto. Tem
  motor próprio (`new Engine()`), modelo próprio e viewport próprio, e tudo é liberado ao fechar. O `.agtncad`
  não é tocado. A importação para o projeto (área 3D) continua como estava.
- Abre pelos mesmos caminhos do resto do programa, sem menu duplicado:
  - Abrir (Ctrl+O, filtro com STEP);
  - Start Center;
  - arrastar e soltar;
  - linha de comando / instância única;
  - recentes.

  Não se cria associação de arquivo.
- B-rep preservado: cada sólido fica como BREP do OCCT no modelo do documento (não vira uma malha irreversível).
  Conjuntos, hierarquia, nomes e cores vêm do XCAF.
- Unidades: as do arquivo são lidas pelo port do viewer. A exibição oferece mm, cm, m e in, convertendo só a
  exibição. Unidade ausente aparece como "desconhecida", com aviso, sem escala silenciosa.
- **DXF:** o leitor é preservado e auditado contra arquivos gerados pelo ezdxf (biblioteca independente) em R12 e
  R2000, com as 13 entidades. A unidade passa a ser explícita na mensagem de abertura/importação.
