import type { Change, Layer } from "@agtn/document";
import type { Entity } from "@agtn/geometry";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CadController } from "../cad/controller";
import { InsertTool } from "../cad/tools/insert";
import { clearRecovery, guardClose, loadRecovery, setWindowTitle, startupFile } from "../platform/platform";
// módulos pesados (cálculo de chapas, fontes, booleanas) carregados sob demanda: abertura mais rápida
const SheetMetalWorkspace = lazy(() => import("../sheetmetal/SheetMetalWorkspace").then((m) => ({ default: m.SheetMetalWorkspace })));
const PartsWorkspace = lazy(() => import("../parts/PartsWorkspace").then((m) => ({ default: m.PartsWorkspace })));
const LaserTextDialog = lazy(() => import("../lasertext/LaserTextDialog").then((m) => ({ default: m.LaserTextDialog })));
import { SM_LAYERS } from "@agtn/sheetmetal";
import { CanvasView } from "../ui/CanvasView";
import { type MenuItem, MenuBar, ToolPalette, TopBar, type Workspace } from "../ui/Chrome";
import { CommandLine, type CommandLineHandle } from "../ui/CommandLine";
import {
  AboutDialog,
  DrawingSettingsDialog,
  DxfReportDialog,
  ExportDxfDialog,
  PrefsDialog,
  RecoveryDialog,
  SelectByTypeDialog,
  ShortcutsDialog,
} from "../ui/Dialogs";
import { useCtl } from "../ui/hooks";
import { Icon } from "../ui/Icons";
import { LayersPanel } from "../ui/LayersPanel";
import { PropertiesPanel } from "../ui/PropertiesPanel";
import { StatusBar } from "../ui/StatusBar";
import { FileActions, PRODUCT } from "./files";
import { StartCenter, type StartTarget } from "./StartCenter";
import { recents } from "./recents";
import { type AppPrefs, loadPrefs, savePrefs } from "./prefs";
import { Toasts } from "../ui/toast";

type Dialog = null | "about" | "shortcuts" | "dxf" | "bytype" | "settings" | "export" | "lasertext" | "prefs";

const Loading = ({ label }: { label: string }) => (
  <div className="loading-pane">
    <span className="spinner" />
    {label}
  </div>
);

const FAB_LAYERS: Layer[] = SM_LAYERS.map((l) => ({ name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }));

