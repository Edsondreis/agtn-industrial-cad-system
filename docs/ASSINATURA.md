# Assinatura de código (aviso "O Windows protegeu o computador")

O CI já está pronto para assinar `agtn-cad.exe`, o instalador `.exe` (NSIS) e o `.msi`.
Sem certificado configurado, o build continua normal e só avisa que saiu sem assinatura.

## O que a assinatura resolve (e o que não resolve)

- **Resolve:** o Windows mostra **"Editor: AGTN"** em vez de "Editor desconhecido", e o
  arquivo não pode ser alterado sem quebrar a assinatura.
- **Não resolve na hora:** desde 2024 nenhum certificado (nem EV) tira o aviso do SmartScreen
  imediatamente. O aviso some sozinho quando o programa ganha **reputação** (downloads sem
  reclamação). Com assinatura essa reputação fica ligada ao certificado e passa para as
  próximas versões; sem assinatura ela recomeça a cada versão.
- A **Microsoft Store** (pacote MSIX) é o único caminho gratuito e sem aviso nenhum — fica
  como opção futura.

## Que certificado comprar (empresa no Brasil)

- O serviço barato da Microsoft (**Azure Artifact Signing**, antigo Trusted Signing) **não
  atende empresas brasileiras** — só EUA, Canadá, União Europeia e Reino Unido.
- Comprar um certificado **OV de assinatura de código** em nome da AGTN (CNPJ). Desde 2023 a
  chave fica obrigatoriamente em token USB ou em nuvem (HSM). Para o CI do GitHub assinar
  sozinho, escolher a opção **em nuvem**, por exemplo:
  - SSL.com — eSigner (ferramenta `CodeSignTool`)
  - DigiCert — KeyLocker (ferramenta `smctl`)
  - Certum — SimplySign
- EV não vale mais a pena só pelo SmartScreen (mesmo comportamento do OV, preço maior).

## Como ligar no GitHub

Repositório → **Settings → Secrets and variables → Actions → New repository secret**.
Basta UM dos métodos:

### Método 1 — comando do fornecedor (assinatura em nuvem)

Secret `SIGN_COMMAND`: o comando completo, com `{file}` onde vai o arquivo. O CI já repassa
`ES_USERNAME`, `ES_PASSWORD`, `ES_CREDENTIAL_ID` e `ES_TOTP_SECRET` (cadastre também esses
secrets se o fornecedor for a SSL.com). Exemplo com o CodeSignTool da SSL.com instalado no
runner (confira a sintaxe na documentação do fornecedor):

```
C:\CodeSignTool\CodeSignTool.bat sign -username=%ES_USERNAME% -password=%ES_PASSWORD% -credential_id=%ES_CREDENTIAL_ID% -totp_secret=%ES_TOTP_SECRET% -input_file_path={file} -override
```

O comando roda no `cmd.exe`: `%VARIAVEL%` lê os secrets do ambiente.

### Método 2 — arquivo .pfx

- `WINDOWS_CERT_PFX_BASE64` = conteúdo do `.pfx` em base64
  (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`)
- `WINDOWS_CERT_PASSWORD` = senha do `.pfx`

Assina com `signtool` (SHA-256 + carimbo de tempo). Serve para certificados que ainda vêm
em `.pfx` e para testes com certificado próprio.

### Opcional

Variável (não secret) `SIGN_TIMESTAMP_URL` para trocar o servidor de carimbo de tempo
(padrão `http://timestamp.digicert.com`).

## Como conferir

Com assinatura ativa, o CI roda `signtool verify /pa` em todos os arquivos e falha se algum
não estiver assinado. No Windows: botão direito no arquivo → Propriedades → **Assinaturas
Digitais**.

Arquivos: `.github/workflows/build-windows.yml` (passo "Build Tauri") e
`apps/desktop/src-tauri/windows/sign.ps1`.
