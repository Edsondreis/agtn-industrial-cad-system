# AGTN CAD — Industrial CAD System

Software CAD 2D da **AGTN** para desenho técnico, chapas e estruturas metálicas, com
**planificação de chapas dobradas (AGTN SHEET METAL)** e compatibilidade **DXF**.
Plataforma inicial: Windows 10/11 (desktop). Arquitetura preparada para evolução a 3D.

> Desenvolvido pela AGTN. Uso interno/comercial da AGTN — veja `LICENSE`.

## Funcionalidades (v0.1.0)

Tudo abaixo está implementado sobre geometria real (coordenadas em mm, float64) e coberto por testes
automatizados (ver “Qualidade”).

**Prancheta CAD**
- Zoom na posição do cursor (roda), pan (botão do meio), zoom extensão (duplo clique do meio / `ZE`), zoom janela e fator (`Z`).
- Grade técnica adaptativa ao zoom, eixos X/Y, ícone do sistema de coordenadas, cursor em cruz com pickbox.
- Unidades de trabalho mm / cm / m (armazenamento interno sempre em mm).

**Desenho**: linha, polilinha (trechos retos e arcos tangentes), retângulo, círculo (centro/raio, diâmetro, 3 pontos),
arco (3 pontos ou centro/início/fim), polígono regular (inscrito/circunscrito), ponto, texto.

**Modificação**: mover, copiar (múltiplo), rotacionar, escala (fator ou referência), espelhar, offset (linhas, círculos,
arcos e polilinhas com arcos), trim (linhas, arcos, círculos, polilinhas abertas e fechadas), extend, fillet e chanfro
(entre linhas), stretch (janela de cruzamento), explodir (polilinhas e cotas), unir (join), apagar,
edição por alças (grips) e edição numérica no painel de propriedades.

**Seleção**: individual, múltipla, janela (→), cruzamento (←), desseleção (Shift), selecionar tudo, por tipo.

**Precisão**: coordenadas absolutas `x,y`, relativas `@dx,dy`, polares `@d<a`, distância direta (número na direção
do cursor), snaps (extremidade, ponto médio, centro, quadrante, interseção, perpendicular, tangente, mais próximo, nó),
Ortho, Polar Tracking (5–90°), snap à grade.

**Camadas**: criar, renomear (atualiza objetos), excluir, cor ACI, espessura, tipo de linha, visibilidade, bloqueio,
camada atual, mover objetos entre camadas.

**Cotas**: linear (H/V), alinhada, angular, raio, diâmetro — associativas (acompanham a geometria ao editar); estilo
configurável (altura do texto, casas decimais, separador, tipo/tamanho de seta, linhas auxiliares, sufixo).

**Arquivos**
- Formato nativo `.agtncad` (JSON versionado): entidades, camadas, propriedades, cotas, configurações, unidade, dados
  do módulo de chapas. Gravação atômica, aviso de alterações não salvas, recuperação automática a cada 60 s.
- DXF: abrir/importar (R12 até versões atuais, ASCII) e exportar DXF R12. Relatório de importação com entidades não
  suportadas. Detalhes em [`docs/DXF.md`](docs/DXF.md).

**AGTN SHEET METAL — Planificação** (aba `PLANIFICAÇÃO` ou comando `SM`)
- Perfis L, U e U enrijecido, com abas, raios, ângulos e fator K independentes por dobra.
- Dimensões **externas** ou **internas** (globais ou por dimensão), convertidas explicitamente.
- Ângulo informado como ângulo de dobra θ ou ângulo interno α.
- Cálculo de BA, OSB, ISB, BD, trechos retos, desenvolvimento total, posição das linhas de dobra e peso teórico.
- Fator K manual ou por tabela (material, processo, espessura, R/T) com origem identificada
  (estimativa / manual / calibrado); editor de tabelas e registro de ensaios de calibração.
- Visualização da seção (contorno real, eixo neutro, cotas na face de referência, ângulos, raios) e da planificação
  (contorno, linhas e regiões de dobra, cotas de fabricação, anotações de sentido).
- Inserção no desenho e exportação DXF da planificação em camadas de fabricação
  (`CONTORNO_CORTE`, `LINHAS_DOBRA`, `REGIAO_DOBRA`, `COTAS`, `CENTROS`, `ANOTACOES`).
