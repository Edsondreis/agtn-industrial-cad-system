/**
 * Camada de plataforma: no Tauri usa diálogos nativos e comandos Rust (gravação atômica);
 * no navegador (desenvolvimento/teste) usa <input type=file> e download.
 */
import { invoke } from "@tauri-apps/api/core";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type FileKind = "agtncad" | "dxf" | "dwg" | "cad" | "drawing";

const FILTERS: Record<FileKind, { name: string; extensions: string[] }[]> = {
  agtncad: [{ name: "Projeto AGTN CAD", extensions: ["agtncad"] }],
  dxf: [{ name: "DXF (Drawing Exchange Format)", extensions: ["dxf"] }],
  dwg: [{ name: "DWG (AutoCAD Drawing)", extensions: ["dwg"] }],
  cad: [
    { name: "Desenhos CAD (DWG, DXF)", extensions: ["dwg", "dxf"] },
    { name: "DWG", extensions: ["dwg"] },
    { name: "DXF", extensions: ["dxf"] },
  ],
  drawing: [
    { name: "Desenhos (AGTN CAD, DWG, DXF)", extensions: ["agtncad", "dwg", "dxf"] },
    { name: "Projeto AGTN CAD", extensions: ["agtncad"] },
    { name: "DWG", extensions: ["dwg"] },
    { name: "DXF", extensions: ["dxf"] },
  ],
};

export interface OpenedFile {
  path: string | null;
  name: string;
  bytes: Uint8Array;
}

export const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export async function readPath(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("read_file", { path });
  return new Uint8Array(buf);
}

export const isDwg = (name: string): boolean => /\.dwg$/i.test(name);

export async function pickAndRead(kind: FileKind): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, directory: false, filters: FILTERS[kind] });
    if (!path || Array.isArray(path)) return null;
    // DWG é lido pelo conversor a partir do caminho (bytes do DWG não são usados no app)
    return { path, name: baseName(path), bytes: isDwg(path) ? new Uint8Array() : await readPath(path) };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = FILTERS[kind][0].extensions.map((e) => `.${e}`).join(",");
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    };
    input.click();
  });
}

/** Pergunta o destino (Tauri). No navegador retorna o nome sugerido e o salvamento vira download. */
export async function pickSavePath(kind: FileKind, suggested: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return (await save({ defaultPath: suggested, filters: FILTERS[kind] })) ?? null;
  }
  return suggested;
}

function download(name: string, data: Uint8Array | string, mime: string) {
  const blob = new Blob([typeof data === "string" ? data : new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function writeText(path: string, text: string): Promise<void> {
  if (isTauri()) return invoke("write_text", { path, contents: text });
  download(baseName(path), text, "application/json");
}

export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
  if (isTauri()) return invoke("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  download(baseName(path), bytes, "application/dxf");
}

/* --------------------------- recuperação automática --------------------------- */
const RECOVERY_KEY = "agtncad.recovery";

export async function saveRecovery(payload: string): Promise<void> {
  if (isTauri()) return invoke("recovery_save", { contents: payload });
  try {
    localStorage.setItem(RECOVERY_KEY, payload);
  } catch {
    /* cota do navegador excedida: recuperação indisponível para este desenho */
  }
}
export async function loadRecovery(): Promise<string | null> {
  if (isTauri()) return invoke<string | null>("recovery_load");
  try {
    return localStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}
export async function clearRecovery(): Promise<void> {
  if (isTauri()) return invoke("recovery_clear");
  try {
    localStorage.removeItem(RECOVERY_KEY);
  } catch {
    /* ignore */
  }
}

export async function startupFile(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("startup_file");
}

export async function confirmDialog(message: string, title = "AGTN CAD"): Promise<boolean> {
  if (isTauri()) {
    const { ask } = await import("@tauri-apps/plugin-dialog");
    return ask(message, { title, kind: "warning", okLabel: "Sim", cancelLabel: "Não" });
  }
  return window.confirm(message);
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

/** Intercepta o fechamento da janela para avisar sobre alterações não salvas. */
export async function guardClose(isDirty: () => boolean, onConfirmedClose: () => Promise<void>): Promise<void> {
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const w = getCurrentWindow();
    await w.onCloseRequested(async (ev) => {
      if (!isDirty()) {
        await onConfirmedClose();
        return;
      }
      ev.preventDefault();
      if (await confirmDialog("Há alterações não salvas. Deseja sair mesmo assim?")) {
        await onConfirmedClose();
        await w.destroy();
      }
    });
    return;
  }
  window.addEventListener("beforeunload", (e) => {
    if (isDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

export async function fileExists(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("file_exists", { path });
}

export async function revealInFolder(path: string): Promise<void> {
  if (!isTauri()) throw new Error("Disponível no aplicativo desktop.");
  await invoke("reveal_in_folder", { path });
}

/* ------------------- DWG — conversor próprio (embutido, nada para instalar) ------------------- */
/** Lê um DWG convertendo-o para DXF 2018 (bytes do DXF). */
export async function readDwgAsDxf(path: string): Promise<Uint8Array> {
  if (!isTauri()) throw new Error("DWG está disponível no aplicativo desktop.");
  return new Uint8Array(await invoke<ArrayBuffer>("dwg_read_as_dxf", { path }));
}

/** Grava DWG a partir de bytes DXF. */
export async function writeDwgFromDxf(path: string, dxf: Uint8Array, version: string): Promise<void> {
  if (!isTauri()) throw new Error("DWG está disponível no aplicativo desktop.");
  await invoke("dwg_write_from_dxf", dxf, { headers: { "x-path": encodeURIComponent(path), "x-version": encodeURIComponent(version) } });
}

export interface ConvertJob {
  input: string;
  output: string;
}
export interface ConvertResult extends ConvertJob {
  ok: boolean;
  error: string | null;
}
export async function convertCad(jobs: ConvertJob[], format: "DXF" | "DWG", version: string, overwrite: boolean): Promise<ConvertResult[]> {
  if (!isTauri()) throw new Error("Conversão disponível no aplicativo desktop.");
  return invoke<ConvertResult[]>("convert_cad", { jobs, format, version, overwrite });
}

/** Escolha de vários arquivos (caminhos). */
export async function pickPaths(kind: FileKind): Promise<string[]> {
  if (!isTauri()) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: true, directory: false, filters: FILTERS[kind] });
  return r ? (Array.isArray(r) ? r : [r]) : [];
}
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, directory: true });
  return typeof r === "string" ? r : null;
}
/**
 * Torna o AGTN Industrial CAD o programa padrão da extensão.
 * "direto" = aplicado; "abrir-com" = o Windows recusou e abriu a janela "Abrir com" para o usuário confirmar.
 */
export async function makeDefaultApp(ext: "dxf" | "dwg"): Promise<"direto" | "abrir-com"> {
  if (!isTauri()) throw new Error("Disponível no aplicativo desktop.");
  return invoke<"direto" | "abrir-com">("make_default_app", { ext });
}
/** O AGTN Industrial CAD já é o padrão da extensão? */
export async function isDefaultApp(ext: "dxf" | "dwg"): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("is_default_app", { ext });
}

/** Arquivo aberto por duplo clique com o aplicativo já em execução (instância única). */
export async function onOpenFileRequest(fn: (path: string) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string>("open-file", (ev) => fn(ev.payload));
}
