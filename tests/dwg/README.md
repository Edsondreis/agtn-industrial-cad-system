# Amostras DWG para testes

`sample_AC1015.dwg` (AutoCAD 2000), `sample_AC1021.dwg` (2007) e `sample_AC1032.dwg` (2018) — desenhos gerados
pelo AutoCAD, do projeto [ACadSharp](https://github.com/DomCR/ACadSharp) (MIT, ver `LICENSE-ACadSharp.txt`).
Usados por `apps/desktop/src-tauri/src/cadconv.rs` (`real_autocad_samples`): cada arquivo é lido e regravado em
todas as versões de DWG (R12–2018) e DXF, e relido.

```
AGTN_DWG_SAMPLES=$PWD/tests/dwg cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```
