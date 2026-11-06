// Evita janela de console extra no Windows em release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Modo conversor DWG↔DXF (processo filho, sem janela) — veja `cadconv.rs`.
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(|a| a == agtn_cad_lib::cadconv::CLI_FLAG).unwrap_or(false) {
        std::process::exit(agtn_cad_lib::cadconv::cli_main(&args[1..]));
    }
    agtn_cad_lib::run()
}