export function App() {
  const ctl = useMemo(() => new CadController(), []);
  const files = useMemo(() => new FileActions(ctl), [ctl]);
  useCtl(ctl, "state");
  const [ws, setWs] = useState<Workspace>("desenho");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [panels, setPanels] = useState({ left: true, right: true, history: true });
  const [recovery, setRecovery] = useState<{ when: string; name: string; payload: string } | null>(null);
  const [prefs, setPrefsState] = useState<AppPrefs>(loadPrefs);
  const setPrefs = (p: AppPrefs) => {
    savePrefs(p);
    setPrefsState(p);
  };
  files.defaultUnits = prefs.defaultUnits;
  const [start, setStart] = useState<boolean>(() => prefs.showStartCenter);
  const [leaving, setLeaving] = useState(false);
  const enterCad = useCallback((target: StartTarget) => {
    setWs(target === "lasertext" ? "desenho" : target);
    if (target === "lasertext") setDialog("lasertext");
    setLeaving(true);
    window.setTimeout(() => {
      setStart(false);
      setLeaving(false);
    }, 160);
  }, []);
  const goHome = useCallback(() => {
    ctl.cancel(true);
    setDialog(null);
    setStart(true);
  }, [ctl]);
  const cmd = useRef<CommandLineHandle>(null);
  const focusCommand = useCallback(() => cmd.current?.focus(), []);

  /* ------------------------------ ações nomeadas ------------------------------ */
  useEffect(() => {
    const a = ctl.actions;
    const sm = () => setWs("planificacao");
    for (const k of ["SM", "PLANIFICACAO", "PLANIFICAÇÃO", "CHAPA", "SHEETMETAL"]) a.set(k, sm);
    a.set("LA", () => setPanels((p) => ({ ...p, right: true })));
    a.set("LAYER", () => setPanels((p) => ({ ...p, right: true })));
    a.set("AJUDA", () => setDialog("shortcuts"));
    a.set("HELP", () => setDialog("shortcuts"));
    a.set("SOBRE", () => setDialog("about"));
    a.set("ZE", () => ctl.zoomExtents());
    a.set("SALVAR", () => void files.save());
    a.set("QSAVE", () => void files.save());
    a.set("DXFOUT", () => setDialog("export"));
    a.set("DXFIN", () => void files.importDxf());
    a.set("__EXPORT_DXF__", () => setDialog("export"));
    a.set("__DXF_REPORT__", () => setDialog("dxf"));
    a.set("SELTIPO", () => setDialog("bytype"));
    a.set("CONFIG", () => setDialog("settings"));
    for (const k of ["T", "TEXTO", "TEXTOLASER", "TL", "__LASERTEXT__"]) a.set(k, () => setDialog("lasertext"));
    for (const k of ["PECAS", "PEÇAS", "BIBLIOTECA", "BIB"]) a.set(k, () => setWs("pecas"));
  }, [ctl, files]);

  /* --------------------- título da janela, recuperação, fechar --------------------- */
  const [, force] = useState(0);
  useEffect(() => files.on(() => force((x) => x + 1)), [files]);
  useEffect(() => {
    void setWindowTitle(start ? `Start Center — ${PRODUCT}` : `${files.file.name}${ctl.doc.dirty ? " *" : ""} — ${PRODUCT}`);
  });
  useEffect(() => {
    void (async () => {
      const f = await startupFile().catch(() => null);
      if (f) {
        if (await files.openPath(f)) {
          setStart(false);
        }
        return;
      }
      const rec = await loadRecovery().catch(() => null);
      if (rec) {
        try {
          const r = JSON.parse(rec) as { at: string; name: string };
          setRecovery({ when: r.at, name: r.name, payload: rec });
        } catch {
          await clearRecovery();
        }
      }
    })();
    void guardClose(() => ctl.doc.dirty, async () => clearRecovery().catch(() => undefined));
    const t = window.setInterval(() => void files.autosave(), 60_000);
    return () => window.clearInterval(t);
  }, [ctl, files]);

  /* ---------------------------------- teclado ---------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") && !target.closest(".cmd-in");
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? ctl.redo() : ctl.undo()),
          y: () => ctl.redo(),
          s: () => void (e.shiftKey ? files.saveAs() : files.save()),
          o: () => void files.open().then((ok) => ok && start && enterCad("desenho")),
          n: () => void files.newDrawing().then((ok) => ok && start && enterCad("desenho")),
          a: () => ws === "desenho" && !start && ctl.sel.selectAll(),
        };
        if (map[k] && !(inField && (k === "z" || k === "y" || k === "a"))) {
          e.preventDefault();
          map[k]();
        }
        return;
      }
      const fkeys: Record<string, () => void> = {
        F1: () => setDialog("shortcuts"),
        F3: () => ctl.toggle("osnap"),
        F7: () => ctl.toggle("grid"),
        F8: () => ctl.toggle("ortho"),
        F9: () => ctl.toggle("gridSnap"),
        F10: () => ctl.toggle("polar"),
      };
      if (fkeys[e.key]) {
        e.preventDefault();
        fkeys[e.key]();
        return;
      }
      if (inField || ws !== "desenho" || dialog || start) return;
      if (e.key === "Delete" && !ctl.tool) {
        ctl.eraseSelection();
        return;
      }
      if (e.key === "Escape") {
        ctl.cancel();
        return;
      }
      // qualquer digitação vai para a linha de comando
      if (e.key.length === 1 && !e.altKey) focusCommand();
      if (e.key === "Enter") {
        focusCommand();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctl, files, ws, dialog, focusCommand, start, enterCad]);

  /* ------------------------- integração com PLANIFICAÇÃO ------------------------- */
  const insertGenerated = useCallback(
    (ents: Entity[], layerChanges: () => Change[], label: string, ref = { x: 0, y: 0 }, refLabel?: string) => {
      if (!ents.length) return;
      setWs("desenho");
      setDialog(null);
      setTimeout(() => {
        ctl.cancel(true);
        ctl.sel.clear();
        const t = new InsertTool(ctl, ents, layerChanges, label, ref, refLabel);
        ctl.tool = t;
        ctl.message(`Inserir ${label}: clique o ponto de inserção ou digite coordenadas (ex.: 0,0).`, "cmd");
        ctl.refresh();
        focusCommand();
      }, 30);
    },
    [ctl, focusCommand],
  );
  const exportGenerated = useCallback(
    (ents: Entity[], layers: Layer[], filter: string[], name: string) => {
      void files.exportDxf({ entities: ents, layerDefs: [{ name: "0", color: 7, lineweight: 0.25, linetype: "CONTINUOUS", visible: true, locked: false }, ...layers], layers: filter, suggested: name });
    },
    [files],
  );

  const fabLayerChanges = useCallback((): Change[] => {
    const out: Change[] = [];
    let n = ctl.doc.layers.length;
    for (const l of FAB_LAYERS) if (!ctl.doc.layer(l.name)) out.push({ kind: "layer-add", layer: l, index: n++ });
    return out;
  }, [ctl]);

  /* ----------------------------------- menus ----------------------------------- */
  const run = (id: string) => () => {
    setWs("desenho");
    ctl.runById(id);
    focusCommand();
  };
  const doc = ctl.doc;
  const menus: { title: string; items: MenuItem[] }[] = [
    {
      title: "Arquivo",
      items: [
        { label: "Início (Start Center)", run: goHome },
        { sep: true },
        { label: "Novo desenho", key: "Ctrl+N", run: () => void files.newDrawing() },
        { label: "Abrir…", key: "Ctrl+O", run: () => void files.open() },
        { label: "Salvar", key: "Ctrl+S", run: () => void files.save() },
        { label: "Salvar como…", key: "Ctrl+Shift+S", run: () => void files.saveAs() },
        { sep: true },
        { label: "Importar DXF…", run: () => void files.importDxf() },
        { label: "Exportar DXF…", run: () => setDialog("export") },
        { label: "Relatório da última importação DXF", disabled: !files.lastDxfReport, run: () => setDialog("dxf") },
      ],
    },
    {
      title: "Editar",
      items: [
        { label: `Desfazer${doc.undoLabel ? ` ${doc.undoLabel}` : ""}`, key: "Ctrl+Z", disabled: !doc.canUndo, run: () => ctl.undo() },
        { label: `Refazer${doc.redoLabel ? ` ${doc.redoLabel}` : ""}`, key: "Ctrl+Y", disabled: !doc.canRedo, run: () => ctl.redo() },
        { sep: true },
        { label: "Apagar seleção", key: "Delete", disabled: !ctl.sel.size, run: () => ctl.eraseSelection() },
        { label: "Selecionar tudo", key: "Ctrl+A", run: () => ctl.sel.selectAll() },
        { label: "Selecionar por tipo…", run: () => setDialog("bytype") },
        { label: "Desselecionar tudo", key: "Esc", run: () => ctl.sel.clear() },
      ],
    },
    {
      title: "Visualizar",
      items: [
        { label: "Zoom extensão", key: "ZE", run: () => ctl.zoomExtents() },
        { label: "Zoom janela", key: "Z → W", run: () => (run("ZOOM")(), ctl.submit("W")) },
        { label: "Aproximar", run: () => ctl.zoomFactor(1.5) },
        { label: "Afastar", run: () => ctl.zoomFactor(1 / 1.5) },
        { sep: true },
        { label: "Grade", key: "F7", checked: ctl.draft.grid, run: () => ctl.toggle("grid") },
        { label: "Exibir espessura de linha", checked: ctl.draft.lwt, run: () => ctl.toggle("lwt") },
        { sep: true },
        { label: "Painel de ferramentas", checked: panels.left, run: () => setPanels((p) => ({ ...p, left: !p.left })) },
        { label: "Painel de propriedades e camadas", checked: panels.right, run: () => setPanels((p) => ({ ...p, right: !p.right })) },
        { label: "Histórico da linha de comando", checked: panels.history, run: () => setPanels((p) => ({ ...p, history: !p.history })) },
      ],
    },
    {
      title: "Desenhar",
      items: [
        { label: "Linha", key: "L", run: run("LINE") },
        { label: "Polilinha", key: "PL", run: run("PLINE") },
        { label: "Retângulo", key: "REC", run: run("RECTANG") },
        { label: "Círculo", key: "C", run: run("CIRCLE") },
        { label: "Arco", key: "A", run: run("ARC") },
        { label: "Polígono", key: "POL", run: run("POLYGON") },
        { label: "Ponto", key: "PO", run: run("POINT") },
      ],
    },
    {
      title: "Modificar",
      items: [
        { label: "Mover", key: "M", run: run("MOVE") },
        { label: "Copiar", key: "CO", run: run("COPY") },
        { label: "Rotacionar", key: "RO", run: run("ROTATE") },
        { label: "Escala", key: "SC", run: run("SCALE") },
        { label: "Espelhar", key: "MI", run: run("MIRROR") },
        { label: "Offset", key: "O", run: run("OFFSET") },
        { label: "Trim", key: "TR", run: run("TRIM") },
        { label: "Extend", key: "EX", run: run("EXTEND") },
        { label: "Fillet", key: "F", run: run("FILLET") },
        { label: "Chanfro", key: "CHA", run: run("CHAMFER") },
        { label: "Stretch", key: "S", run: run("STRETCH") },
        { label: "Explodir", key: "X", run: run("EXPLODE") },
        { label: "Unir", key: "J", run: run("JOIN") },
        { label: "Apagar", key: "E", run: run("ERASE") },
      ],
    },
    {
      title: "Anotar",
      items: [
        { label: "Cota linear", key: "DLI", run: run("DIMLINEAR") },
        { label: "Cota alinhada", key: "DAL", run: run("DIMALIGNED") },
        { label: "Cota angular", key: "DAN", run: run("DIMANGULAR") },
        { label: "Cota de raio", key: "DRA", run: run("DIMRADIUS") },
        { label: "Cota de diâmetro", key: "DDI", run: run("DIMDIAMETER") },
        { sep: true },
        { label: "Texto para laser (geometria de corte)…", key: "T", run: () => setDialog("lasertext") },
        { label: "Texto de anotação", key: "DT", run: run("TEXT") },
        { label: "Estilo de cota e texto…", run: () => setDialog("settings") },
      ],
    },
    {
      title: "Camadas",
      items: [
        { label: "Gerenciador de camadas", key: "LA", run: () => (setWs("desenho"), setPanels((p) => ({ ...p, right: true }))) },
        {
          label: "Mover seleção para a camada atual",
          disabled: !ctl.sel.size,
          run: () => ctl.commit("Mover para camada", doc.updateChanges(ctl.sel.entities().map((e) => ({ ...e, layer: doc.currentLayer })))),
        },
        { sep: true },
        ...doc.layers.slice(0, 20).map((l) => ({
          label: `Camada atual: ${l.name}`,
          checked: l.name === doc.currentLayer,
          run: () => l.name !== doc.currentLayer && ctl.commit("Camada atual", [doc.setCurrentLayerChange(l.name)]),
        })),
      ],
    },
    {
      title: "Ferramentas",
      items: [
        { label: "Planificação de chapas e calandra (AGTN SHEET METAL)", key: "SM", run: () => setWs("planificacao") },
        { label: "Biblioteca de chapas (flanges, bolachas, suportes…)", key: "PECAS", run: () => setWs("pecas") },
        { label: "Texto para laser…", key: "T", run: () => setDialog("lasertext") },
        { label: "Medir distância", key: "DI", run: run("DIST") },
        { sep: true },
        { label: "Configurações do desenho…", run: () => setDialog("settings") },
        { label: "Preferências…", run: () => setDialog("prefs") },
      ],
    },
    {
      title: "Ajuda",
      items: [
        { label: "Comandos e atalhos", key: "F1", run: () => setDialog("shortcuts") },
        { label: "Sobre o AGTN CAD", run: () => setDialog("about") },
      ],
    },
  ];

  return (
    <div className="app">
      <TopBar ctl={ctl} files={files} ws={ws} setWs={setWs} onHome={goHome} />
      <MenuBar menus={menus} />
      {ws === "desenho" ? (
        <div className="work">
          {panels.left ? <ToolPalette ctl={ctl} /> : <div />}
          <CanvasView ctl={ctl} focusCommand={focusCommand} />
          {panels.right ? (
            <div className="side">
              <div className="panel" style={{ maxHeight: "55%" }}>
                <div className="panel-h">
                  Propriedades
                  <div className="spacer" />
                  <button className="ibtn" title="Ocultar painel" onClick={() => setPanels((p) => ({ ...p, right: false }))}>
                    <Icon name="panelR" />
                  </button>
                </div>
                <PropertiesPanel ctl={ctl} />
              </div>
              <div className="panel grow">
                <LayersPanel ctl={ctl} />
              </div>
            </div>
          ) : (
            <div />
          )}
        </div>
      ) : ws === "planificacao" ? (
        <Suspense fallback={<Loading label="Carregando planificação…" />}>
          <SheetMetalWorkspace ctl={ctl} onInsert={insertGenerated} onExportDxf={exportGenerated} />
        </Suspense>
      ) : (
        <Suspense fallback={<Loading label="Carregando biblioteca de chapas…" />}>
          <PartsWorkspace ctl={ctl} onInsert={insertGenerated} onExportDxf={exportGenerated} />
        </Suspense>
      )}
      {ws === "desenho" ? <CommandLine ref={cmd} ctl={ctl} showHistory={panels.history} /> : <div />}
      <StatusBar ctl={ctl} />

      {dialog === "about" && <AboutDialog onClose={() => setDialog(null)} />}
      {dialog === "lasertext" && (
        <Suspense fallback={<div className="busy"><div className="busy-card"><span className="spinner" />Carregando texto para laser…</div></div>}>
        <LaserTextDialog
          onClose={() => setDialog(null)}
          onInsert={(r, label) => insertGenerated(r.entities, fabLayerChanges, label)}
          onExport={(r, name) => exportGenerated(r.entities, FAB_LAYERS, ["CONTORNO_CORTE", "MARCACAO"], name)}
        />
        </Suspense>
      )}
      {dialog === "prefs" && (
        <PrefsDialog prefs={prefs} onChange={setPrefs} onClose={() => setDialog(null)} recentCount={recents.list().length} onClearRecents={() => recents.clear()} />
      )}
      {start && (
        <StartCenter
          ctl={ctl}
          files={files}
          leaving={leaving}
          onEnter={enterCad}
          onPrefs={() => setDialog("prefs")}
          onAbout={() => setDialog("about")}
          recovery={recovery}
          onRestore={() => {
            if (recovery) void files.restoreRecovery(recovery.payload).then((ok) => ok && enterCad("desenho"));
            setRecovery(null);
          }}
          onDiscardRecovery={() => {
            void clearRecovery();
            setRecovery(null);
          }}
        />
      )}
      {files.busy && (
        <div className="busy">
          <div className="busy-card">
            <span className="spinner" />
            {files.busy}
          </div>
        </div>
      )}
      <Toasts />
      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === "dxf" && files.lastDxfReport && <DxfReportDialog report={files.lastDxfReport} onClose={() => setDialog(null)} />}
      {dialog === "bytype" && <SelectByTypeDialog ctl={ctl} onClose={() => setDialog(null)} />}
      {dialog === "settings" && <DrawingSettingsDialog ctl={ctl} onClose={() => setDialog(null)} />}
      {dialog === "export" && (
        <ExportDxfDialog
          layers={doc.layers}
          onClose={() => setDialog(null)}
          onExport={(layers) => {
            setDialog(null);
            void files.exportDxf({ layers });
          }}
        />
      )}
      {recovery && !start && (
        <RecoveryDialog
          when={recovery.when}
          name={recovery.name}
          onRestore={() => {
            void files.restoreRecovery(recovery.payload);
            setRecovery(null);
          }}
          onDiscard={() => {
            void clearRecovery();
            setRecovery(null);
          }}
        />
      )}
    </div>
  );
}
