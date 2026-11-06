import { DEFAULT_LAYER, DEFAULT_SETTINGS, type Layer, deserializeInto, serializeDocument } from "@agtn/document";
import type { LengthUnit } from "@agtn/geometry";
import { toast } from "../ui/toast";
import { recents } from "./recents";
import { type DxfImportReport, dxfBytes, readDxf, writeDxfR12 } from "@agtn/dxf";
import { type Entity, newId } from "@agtn/geometry";
import type { CadController } from "../cad/controller";
import {
  baseName,
  clearRecovery,
  confirmDialog,
  ConverterMissingError,
  isDwg,
  pickAndRead,
  readDwgAsDxf,
  writeDwgFromDxf,
  pickSavePath,
  readPath,
  saveRecovery,
  writeBytes,
  writeText,
} from "../platform/platform";

export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
export const PRODUCT = "AGTN Industrial CAD";
export const GENERATOR = `${PRODUCT} ${APP_VERSION}`;

/** Estado de arquivo do desenho aberto. */
export interface FileState {
  name: string;
  path: string | null;
}

export class FileActions {
  file: FileState = { name: "Sem título", path: null };
  lastDxfReport: DxfImportReport | null = null;
  /** operação de arquivo em andamento (exibe indicador de carregamento) */
  busy: string | null = null;
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

  private setBusy(b: string | null) {
    this.busy = b;
    this.emit();
  }

  /** Novo desenho. Retorna false se o usuário cancelou o descarte de alterações. */
  /** unidade de novos projetos (preferência do usuário) */
  defaultUnits: LengthUnit = "mm";
  /** versão de DWG gravada (preferência do usuário) */
  dwgVersion = "ACAD2018";
  /** chamado quando falta o ODA File Converter (abre a ajuda de instalação) */
  onConverterMissing: (() => void) | null = null;

  async newDrawing(opts: { units?: LengthUnit } = {}): Promise<boolean> {
    if (!(await this.confirmDiscard())) return false;
    this.ctl.cancel(true);
    this.ctl.doc.reset();
    const units = opts.units ?? this.defaultUnits;
    if (units !== "mm") {
      this.ctl.doc.load({ entities: [], layers: this.ctl.doc.layers.slice(), currentLayer: "0", settings: { ...DEFAULT_SETTINGS, units } });
    }
    this.ctl.sel.clear();
    this.ctl.view.fit({ minX: -20, minY: -20, maxX: 420, maxY: 297 });
    this.setFile({ name: "Sem título", path: null });
    await clearRecovery();
    this.ctl.message("Novo desenho.");
    return true;
  }

  /** Abre projeto .agtncad, DWG ou DXF (DWG/DXF abrem como novo desenho). Retorna true se abriu. */
  async open(): Promise<boolean> {
    if (!(await this.confirmDiscard())) return false;
    const f = await pickAndRead("drawing");
    if (!f) return false;
    return this.withBusy(`Abrindo ${f.name}…`, () => this.loadBytes(f.name, f.path, f.bytes));
  }

  async openPath(path: string, confirm = false): Promise<boolean> {
    if (confirm && !(await this.confirmDiscard())) return false;
    try {
      return await this.withBusy(`Abrindo ${baseName(path)}…`, async () =>
        this.loadBytes(baseName(path), path, isDwg(path) ? new Uint8Array() : await readPath(path)),
      );
    } catch (e) {
      this.ctl.message(String(e), "error");
      toast(String(e), "error");
      return false;
    }
  }

