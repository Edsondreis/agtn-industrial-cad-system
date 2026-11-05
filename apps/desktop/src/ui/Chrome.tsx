import { useEffect, useRef, useState } from "react";
import type { CadController } from "../cad/controller";
import type { FileActions } from "../app/files";
import { Icon } from "./Icons";
import { useCtl } from "./hooks";

export type Workspace = "desenho" | "planificacao" | "pecas";

export interface MenuItem {
  label?: string;
  key?: string;
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  sep?: boolean;
}

/** Barra superior: marca, arquivo aberto, ações rápidas e área de trabalho. */
export function TopBar({
  ctl,
  files,
  ws,
  setWs,
  onHome,
}: {
  ctl: CadController;
  files: FileActions;
  ws: Workspace;
  setWs: (w: Workspace) => void;
  onHome: () => void;
}) {
  useCtl(ctl, "state");
  const [, force] = useState(0);
  useEffect(() => files.on(() => force((x) => x + 1)), [files]);
  const doc = ctl.doc;
  return (
    <div className="topbar">
      <button className="ibtn" title="Início — Start Center" onClick={onHome} aria-label="Início">
        <Icon name="home" />
      </button>
      <div className="brand" title="AGTN Industrial CAD">
        <img className="brand-logo" src="/brand/agtn-mark-dark.svg" alt="AGTN" />
        <span>Industrial CAD</span>
      </div>
      <button className="ibtn" title="Novo desenho (Ctrl+N)" onClick={() => files.newDrawing()}>
        <Icon name="new" />
      </button>
      <button className="ibtn" title="Abrir projeto ou DXF (Ctrl+O)" onClick={() => files.open()}>
        <Icon name="open" />
      </button>
      <button className="ibtn" title="Salvar (Ctrl+S)" onClick={() => files.save()}>
        <Icon name="save" />
      </button>
      <div className="tb-sep" />
      <button className="ibtn" title={`Desfazer${doc.undoLabel ? `: ${doc.undoLabel}` : ""} (Ctrl+Z)`} disabled={!doc.canUndo} onClick={() => ctl.undo()}>
        <Icon name="undo" />
      </button>
      <button className="ibtn" title={`Refazer${doc.redoLabel ? `: ${doc.redoLabel}` : ""} (Ctrl+Y)`} disabled={!doc.canRedo} onClick={() => ctl.redo()}>
        <Icon name="redo" />
      </button>
      <div className="tb-sep" />
      <button className="ibtn" title="Importar DXF no desenho atual" onClick={() => files.importDxf()}>
        <Icon name="import" />
        <span className="lbl">Importar</span>
      </button>
      <button className="ibtn" title="Exportar DXF R12" onClick={() => ctl.actions.get("__EXPORT_DXF__")?.()}>
        <Icon name="export" />
        <span className="lbl">Exportar</span>
      </button>
      <div className="filechip" title={files.file.path ?? "Ainda não salvo em disco"}>
        <span className="ico">
          <Icon name="file" />
        </span>
        <b>{files.file.name}</b>
        <span className="meta">{doc.settings.units}</span>
        {doc.dirty && <span className="unsaved">não salvo</span>}
      </div>
      <div className="spacer" />
      <div className="ws-tabs">
        <button className={`ws-tab${ws === "desenho" ? " on" : ""}`} onClick={() => setWs("desenho")}>
          DESENHO
        </button>
        <button className={`ws-tab${ws === "planificacao" ? " on" : ""}`} onClick={() => setWs("planificacao")} title="AGTN SHEET METAL — chapas, dobras e planificação">
          PLANIFICAÇÃO
        </button>
        <button className={`ws-tab${ws === "pecas" ? " on" : ""}`} onClick={() => setWs("pecas")} title="Biblioteca de chapas pré-definidas">
          PEÇAS
        </button>
      </div>
    </div>
  );
}

/** Menu principal. */
export function MenuBar({ menus }: { menus: { title: string; items: MenuItem[] }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="menubar" ref={ref}>
      {menus.map((m, i) => (
        <div key={m.title} className={`menu${open === i ? " open" : ""}`} onMouseEnter={() => open !== null && setOpen(i)}>
          <button onClick={() => setOpen(open === i ? null : i)}>{m.title}</button>
          {open === i && (
            <div className="dropdown">
              {m.items.map((it, k) =>
                it.sep ? (
                  <hr key={k} />
                ) : (
                  <button
                    key={k}
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.run?.();
                    }}
                  >
                    <span className="check">{it.checked ? "✓" : ""}</span>
                    {it.label}
                    {it.key && <span className="k">{it.key}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const PALETTE: (string | [id: string, icon: string, title: string])[] = [
  ["__SELECT__", "select", "Seleção (Esc)"],
  "|",
  ["LINE", "line", "Linha (L)"],
  ["PLINE", "pline", "Polilinha (PL)"],
  ["RECTANG", "rect", "Retângulo (REC)"],
  ["CIRCLE", "circle", "Círculo (C)"],
  ["ARC", "arc", "Arco (A)"],
  ["POLYGON", "polygon", "Polígono (POL)"],
  ["POINT", "point", "Ponto (PO)"],
  "|",
  ["MOVE", "move", "Mover (M)"],
  ["COPY", "copy", "Copiar (CO)"],
  ["ROTATE", "rotate", "Rotacionar (RO)"],
  ["SCALE", "scale", "Escala (SC)"],
  ["MIRROR", "mirror", "Espelhar (MI)"],
  ["OFFSET", "offset", "Offset (O)"],
  ["TRIM", "trim", "Trim (TR)"],
  ["EXTEND", "extend", "Extend (EX)"],
  ["FILLET", "fillet", "Fillet (F)"],
  ["CHAMFER", "chamfer", "Chanfro (CHA)"],
  ["STRETCH", "stretch", "Stretch (S)"],
  ["EXPLODE", "explode", "Explodir (X)"],
  ["JOIN", "join", "Unir (J)"],
  ["ERASE", "erase", "Apagar (E / Delete)"],
  "|",
  ["DIST", "dist", "Medir distância (DI)"],
  ["DIMLINEAR", "dimlin", "Cota linear (DLI)"],
  ["DIMALIGNED", "dimal", "Cota alinhada (DAL)"],
  ["DIMANGULAR", "dimang", "Cota angular (DAN)"],
  ["DIMRADIUS", "dimrad", "Cota de raio (DRA)"],
  ["__LASERTEXT__", "text", "Texto para laser — vira geometria de corte (T)"],
];

/** Barra lateral de ferramentas. */
export function ToolPalette({ ctl }: { ctl: CadController }) {
  useCtl(ctl, "state");
  return (
    <div className="palette">
      {PALETTE.map((p, i) =>
        typeof p === "string" ? (
          <div key={i} className="grp" />
        ) : (
          <button
            key={p[0]}
            className={`ibtn${(p[0] === "__SELECT__" ? !ctl.tool : ctl.tool?.id === p[0]) ? " on" : ""}`}
            title={p[2]}
            onClick={() => (p[0] === "__SELECT__" ? ctl.cancel(true) : p[0].startsWith("__") ? ctl.actions.get(p[0])?.() : ctl.runById(p[0]))}
          >
            <Icon name={p[1]} />
          </button>
        ),
      )}
    </div>
  );
}