- Convenções e fórmulas: [`docs/SHEET_METAL.md`](docs/SHEET_METAL.md).

## Instalação (usuário)

Baixe o instalador gerado pelo GitHub Actions (aba **Actions** → execução mais recente de *Build Windows* →
artefato `AGTN-CAD-windows`): `AGTN CAD_0.1.0_x64-setup.exe` (NSIS) ou `.msi`. O instalador NSIS instala para o
usuário atual (sem administrador). Requer WebView2 (já presente no Windows 10 atualizado e no Windows 11; o
instalador baixa automaticamente se faltar).

## Desenvolvimento

Pré-requisitos: Node.js 22+, Rust estável (MSVC no Windows), e para o shell desktop os
[pré-requisitos do Tauri 2](https://tauri.app/start/prerequisites/).

```bash
npm install            # instala todos os workspaces
npm test               # 112 testes (geometria, documento, DXF, chapas, linha de comando)
npm run typecheck      # TypeScript estrito
npm run dev            # interface no navegador em http://localhost:1420 (sem recursos nativos)
npm run tauri dev      # aplicativo desktop com recarga automática
```

Validação DXF independente (usa o leitor/auditor [ezdxf](https://ezdxf.mozman.at/)):

```bash
npm test               # gera tests/output/*.dxf
pip install ezdxf
npm run validate:dxf
```

## Compilar o executável Windows

Em um PC Windows 10/11 com Node 22+, Rust (toolchain MSVC) e Visual Studio Build Tools (C++):

```powershell
npm ci
npm run tauri build
```

Saídas:
- `apps\desktop\src-tauri\target\release\agtn-cad.exe` — executável
- `apps\desktop\src-tauri\target\release\bundle\nsis\AGTN CAD_0.1.0_x64-setup.exe` — instalador
- `apps\desktop\src-tauri\target\release\bundle\msi\AGTN CAD_0.1.0_x64_pt-BR.msi` — pacote MSI

O mesmo processo roda automaticamente em `.github/workflows/build-windows.yml` a cada push na `main`.

## Estrutura

```
agtn-industrial-cad-system/
├── apps/desktop/            Aplicativo (React + TypeScript) e shell nativo Tauri 2 (src-tauri, Rust)
│   └── src/
│       ├── cad/             Controlador, viewport, renderizador Canvas, ferramentas e comandos
│       ├── sheetmetal/      Área PLANIFICAÇÃO (UI do módulo de chapas)
│       ├── ui/              Componentes da interface
│       ├── app/             Composição, menus, ações de arquivo
│       └── platform/        Ponte Tauri / navegador
├── core/geometry/           Motor geométrico 2D puro (entidades, interseções, snap, offset, trim...)
├── core/document/           Documento, camadas, transações Undo/Redo, índice espacial, seleção, .agtncad
├── modules/dxf/             Leitor e escritor DXF
├── modules/sheetmetal/      SheetMetalEngine (cálculo de dobras e planificação)
├── assets/brand/            Identidade visual (local reservado para o logotipo oficial)
├── docs/                    Arquitetura, convenções, DXF, roadmap
└── tests/                   Validação DXF externa (ezdxf) e saídas de teste
```

## Qualidade

- `npm test`: 112 testes — interseções, distâncias, ângulos, transformações, offset, trim/extend, fillet/chanfro,
  snap, Undo/Redo, camadas, cotas associativas, formato nativo (ida e volta exata), DXF (escrita, leitura, round-trip,
  unidades, blocos, OCS, entidades não suportadas), planificação (casos 45°/90°/135°, L/U interno/externo, U
  assimétrico, enrijecido, tangência, espessura, consistência seção × planificação, autointerseção, calibração,
  regressão) e linha de comando.
- `cargo test` no shell nativo (gravação atômica e decodificação de caminhos).
- Os DXF de teste passam na auditoria do ezdxf.

## Documentação

- [Arquitetura e decisões técnicas](docs/ARQUITETURA.md)
- [AGTN SHEET METAL — convenções e fórmulas](docs/SHEET_METAL.md)
- [DXF — suporte e limitações](docs/DXF.md)
- [Roadmap](docs/ROADMAP.md)
