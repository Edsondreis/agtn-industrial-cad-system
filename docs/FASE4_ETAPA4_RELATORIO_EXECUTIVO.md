# FASE 4 · ETAPA 4 — Relatório executivo: homologação final

Data: 13/11/2026 · Branch `feature/agtn-3d-ia` · `main` = `23a2540` (v3.1.1), **não alterada**.
Nada foi mesclado, publicado ou liberado.

## Veredito: **HOMOLOGAÇÃO PENDENTE**

**O software não está pronto para produção.** Ainda não há evidência de:
- Windows real (W1–W7) e WebView2 testado;
- ZWCAD, AutoCAD e CAM do laser;
- peças reais medidas com tolerâncias aprovadas;
- desempenho no PC da AGTN.

Pelas regras da etapa, sem isso não existe homologação industrial.

## Em linguagem simples

**O que foi comprovado (com evidência que pode ser repetida)**
- A geometria está certa:
  - as fórmulas de dobra batem com geometria calculada à parte;
  - os sólidos batem com fórmulas independentes (erro de 10⁻¹⁶);
  - a peça real 710.0CUH25-01-03 sai igual ao DXF de produção, nos vértices e na posição das 4 dobras.
- O 2D da v3.1.1 está intacto. Os arquivos de referência foram **gerados de novo agora a partir da própria main** e comparados byte a byte: `.agtncad`, DXF R12, DXF R2000, SVG e PDF iguais.
- Projetos de todas as fases abrem e regeneram iguais.
- Os 20 DXF de teste são estruturalmente corretos. Um leitor independente fez 14 conferências por arquivo: unidade, origem, escala, contornos fechados, sem duplicados, camadas e textos fora do corte. E são exatamente os mesmos bytes entregues na ETAPA 3.
- O app **compilado** (no Linux) passou no mesmo teste que vai rodar no Windows: 58/58. Isso inclui motor 3D, sólidos, booleana, planificação, DXF idêntico ao de referência, DWG, e gravação em pasta com espaço e acento.
- Num motor Chromium, da mesma família do WebView2, o build de produção roda com a regra de segurança (CSP) do app: 61/61.

**O que não foi possível comprovar**
- Windows. Nesta sessão não há Windows, e eu não consegui rodar PowerShell (o `pwsh` foi bloqueado pela proteção da sessão).
- WebView2 de verdade. O Chromium **não** é o WebView2.
- ZWCAD, AutoCAD e CAM: não houve acesso ao PC.
- Peças físicas e tolerâncias: não foram fornecidas.
- Desempenho no PC da AGTN.

**O que foi corrigido**
- **F-04 (ALTA):** o script do Windows entregue na ETAPA 3 **não abriria** no PowerShell do Windows. Faltava o BOM, e o "—" vira aspas na leitura ANSI. Corrigido nos três scripts, e um teste impede a volta.
- **F-07:** um erro de tempo no próprio instrumento de teste (não no app). Corrigido.
- **Checkout com CRLF:** um `.gitattributes` faz as referências com hash continuarem iguais no Git do Windows. A suíte passa com checkout estilo Windows.

**Quais riscos permanecem**
1. **F-05:** o motor 3D precisa de código dinâmico dentro do worker, coisa que a regra de segurança proíbe. Hoje funciona porque o Tauri não aplica a regra ao worker. Se o WebView2 ou uma atualização do Tauri aplicar, o 3D não abre (o 2D continua). O teste do Windows detecta isso e mostra o motivo exato.
2. **F-08:** a branch está com versão 3.1.1, e a v3.1.1 não tem Release. **Um merge na main publicaria automaticamente uma Release "v3.1.1" com o 3D.** A versão precisa ser decidida antes.
3. Num PC sem internet e sem WebView2, o instalador atual falha. É decisão de empacotamento.
4. O K usado nos testes é o padrão. A fabricação depende do K calibrado, da ferramenta e do retorno elástico.
5. Os scripts do Windows nunca rodaram num Windows. Pode haver erro do próprio script, e o log vai mostrar.

**O que depende da AGTN:** `FASE4_ETAPA4_PENDENCIAS_AGTN.md`.
1. Rodar `homologacao.ps1` e mandar a pasta de saída.
2. Rodar o pacote num PC sem ferramentas.
3. Instalador da 3.1.1.
4. Fichas do ZWCAD/AutoCAD e do CAM.
5. De 5 a 10 peças reais, com medidas e K calibrado.
6. Tolerâncias da engenharia.
7. Decisões de versão e empacotamento.

## Matriz final de homologação

