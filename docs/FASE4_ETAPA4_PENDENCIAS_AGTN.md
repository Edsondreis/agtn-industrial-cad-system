# FASE 4 · ETAPA 4 — O que depende da AGTN

Data: 13/11/2026. A homologação **não fecha** sem os itens abaixo. A ordem é a recomendada.

## 1. Windows real — W1 a W7, R2 no Windows, P2 (prioridade 1)

**Onde:** PC Windows da AGTN com Node 22 LTS, Git, Rust (`stable-x86_64-pc-windows-msvc`) e "Ferramentas de Build do Visual Studio" (C++).

**Passos:**
1. Baixar a branch, ou pegar `scripts/windows/` do repositório.
2. Abrir o **Windows PowerShell** (não precisa ser administrador) e rodar:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\windows\homologacao.ps1
   ```
   Com o instalador da 3.1.1 (para o W3):
   ```powershell
   … -InstaladorAnterior "C:\caminho\AGTN Industrial CAD_3.1.1_x64-setup.exe"
   ```
3. Mandar a pasta `C:\AGTN_HOMOLOGACAO\<data-hora>\` inteira (zip): logs, `resumo.json`, `instalado\…`, `webview2\…`.
4. **W6:** copiar `pacote_validacao\` para um PC **sem** Node/Rust (de preferência o da oficina ou o da CNC) e rodar `validar_instalado.ps1 -Instalador .\<setup>.exe`. Mandar a pasta de saída.
5. Rodar o **roteiro manual do W7** (`FASE4_ETAPA4_HOMOLOGACAO_WINDOWS.md`). Se preferir, eu faço por controle de tela, com a sua aprovação na tela.

**Como alternativa:** resolver a cobrança do GitHub Actions e disparar manualmente "CI e build Windows" na branch `feature/agtn-3d-ia`. Os resultados ficam no artefato `homologacao-windows`. Não publica nada. Isso **não** substitui o P2 nem o W6 no PC real.

**Atenção:** os scripts **nunca rodaram num Windows**. Se algum der erro do próprio script, mande o log e eu corrijo.

## 2. Instalador da versão publicada (W3)

Não existe Release v3.1.1 no GitHub; a última com instalador é a v3.1.0. Preciso de:
- o `setup.exe` da 3.1.1 que está em uso na AGTN;
- ou a confirmação de que o W3 pode ser feito sobre a 3.1.0 (Release do GitHub).

## 3. ZWCAD e AutoCAD — D3, D4

- Abrir os 20 arquivos de `tests/industrial/dxf_referencia/` e preencher `tests/industrial/FICHA_CAD.md`, com a versão de cada programa.
- **Ou** liberar nesta sessão uma pasta do PC (por exemplo `C:\AGTN_HOMOLOGACAO`) e aprovar o controle de tela do ZWCAD e do AutoCAD. Aí eu abro, confiro e capturo as telas.

## 4. CAM do laser — D5

- O operador importa os 20 DXF **só no CAM** (sem cortar) e preenche `tests/industrial/FICHA_CAM_LASER.md`: máquina, potência, CAM, versão, camadas, ajustes, resultado.
- **Corte físico de teste:** só com autorização expressa da AGTN. Eu não autorizo nem peço.

## 5. Peças reais — I2

De 5 a 10 peças já produzidas, cada uma numa pasta `tests/industrial/pecas_reais/NN_nome/` (ver `README.md` e `_modelo/ficha.json`), com:
1. desenho original (PDF) e DXF de produção aprovado;
2. material, espessura nominal e **medida**, raio interno, **K calibrado** (data do ensaio);
3. ferramenta (punção, matriz V, raio) e processo (máquina, tipo de dobra, sequência);
4. medidas da peça pronta: pelo menos 3 leituras por cota, ângulos e raios por dobra, instrumento;
5. `modelo.agtncad` da peça (eu posso modelar a partir do desenho; a conferência é da engenharia).

## 6. Tolerâncias da engenharia — I2 (e critério de aceite do P2, se desejado)

Valores aprovados, com nome e data, para:
- blank, área, comprimento de corte;
- posição de dobra, ângulo, raio;
- medida final e espessura.

Se quiser meta de desempenho (por exemplo, abrir o projeto grande em menos de X s no PC da oficina), ela também é da AGTN. Hoje o P2 só **mede**.

## 7. Decisões que são só do Edson

| Decisão | Por quê |
|---|---|
| **Versão do app antes de qualquer merge** | A branch diz 3.1.1. O workflow da main cria Release automática quando a versão não tem Release, e a 3.1.1 não tem. Um merge publicaria "v3.1.1" com o 3D (F-08) |
| Modo do WebView2 no instalador | `downloadBootstrapper` (atual) falha em PC sem internet e sem WebView2. As opções `embedBootstrapper`/`offlineInstaller` aumentam o instalador |
| Merge, publicação e liberação para produção | Exclusivas do Edson. Nada disso foi feito |
