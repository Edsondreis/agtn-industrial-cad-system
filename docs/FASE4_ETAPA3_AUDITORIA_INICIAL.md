# FASE 4 · ETAPA 3 — Auditoria inicial e matriz de homologação

Data: 13/11/2026 · Responsável pela execução: Claude (sessão de nuvem, Linux) · Aprovação: Edson dos Reis (AGTN).

## 1. Estado real do Git (conferido, não copiado do relatório)

| Item | Valor |
|---|---|
| Branch atual | `feature/agtn-3d-ia` |
| HEAD local | `9ac7193` |
| HEAD remoto `feature/agtn-3d-ia` | `9ac7193` (igual, nada a enviar) |
| `main` no remoto | `23a2540` (v3.1.1) — ancestral da branch, não alterada |
| Working tree | limpo (0 arquivos alterados) |
| Commits desde a main | 31 |
| Commits da ETAPA 2 (`e463834..9ac7193`) | 12 |
| `bend.ts`, `tray.ts`, `modules/dxf`, `core/geometry`, `core/document` | **sem diferença** desde `e463834` (base da ETAPA 2) |

## 2. Integridade da ETAPA 2 (reexecutada agora, no HEAD `9ac7193`)

| Verificação | Resultado |
|---|---|
| `tsc` (monorepo) | OK |
| Vitest | 522/522 (44 arquivos) |
| `cargo test --release` (shell nativo) | 15/15 |

## 3. Ambiente desta sessão

| Item | Valor |
|---|---|
| SO | Linux 6.18 x86_64 (contêiner de nuvem) |
| CPU / RAM | Intel Xeon 2,10 GHz, 2 vCPU · 7 GB |
| Node / Rust | 22.23.4 / 1.97.0 |
| App | 3.1.1 (Tauri 2, occt-wasm 5.17.1, three 0.187.0) |
| ezdxf | 1.4.5 |
| Computador da AGTN ligado à sessão | `desktop-edn3mjc`, Windows x64, app Claude desktop 5.11492.2 |

## 4. O que é possível e o que não é, daqui

| Frente | Situação | Motivo (verificado) |
|---|---|---|
| Testes geométricos, persistência, DXF automático, regressão 2D, desempenho no contêiner | **executável agora** | — |
| Build Windows no GitHub Actions | **bloqueado** | última execução (12/11) falhou em 4 s: cobrança da conta |
| Build Windows cruzado a partir do Linux | **bloqueado** | rede da sessão recusa `static.rust-lang.org` (rust-std MSVC) e os servidores da Microsoft (CRT/SDK) — 403 no proxy |
| Build Windows nativo no PC da AGTN | **depende do Edson** | o controle remoto da tela não permite digitar em terminal/PowerShell (nível "só clique"); o build precisa ser disparado por ele, com o script preparado |
| Testes de interface no Windows real | **possível depois do build** | app instalado é app comum (controle total), com aprovação dele na tela |
| ZWCAD / AutoCAD | **possível no PC da AGTN** | os arquivos podem ser copiados para uma pasta dele e abertos por controle de tela, com aprovação |
| CAM do laser | **pendente** | software está na máquina de corte, não neste PC |
| Peças reais | **pendente** | precisam ser fornecidas pela AGTN (desenho, STEP, planificação de referência) |

## 5. Matriz de homologação

Legenda: APROVADO · REPROVADO · PENDENTE · NÃO TESTADO · NÃO APLICÁVEL. Status inicial: tudo **NÃO TESTADO** nesta etapa.

| # | Teste | Evidência necessária | Onde | Depende de |
|---|---|---|---|---|
| W1 | Build completo Windows (tsc, vitest, cargo test, tauri build NSIS) | log do script, versões | PC Windows | Edson rodar o script |
| W2 | Instalação limpa, abrir, reabrir | capturas, caminho instalado | PC Windows | W1 |
| W3 | Atualizar por cima da 3.1.1 | capturas, versão | PC Windows | W1 + instalador 3.1.1 |
| W4 | Desinstalar e conferir limpeza; projetos do usuário preservados | listagem antes/depois | PC Windows | W2 |
| W5 | Caminhos com espaço, acento e caracteres especiais | arquivos salvos/abertos | PC Windows | W2 |
| W6 | Sem ferramentas de desenvolvimento (WebView2 só do sistema) | ambiente | PC sem Node/Rust | W1 |
| W7 | Funcional: abrir/salvar `.agtncad`, STEP, seleção, medição, chapa, abas, alívios, cantos, recortes, desdobrar, DXF | capturas + valores | PC Windows | W2 |
| G1 | Fórmulas de dobra (`bend.ts`) contra cálculo independente | teste | contêiner | — |
| G2 | Bateria §5.2 (plana, 45/90/135°, sentidos opostos, sequência, R/T/K, recuos, alívios, recortes, cantos, edição, desdobrar/redobrar repetido) | teste + medições OCCT | contêiner | — |
| G3 | Medidas no sólido (espessura, raio, ângulo, posição da dobra) lidas do B-Rep | teste | contêiner | — |
| G4 | Proveniência sob edição paramétrica | teste | contêiner | — |
| I1 | 10 peças de referência AGTN (estrutura + casos sintéticos) | fichas + resultados | contêiner | — |
| I2 | Comparação com peças reais | tabela modelo × referência | contêiner | **AGTN fornecer arquivos** |
| D1 | Validação automática DXF R12/R2000 (todas as peças de referência) | relatório | contêiner | — |
| D2 | Camadas por entidade | teste | contêiner | — |
| D3 | Abrir no ZWCAD | capturas | PC Windows | aprovação de acesso |
| D4 | Abrir no AutoCAD | capturas | PC Windows | AutoCAD instalado |
| D5 | Importar no CAM do laser | relatório do operador | máquina de corte | **AGTN** |
| P1 | Desempenho e memória no contêiner (pequeno/médio/grande, repetição) | medições | contêiner | — |
| P2 | Desempenho em hardware real | medições | PC Windows | W2 |
| C1 | `.agtncad` de fases anteriores, ETAPA 1 e ETAPA 2 abrem e regeneram igual | teste | contêiner | — |
| C2 | DXF antes e depois de reabrir: idêntico | teste (hash) | contêiner | — |
| R1 | Regressão 2D (suíte completa, hashes DXF R12/R2000, PDF, bandejas, perfis, DWG) | teste + hashes | contêiner | — |
| R2 | DWG no conversor nativo (cargo test com amostras reais) | cargo test | contêiner (Linux) / Windows | W1 para Windows |

## 6. Ordem de execução

1. Agora, sem depender de nada externo: G1–G4, I1, D1–D2, C1–C2, R1–R2 (Linux), P1.
2. Em paralelo: script `scripts/windows/homologacao.ps1` para o Edson rodar no PC (W1, versões, ambiente).
3. Com o build pronto: W2–W7 e P2 por controle de tela, com aprovação do Edson.
4. D3/D4 no PC da AGTN; D5 e I2 quando a AGTN fornecer o CAM e as peças.