| ID | Teste | Resultado | Evidência |
|---|---|---|---|
| W1 | Build completo Windows | **PENDENTE** | `scripts/windows/homologacao.ps1` pronto; não executado |
| W2 | Instalação limpa | **PENDENTE** | `validar_instalado.ps1` pronto; não executado |
| W3 | Atualização sobre a v3.1.1 | **PENDENTE** | idem + falta o instalador 3.1.1 |
| W4 | Desinstalação | **PENDENTE** | idem |
| W5 | Caminhos com espaço/acento | **PENDENTE** no Windows | no Linux compilado: abertura pela linha de comando e gravação de DXF/DWG/.agtncad em `Peça ção #1 (rev.2)` OK |
| W6 | Sem ferramentas de desenvolvimento | **PENDENTE** | `pacote_validacao` só com PowerShell 5.1; VC++ estático (sem redistribuível) |
| W7 | Funcionamento completo (WebView2) | **PENDENTE** | `webview2_smoke.ps1` (S1–S9) + roteiro manual; instrumento validado: Tauri Linux 58/58, Chromium 61/61 |
| G1 | Fórmulas de dobra | **APROVADO** | `audit3.test.ts` (50 casos × geometria pura) |
| G2 | Sólidos (bateria + recursos + edição + redobrar ×10) | **APROVADO** | `audit3.test.ts` |
| G3 | Medidas no B-Rep | **APROVADO** | `audit3.test.ts` |
| G4 | Proveniência | **APROVADO** | `audit3.test.ts` |
| I1 | 10 peças de referência | **APROVADO** (geometria/DXF, não fabricação) | `industrial.test.ts` 10/10; bandeja real = DXF de produção |
| I2 | Peças reais com tolerância | **PENDENTE** | estrutura, ficha v2, `dimensional.ts` (18 testes); nenhuma peça fornecida |
| D1 | Validação automática DXF | **APROVADO** (automático) | validador do app + `auditoria_dxf.py` 20/20 × 14 |
| D2 | Camadas | **APROVADO** (automático) | idem |
| D3 | ZWCAD | **PENDENTE** | `FICHA_CAD.md` |
| D4 | AutoCAD | **PENDENTE** | `FICHA_CAD.md` |
| D5 | CAM do laser | **PENDENTE** | `FICHA_CAM_LASER.md` |
| P1 | Desempenho no contêiner | **APROVADO** | `perf3.test.ts` 3/3; sem vazamento, sem degradação |
| P2 | Desempenho no PC real | **PENDENTE** | procedimento no `validar_instalado.ps1` |
| C1 | `.agtncad` de todas as fases | **APROVADO** | `persist3.test.ts` |
| C2 | DXF antes/depois de reabrir | **APROVADO** | `persist3.test.ts` |
| R1 | Regressão 2D (hashes contra a main) | **APROVADO** | regerado agora na main e na branch: iguais |
| R2 | DWG nativo | **APROVADO** (Linux) · **PENDENTE** (Windows) | `cargo test` 15/15; DWG gravado e relido no app compilado |

Contagem (R2 contado uma vez, pela parte que falta):
- **12 APROVADO**: G1–G4, I1, D1, D2, P1, C1, C2, R1, e R2 no Linux;
- **13 PENDENTE**: W1–W7, I2, D3–D5, P2, e R2 no Windows;
- **0 REPROVADO**.

Aprovação parcial não foi contada como completa. D1/D2 são "automático", I1 é "geometria", R2 é "Linux".

## Documentos desta etapa

| Documento | Conteúdo |
|---|---|
| `FASE4_ETAPA4_AUDITORIA_TECNICA.md` | estado inicial, reprodução da ETAPA 3, falhas F-04 a F-08, mudança de código com justificativa |
| `FASE4_ETAPA4_HOMOLOGACAO_WINDOWS.md` | W1–W7, auditoria do motor 3D/CSP/WebView2, teste S1–S9, como rodar, roteiro manual |
| `FASE4_ETAPA4_VALIDACAO_CAD_CAM.md` | D1–D5, auditoria DXF, fichas |
| `FASE4_ETAPA4_VALIDACAO_DIMENSIONAL.md` | I1–I2, ferramenta e regras de causa |
| `FASE4_ETAPA4_DESEMPENHO.md` | P1 (contêiner) e procedimento P2 |
| `FASE4_ETAPA4_REGRESSAO.md` | R1, R2, C1, C2, G, execução completa |
| `FASE4_ETAPA4_PENDENCIAS_AGTN.md` | o que a AGTN precisa fazer e decidir |

A decisão de merge e publicação é **exclusivamente do Edson**.
