# Changelog

## 1.1.0 — DWG, conversor DWG ↔ DXF e abrir com duplo clique
- **Abrir DWG** (Ctrl+O, Start Center, recentes, duplo clique) — R12 até 2018+, pelo ODA File Converter.
- **Importar DWG** para o desenho atual e **Exportar DWG** (versão escolhida em Preferências).
- **Converter DWG ↔ DXF** no Start Center (e em Arquivo/Ferramentas, comando `CONVERTER`): vários arquivos,
  inverter/forçar DXF/forçar DWG, versão R12–2018, pasta de destino, sem alterar os originais.
- **Associação de arquivos**: o instalador registra `.dxf` e `.dwg` além de `.agtncad`; Preferências tem
  "Padrão para .dwg/.dxf/.agtncad" (janela "Abrir com" do Windows).
- **Instância única**: duplo clique com o app já aberto abre o arquivo na janela existente.
- **Correção**: perfil U (ex.: 100×200×100, T3, R3) acusava "a seção se autointercepta" sem cruzamento real —
  erro numérico na tangência reta↔arco da verificação; tangência agora decidida pela distância geométrica.

## 1.0.0 — Primeira versão estável
- Versão 1.0.0 publicada como Release no GitHub (instalador NSIS, MSI, executável e SHA256SUMS).
- Mesmas funcionalidades da 0.3.0; notas em `docs/release-notes/v1.0.0.md`.

## 0.3.0 — Nova geração de interface
- **Start Center**: Novo projeto (desenho 2D, planificação, biblioteca, texto laser), Abrir arquivo, Recentes
  persistentes (reabrir, remover, abrir pasta, arquivo não encontrado), recuperação, Preferências.
- **Início**: volta ao Start Center sem perder o documento; "Continuar" retoma o desenho aberto.
- **Design system** reescrito (`apps/desktop/src/styles.css`): tokens de cor, tipografia Segoe UI Variable,
  espaçamentos, botões, abas, campos, diálogos, rolagem, estados.
- **Campos de medida tipados** (`MeasureField`): externa, interna, espessura, ângulo, raio, fator K, com unidade.
- Notificações (toasts), indicador de carregamento ao abrir arquivos, chip "não salvo".
- Esc fecha qualquer diálogo (antes exigia foco dentro dele).
- Planificação, biblioteca e texto laser carregados sob demanda: pacote inicial 425 kB → 341 kB.
- Produto renomeado para **AGTN Industrial CAD** (instalador: `AGTN Industrial CAD_0.3.0_x64-setup.exe`).
- Rust: comando `reveal_in_folder` (abrir local do arquivo no Explorer).
- Sem alteração nos motores de cálculo (geometria, planificação, calandra, peças, DXF, texto laser).

## 0.2.0
Calandra, biblioteca de chapas, texto para laser, logotipo oficial AGTN, aba CONFIGURAÇÕES na planificação.

## 0.1.0
CAD 2D, camadas, cotas, `.agtncad`, DXF, perfis L/U/U enrijecido.
