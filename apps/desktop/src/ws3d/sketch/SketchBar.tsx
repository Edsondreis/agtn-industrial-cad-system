import { CONSTRAINT_LABEL, type ConstraintKind, STATUS_LABEL } from "@agtn/sketch";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "../../ui/Icons";
import { parseNum } from "../../ui/fields";
import { type DimKind, type SketchEditor, type SketchTool, TOOL_LABEL } from "./editor";

const TOOLS: [SketchTool, string, string, string][] = [
  ["select", "select", "Selecionar", "Esc"],
  ["line", "pline", "Linha", "L"],
  ["rect", "rect", "Retângulo", "R"],
  ["circle", "circle", "Círculo", "C"],
  ["arc", "arc", "Arco", "A"],
  ["point", "point", "Ponto", "P"],
  ["trim", "trim", "Aparar", "T"],
  ["extend", "extend", "Estender", "E"],
  ["offset", "offset", "Offset", "O"],
  ["dimension", "dimlin", "Cota", "D"],
];
const CONS: [ConstraintKind, string][] = [
  ["coincident", "•"],
  ["horizontal", "H"],
  ["vertical", "V"],
  ["parallel", "∥"],
  ["perpendicular", "⊥"],
  ["tangent", "T"],
  ["concentric", "◎"],
  ["equal", "="],
  ["midpoint", "M"],
  ["fixed", "⚓"],
];
const DIM_LABEL: Record<DimKind, string> = {
  distance: "Alinhada",
  distanceX: "Horizontal",
  distanceY: "Vertical",
  length: "Comprimento",
  radius: "Raio",
  diameter: "Diâmetro",
  angle: "Ângulo",
  pointLineDistance: "Ponto–linha",
};

/** Faixa de ferramentas do modo esboço + estado de definição. */
export function SketchBar({ editor, name, onFinish, onCancel, onNormal }: { editor: SketchEditor; name: string; onFinish: () => void; onCancel: () => void; onNormal: () => void }) {
  const st = useSyncExternalStore(editor.subscribe, editor.getState);
  const app = editor.applicable();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.shiftKey) editor.redo();
          else editor.undo();
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          e.stopImmediatePropagation();
          editor.redo();
        }
        return;
      }
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        return editor.escape();
      }
      if (e.key === "Delete") {
        e.stopImmediatePropagation();
        return editor.deleteSelection();
      }
      const tool = TOOLS.find(([, , , k]) => k.toLowerCase() === e.key.toLowerCase() && k.length === 1);
      if (tool) {
        e.stopImmediatePropagation();
        editor.setTool(tool[0]);
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [editor]);
  const status = st.solve.status;
  return (
    <div className="rb sk-rb" role="toolbar" aria-label="Ferramentas de esboço">
      <div className="rb-grp">
        <div className="rb-btns">
          {TOOLS.map(([t, ic, lb, key]) => (
            <button key={t} className={`rb-btn${st.tool === t ? " on" : ""}`} title={`${TOOL_LABEL[t]} (${key})`} onClick={() => editor.setTool(t)} data-sktool={t}>
              <Icon name={ic} />
              <span>{lb}</span>
            </button>
          ))}
        </div>
        <div className="rb-cap">ESBOÇO · {name.toUpperCase()}</div>
      </div>
      <div className="rb-grp">
        <div className="rb-btns sk-cons">
          {CONS.map(([k, g]) => (
            <button key={k} className="sk-cbtn" disabled={!app.includes(k)} title={`${CONSTRAINT_LABEL[k]} — selecione as entidades e clique`} onClick={() => editor.constrain(k)} data-cons={k}>
              {g}
            </button>
          ))}
        </div>
        <div className="rb-cap">RESTRIÇÕES</div>
      </div>
      <div className="rb-grp">
        <div className="rb-btns">
          <button className="rb-btn" title="Alternar geometria de construção (não entra no perfil)" disabled={!st.sel.length} onClick={() => editor.toggleConstruction()}>
            <Icon name="dimal" />
            <span>Construção</span>
          </button>
          <button className="rb-btn" title="Excluir seleção (Delete)" disabled={!st.sel.length} onClick={() => editor.deleteSelection()}>
            <Icon name="trash" />
            <span>Excluir</span>
          </button>
          <button className="rb-btn" title="Desfazer no esboço (Ctrl+Z)" disabled={!st.canUndo} onClick={() => editor.undo()}>
            <Icon name="undo" />
            <span>Desfazer</span>
          </button>
          <button className="rb-btn" title="Refazer (Ctrl+Y)" disabled={!st.canRedo} onClick={() => editor.redo()}>
            <Icon name="redo" />
            <span>Refazer</span>
          </button>
          <button className="rb-btn" title="Olhar o esboço de frente" onClick={onNormal}>
            <Icon name="plane3d" />
            <span>Normal</span>
          </button>
        </div>
        <div className="rb-cap">EDITAR</div>
      </div>
      <div className="rb-grp sk-end">
        <div className="rb-btns">
          <div className={`sk-state ${status}`} title={st.solve.message} data-sketch-status={status}>
            <b>{STATUS_LABEL[status]}</b>
            <span>{status === "under" ? `${st.solve.dof} grau(s) de liberdade` : status === "full" ? "pronto para extrusão" : st.solve.message}</span>
          </div>
          <button className="btn primary" onClick={onFinish} disabled={status === "inconsistent"} data-testid="sketch-finish">
            Concluir esboço
          </button>
          <button className="btn" onClick={onCancel}>
            Cancelar
          </button>
        </div>
        <div className="rb-cap">{st.error ? <span className="sk-err">{st.error}</span> : (st.message ?? "")}</div>
      </div>
    </div>
  );
}

/** Campo de valor da cota, posicionado junto ao ponto clicado. */
export function DimInput({ editor, place }: { editor: SketchEditor; place: (p: { x: number; y: number }) => { x: number; y: number } | null }) {
  const st = useSyncExternalStore(editor.subscribe, editor.getState);
  const ref = useRef<HTMLInputElement>(null);
  const [txt, setTxt] = useState("");
  const p = st.prompt;
  useEffect(() => {
    if (!p) return;
    setTxt(String(Number(Math.abs(p.value).toFixed(4))).replace(".", ","));
    requestAnimationFrame(() => ref.current?.select());
  }, [p]);
  if (!p) return null;
  const at = place(p.at);
  if (!at) return null;
  const submit = () => {
    const v = parseNum(txt);
    if (v === null) return;
    const signed = (p.kind === "distanceX" || p.kind === "distanceY") && p.value < 0 ? -Math.abs(v) : v;
    editor.confirmDimension(signed);
  };
  return (
    <div className="sk-prompt" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      {p.options.length > 1 && (
        <select value={p.kind} onChange={(e) => editor.setPromptKind(e.target.value as DimKind)}>
          {p.options.map((o) => (
            <option key={o} value={o}>
              {DIM_LABEL[o]}
            </option>
          ))}
        </select>
      )}
      <input
        ref={ref}
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        spellCheck={false}
        data-testid="dim-input"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") submit();
          if (e.key === "Escape") editor.cancelPrompt();
        }}
      />
      <i>{p.kind === "angle" ? "°" : "mm"}</i>
      <button className="ibtn" title="Aplicar (Enter)" onClick={submit}>
        <Icon name="check" />
      </button>
    </div>
  );
}
