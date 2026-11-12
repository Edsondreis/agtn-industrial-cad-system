# Testes de ponta a ponta do AGTN 3D

Rodam a interface real no Chromium (mesmo motor do WebView2 do Windows) com mouse e teclado.

```bash
npm run dev                              # http://localhost:1420
pip install playwright && playwright install chromium
python3 tests/e2e/e2e3d.py               # 34 verificações: criar, selecionar face/aresta/vértice, medir,
                                         # ViewCube, árvore, conjunto, salvar/reabrir, STEP, 2D intacto
python3 tests/e2e/load3d.py              # carga: estrutura com 38 perfis, paisagem e tela vertical
```

Capturas e `resultado.json` vão para `tests/output/e2e/` (ou `E2E_OUT`). O gancho `window.__agtn3d`
só existe em `npm run dev` ou com `localStorage["agtn.e2e"] = "1"`.
Os scripts usam `/usr/bin/google-chrome` com SwiftShader; ajuste `executable_path` se necessário.
