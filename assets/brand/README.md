# Identidade visual AGTN

- `app-icon-source.png` — ícone **provisório** (texto "AGTN CAD" sobre grafite). Não é um logotipo novo.
- Para aplicar o logotipo oficial da AGTN:
  1. Salve o arquivo vetorial em `apps/desktop/public/brand/agtn-logo.svg`.
  2. Em `apps/desktop/src/ui/Chrome.tsx` (barra superior) e `apps/desktop/src/ui/Dialogs.tsx` (tela Sobre),
     troque o texto pelo `<img className="brand-logo" src="/brand/agtn-logo.svg" alt="AGTN" />` indicado nos comentários.
  3. Gere os ícones do executável: `cd apps/desktop && npx tauri icon caminho/do/logo-1024.png -o src-tauri/icons`.

Cores da interface: grafite `#16181c`/`#1c1f24`, azul tecnológico `#3d8bfd`, texto `#cfd6df`.