  private async withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.setBusy(label);
    // deixa a interface pintar o indicador antes do trabalho síncrono de leitura
    await new Promise((r) => setTimeout(r, 30));
    try {
      return await fn();
    } finally {
      this.setBusy(null);
    }
  }

  private async loadBytes(name: string, path: string | null, bytes: Uint8Array): Promise<boolean> {
    try {
      this.ctl.cancel(true);
      this.ctl.sel.clear();
      const dwg = isDwg(name);
      if (dwg && !path) throw new Error("DWG precisa ser aberto pelo aplicativo desktop.");
      if (dwg || /\.dxf$/i.test(name)) {
        // DWG: convertido para DXF R2018 pelo ODA File Converter e lido pelo mesmo importador do DXF
        const r = readDxf(dwg ? await readDwgAsDxf(path!) : bytes);
        this.ctl.doc.load({
          entities: r.entities,
          layers: r.layers,
          currentLayer: "0",
          settings: { ...this.ctl.doc.settings, units: "mm" },
        });
        this.lastDxfReport = r.report;
        // DXF/DWG aberto vira desenho sem caminho nativo (salvar pede .agtncad)
        const fmt = dwg ? "DWG" : "DXF";
        this.setFile({ name: name.replace(/\.(dxf|dwg)$/i, ""), path: null });
        this.ctl.message(`${fmt} aberto: ${r.entities.length} objeto(s). ${summarizeUnsupported(r.report)}`);
        toast(`${fmt} aberto: ${r.entities.length} objeto(s).`, Object.keys(r.report.unsupported).length ? "warn" : "ok");
        if (path) recents.touch(path);
        this.ctl.actions.get("__DXF_REPORT__")?.();
      } else {
        const rep = deserializeInto(this.ctl.doc, new TextDecoder("utf-8").decode(bytes));
        this.setFile({ name: name.replace(/\.agtncad$/i, ""), path });
        this.ctl.message(`Projeto aberto: ${rep.loaded} objeto(s).${rep.warnings.length ? " " + rep.warnings.join(" ") : ""}`, rep.warnings.length ? "warn" : "info");
        toast(`Projeto aberto: ${name}`, rep.warnings.length ? "warn" : "ok");
        if (path) recents.touch(path);
      }
      this.ctl.zoomExtents();
      return true;
    } catch (e) {
      if (e instanceof ConverterMissingError) this.onConverterMissing?.();
      const msg = `Falha ao abrir "${name}": ${e instanceof Error ? e.message : String(e)}`;
      this.ctl.message(msg, "error");
      toast(msg, "error");
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
      toast(`Salvo: ${baseName(path)}`, "ok");
      if (path.includes("/") || path.includes("\\")) recents.touch(path);
      return true;
    } catch (e) {
      this.ctl.message(`Falha ao salvar: ${String(e)}`, "error");
      toast(`Falha ao salvar: ${String(e)}`, "error");
      return false;
    }
  }

  /** Importa DXF ou DWG para dentro do desenho atual (uma única operação desfazível). */
  async importDxf() {
    const f = await pickAndRead("cad");
    if (!f) return;
    const fmt = isDwg(f.name) ? "DWG" : "DXF";
    try {
      const r = readDxf(fmt === "DWG" ? await this.withBusy(`Convertendo ${f.name}…`, () => readDwgAsDxf(f.path!)) : f.bytes);
      const doc = this.ctl.doc;
      const changes = [];
      for (const l of r.layers) if (!doc.layer(l.name)) changes.push({ kind: "layer-add" as const, layer: l, index: doc.layers.length + changes.length });
      const ents: Entity[] = r.entities.map((e) => (doc.has(e.id) ? { ...e, id: newId() } : e));
      changes.push(...doc.addChanges(ents));
      doc.commit(`Importar ${fmt} (${ents.length} objetos)`, changes);
      this.lastDxfReport = r.report;
      this.ctl.message(`${fmt} importado: ${ents.length} objeto(s). ${summarizeUnsupported(r.report)}`);
      toast(`${fmt} importado: ${ents.length} objeto(s).`, Object.keys(r.report.unsupported).length ? "warn" : "ok");
      this.ctl.actions.get("__DXF_REPORT__")?.();
      this.ctl.zoomExtents();
    } catch (e) {
      if (e instanceof ConverterMissingError) this.onConverterMissing?.();
      this.ctl.message(`Falha ao importar ${fmt}: ${e instanceof Error ? e.message : String(e)}`, "error");
      toast(`Falha ao importar ${fmt}: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  /** Exporta DXF R12 (ou DWG, via ODA) do desenho ou de camadas selecionadas. */
  async exportDxf(opts: { layers?: string[]; entities?: Entity[]; layerDefs?: Layer[]; suggested?: string; format?: "dxf" | "dwg" } = {}) {
    const format = opts.format ?? "dxf";
    const suggested = (opts.suggested ?? `${this.file.name}.dxf`).replace(/\.(dxf|dwg)$/i, `.${format}`);
    const p = await pickSavePath(format, suggested);
    if (!p) return;
    const path = new RegExp(`\\.${format}$`, "i").test(p) ? p : `${p}.${format}`;
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
      if (format === "dwg") {
        await this.withBusy(`Gravando ${baseName(path)}…`, () => writeDwgFromDxf(path, dxfBytes(txt), this.dwgVersion));
        this.ctl.message(`DWG exportado: ${baseName(path)} (${this.dwgVersion}, unidades: mm).`);
        toast(`DWG exportado: ${baseName(path)}`, "ok");
        return;
      }
      await writeBytes(path, dxfBytes(txt));
      this.ctl.message(`DXF R12 exportado: ${baseName(path)} (unidades: mm).`);
      toast(`DXF exportado: ${baseName(path)}`, "ok");
    } catch (e) {
      if (e instanceof ConverterMissingError) this.onConverterMissing?.();
      const msg = e instanceof Error ? e.message : String(e);
      this.ctl.message(`Falha ao exportar ${format.toUpperCase()}: ${msg}`, "error");
      toast(`Falha ao exportar ${format.toUpperCase()}: ${msg}`, "error");
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
