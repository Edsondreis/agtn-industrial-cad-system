import { DEFAULT_LAYER, type Layer, deserializeInto, serializeDocument } from "@agtn/document";
import { type DxfImportReport, dxfBytes, readDxf, writeDxfR12 } from "@agtn/dxf";
import { type Entity, newId } from "@agtn/geometry";
import type { CadController } from "../cad/controller";
import {
  baseName,
  clearRecovery,
  confirmDialog,
  pickAndRead,
  pickSavePath,
  readPath,
  saveRecovery,
  writeBytes,
  writeText,
} from "../platform/platform";

export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
export const GENERATOR = `AGTN CAD ${APP_VERSION}`;

/** Estado de arquivo do desenho aberto. */
export interface FileState {
  name: string;
  path: string | null;
}

export class FileActions {
  file: FileState = { name: "Sem título", path: null };
  lastDxfReport: DxfImportReport | null = null;
  private listeners = new Set<() => void>();

  constructor(private ctl: CadController) {}

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    for (const f of this.listeners) f();
  }
  private setFile(f: FileState) {
    this.file = f;
    this.emit();
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.ctl.doc.dirty) return true;
    return confirmDialog("O desenho atual tem alterações não salvas. Descartar alterações?");
  }

  async newDrawing() {
    if (!(await this.confirmDiscard())) return;
    this.ctl.cancel(true);
    this.ctl.doc.reset();
    this.ctl.sel.clear();
    this.ctl.view.fit({ minX: -20, minY: -20, maxX: 420, maxY: 297 });
    this.setFile({ name: "Sem título", path: null });
    await clearRecovery();
    this.ctl.message("Novo desenho.");
  }

  /** Abre projeto .agtncad ou DXF (DXF abre como novo desenho). */
  async open() {
    if (!(await this.confirmDiscard())) return;
    const f = await pickAndRead("drawing");
    if (f) await this.loadBytes(f.name, f.path, f.bytes);
  }

  async openPath(path: string) {
    try {
      await this.loadBytes(baseName(path), path, await readPath(path));
    } catch (e) {
      this.ctl.message(String(e), "error");
    }
  }

  private async loadBytes(name: string, path: string | null, bytes: Uint8Array): Promise<boolean> {
    try {
      this.ctl.cancel(true);
      this.ctl.sel.clear();
      if (/\.dxf$/i.test(name)) {
        const r = readDxf(bytes);
        this.ctl.doc.load({
          entities: r.entities,
          layers: r.layers,
          currentLayer: "0",
          settings: { ...this.ctl.doc.settings, units: "mm" },
        });
        this.lastDxfReport = r.report;
        // DXF aberto vira desenho sem caminho nativo (salvar pede .agtncad)
        this.setFile({ name: name.replace(/\.dxf$/i, ""), path: null });
        this.ctl.message(`DXF aberto: ${r.entities.length} objeto(s). ${summarizeUnsupported(r.report)}`);
        this.ctl.actions.get("__DXF_REPORT__")?.();
      } else {
        const rep = deserializeInto(this.ctl.doc, new TextDecoder("utf-8").decode(bytes));
        this.setFile({ name: name.replace(/\.agtncad$/i, ""), path });
        this.ctl.message(`Projeto aberto: ${rep.loaded} objeto(s).${rep.warnings.length ? " " + rep.warnings.join(" ") : ""}`, rep.warnings.length ? "warn" : "info");
      }
      this.ctl.zoomExtents();
      return true;
    } catch (e) {
      this.ctl.message(`Falha ao abrir "${name}": ${e instanceof Error ? e.message : String(e)}`, "error");
      return false;
    }
  }

  async save(): Promise<boolean> {
    if (!this.file.path) return this.saveAs();
    return this.writeProject(this.file.path);
  }

  async saveAs(): Promise<boolean> {
    const p = await pickSavePath("agtncad", `${this.file.name}.agtncad`);
    if (!p) return false;
    const path = /\.agtncad$/i.test(p) ? p : `${p}.agtncad`;
    return this.writeProject(path);
  }

  private async writeProject(path: string): Promise<boolean> {
    try {
      await writeText(path, serializeDocument(this.ctl.doc, GENERATOR));
      this.ctl.doc.markSaved();
      this.setFile({ name: baseName(path).replace(/\.agtncad$/i, ""), path: path.includes("/") || path.includes("\\") ? path : null });
      await clearRecovery();
      this.ctl.message(`Salvo: ${baseName(path)}`);
      return true;
    } catch (e) {
      this.ctl.message(`Falha ao salvar: ${String(e)}`, "error");
      return false;
    }
  }

  /** Importa DXF para dentro do desenho atual (uma única operação desfazível). */
  async importDxf() {
    const f = await pickAndRead("dxf");
    if (!f) return;
    try {
      const r = readDxf(f.bytes);
      const doc = this.ctl.doc;
      const changes = [];
      for (const l of r.layers) if (!doc.layer(l.name)) changes.push({ kind: "layer-add" as const, layer: l, index: doc.layers.length + changes.length });
      const ents: Entity[] = r.entities.map((e) => (doc.has(e.id) ? { ...e, id: newId() } : e));
      changes.push(...doc.addChanges(ents));
      doc.commit(`Importar DXF (${ents.length} objetos)`, changes);
      this.lastDxfReport = r.report;
      this.ctl.message(`DXF importado: ${ents.length} objeto(s). ${summarizeUnsupported(r.report)}`);
      this.ctl.actions.get("__DXF_REPORT__")?.();
      this.ctl.zoomExtents();
    } catch (e) {
      this.ctl.message(`Falha ao importar DXF: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  /** Exporta DXF R12 do desenho (ou de camadas selecionadas). */
  async exportDxf(opts: { layers?: string[]; entities?: Entity[]; layerDefs?: Layer[]; suggested?: string } = {}) {
    const p = await pickSavePath("dxf", opts.suggested ?? `${this.file.name}.dxf`);
    if (!p) return;
    const path = /\.dxf$/i.test(p) ? p : `${p}.dxf`;
    try {
      const doc = this.ctl.doc;
      const txt = writeDxfR12(
        {
          layers: opts.layerDefs ?? doc.layers,
          entities: opts.entities ?? doc.all(),
          dimStyle: { ...doc.settings.dimStyle, unitFactor: 1 },
        },
        { layerFilter: opts.layers },
      );
      await writeBytes(path, dxfBytes(txt));
      this.ctl.message(`DXF R12 exportado: ${baseName(path)} (unidades: mm).`);
    } catch (e) {
      this.ctl.message(`Falha ao exportar DXF: ${String(e)}`, "error");
    }
  }

  /** Recuperação: grava periodicamente o desenho com alterações não salvas. */
  async autosave() {
    if (!this.ctl.doc.dirty || this.ctl.doc.size === 0) return;
    const payload = JSON.stringify({ name: this.file.name, path: this.file.path, at: new Date().toISOString(), doc: serializeDocument(this.ctl.doc, GENERATOR) });
    await saveRecovery(payload).catch(() => undefined);
  }

  async restoreRecovery(payload: string): Promise<boolean> {
    try {
      const r = JSON.parse(payload) as { name: string; path: string | null; doc: string };
      deserializeInto(this.ctl.doc, r.doc);
      // recuperado = alterações ainda não salvas no arquivo original
      this.ctl.doc.commit("Recuperação", [this.ctl.doc.extraChange("__recovered", new Date().toISOString())]);
      this.setFile({ name: `${r.name} (recuperado)`, path: r.path });
      this.ctl.zoomExtents();
      this.ctl.message("Desenho recuperado. Salve para confirmar.", "warn");
      return true;
    } catch (e) {
      this.ctl.message(`Não foi possível recuperar: ${String(e)}`, "error");
      return false;
    }
  }
}

export function summarizeUnsupported(r: DxfImportReport): string {
  const u = Object.entries(r.unsupported);
  if (!u.length) return "Todas as entidades suportadas.";
  return `Não suportadas: ${u.map(([k, n]) => `${k} (${n})`).join(", ")}.`;
}

export { DEFAULT_LAYER };
