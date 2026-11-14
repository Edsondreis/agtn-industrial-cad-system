#!/usr/bin/env bash
# FASE 4 · ETAPA 5 — executável Windows PORTÁTIL para testar no WebView2 real, compilado no Linux.
# NÃO é o build oficial (MSVC + instalador NSIS do build-windows.yml): serve só para o teste de fumaça
# (scripts/windows/smoke/webview2_smoke.ps1 -Exe ...\agtn-cad.exe). Ver docs/FASE4_ETAPA5_WEBVIEW2_EXECUCAO.md.
#
# Requisitos: mingw-w64 (x86_64-w64-mingw32-gcc). Se o rust-std do alvo não puder ser baixado (proxy),
# o fonte da std da MESMA versão do rustc deve estar em $(rustc --print sysroot)/lib/rustlib/src/rust/library
# (inclusive o submódulo library/backtrace); a std é então compilada com -Zbuild-std (RUSTC_BOOTSTRAP=1).
#
# Saída: dist_windows_gnu/app/{agtn-cad.exe, WebView2Loader.dll, occt/occt-wasm.wasm}
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T=x86_64-pc-windows-gnu
(cd "$ROOT/apps/desktop" && npx vite build)
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc
export CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc CXX_x86_64_pc_windows_gnu=x86_64-w64-mingw32-g++ AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar
EXTRA=()
if ! rustup target list --installed | grep -qx "$T"; then export RUSTC_BOOTSTRAP=1; EXTRA=(-Zbuild-std=std,panic_abort); fi
(cd "$ROOT/apps/desktop/src-tauri" && cargo build --release --target "$T" --features tauri/custom-protocol "${EXTRA[@]}")
OUT="$ROOT/dist_windows_gnu/app"; rm -rf "$OUT"; mkdir -p "$OUT/occt"
cp "$ROOT/apps/desktop/src-tauri/target/$T/release/agtn-cad.exe" "$ROOT/apps/desktop/src-tauri/target/$T/release/WebView2Loader.dll" "$OUT/"
cp "$ROOT/node_modules/occt-wasm/dist/occt-wasm.wasm" "$OUT/occt/"
sha256sum "$OUT/agtn-cad.exe"
