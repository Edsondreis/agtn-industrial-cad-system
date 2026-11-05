/**
 * Camada de plataforma: no Tauri usa diálogos nativos e comandos Rust (gravação atômica);
 * no navegador (desenvolvimento/teste) usa <input type=file> e download.
 */
import { invoke } from "@tauri-apps/api/core";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type FileKind = "agtncad" | "dxf" | "drawing";

const FILTERS: Record<FileKind, { name: string; extensions: string[] }[]> = {
  agtncad: [{ name: "Projeto AGTN CAD", extensions: ["agtncad"] }],
  dxf: [{ name: "DXF (Drawing Exchange Format)", extensions: ["dxf"] }],
  drawing: [
    { name: "Desenhos (AGTN CAD, DXF)", extensions: ["agtncad", "dxf"] },
    { name: "Projeto AGTN CAD", extensions: ["agtncad"] },
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

export async function pickAndRead(kind: FileKind): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, directory: false, filters: FILTERS[kind] });
    if (!path || Array.isArray(path)) return null;
    return { path, name: baseName(path), bytes: await readPath(path) };
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
