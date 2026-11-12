import { type Model3D, type Node3D, type NodeId, isShown } from "@agtn/model3d";
import { type FeatId, type FeatureStatus, FEATURE_LABEL, PRIMITIVE_LABEL } from "@agtn/solid";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icons";
import { featureIcon, featureSummary } from "./part/partUi";
import type { Sel } from "./store";

export type FeatAction = "edit" | "suppress" | "rollback" | "delete";

const ICON: Record<string, string> = {
  box: "box3d",
  cylinder: "cyl3d",
  sphere: "sphere3d",
  cone: "cone3d",
  torus: "torus3d",
  plane: "plane3d",
  tube: "tube3d",
  profile: "beam3d",
};

function nodeIcon(n: Node3D) {
  if (n.kind === "group") return "group3d";
  if (n.source.type === "part") return "part3d";
  return n.source.type === "primitive" ? ICON[n.source.spec.kind] : "cube3d";
}
function nodeKind(n: Node3D) {
  if (n.kind === "group") return `Conjunto · ${n.children.length} item(ns)`;
  if (n.source.type === "part") return `Peça paramétrica · ${n.source.features.length} operação(ões)`;
  return n.source.type === "primitive" ? PRIMITIVE_LABEL[n.source.spec.kind] : `Sólido importado (${n.source.origin})`;
}

/**
 * Árvore de componentes: reflete o documento (conjuntos, subconjuntos, corpos). Clique seleciona (Ctrl soma),
 * duplo clique ou F2 renomeia, olho oculta/exibe, setinha expande. Erros de regeneração aparecem no item.
 */
export function Tree3D({
  model,
  sel,
  hover,
  errors,
  onSelect,
  onHover,
  onRename,
  onVisible,
  onFocus,
  status,
  fsel,
  onFeature,
  onFeatureAct,
  onRollbackEnd,
}: {
  model: Model3D;
  sel: readonly Sel[];
  hover: Sel | null;
  errors: Readonly<Record<string, string>>;
  onSelect: (id: NodeId, additive: boolean) => void;
  onHover: (id: NodeId | null) => void;
  onRename: (id: NodeId, name: string) => void;
  onVisible: (id: NodeId, v: boolean) => void;
  onFocus: (id: NodeId) => void;
  status: Readonly<Record<NodeId, readonly FeatureStatus[]>>;
  fsel: { body: NodeId; id: FeatId } | null;
  onFeature: (body: NodeId, id: FeatId) => void;
  onFeatureAct: (body: NodeId, id: FeatId, a: FeatAction) => void;
  onRollbackEnd: (body: NodeId) => void;
}) {
  const [closed, setClosed] = useState<Set<NodeId>>(new Set());
  const [editing, setEditing] = useState<NodeId | null>(null);
  const selected = new Set(sel.flatMap((s) => (s.t === "node" ? [s.id] : [s.body])));
  const directSel = new Set(sel.flatMap((s) => (s.t === "node" ? [s.id] : [])));
  const hovered = hover?.t === "node" ? hover.id : hover?.t === "topo" ? hover.body : null;
  const listRef = useRef<HTMLDivElement>(null);

  // F2 renomeia o item selecionado (só quando a árvore ou o viewport têm o foco)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "F2" || directSel.size !== 1) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
      e.preventDefault();
      setEditing([...directSel][0]);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // revela o item selecionado no viewport (abre os conjuntos pais e rola até ele)
  useEffect(() => {
    const last = sel.at(-1);
    if (!last) return;
    const id = last.t === "node" ? last.id : last.body;
    let p = model.nodes[id]?.parent ?? null;
    const open: NodeId[] = [];
    while (p) {
      if (closed.has(p)) open.push(p);
      p = model.nodes[p]?.parent ?? null;
    }
    if (open.length) setClosed((c) => new Set([...c].filter((x) => !open.includes(x))));
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-node="${id}"]`)?.scrollIntoView({ block: "nearest" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const row = (id: NodeId, depth: number): React.ReactNode => {
    const n = model.nodes[id];
    if (!n) return null;
    const shown = isShown(model, id);
    const isOpen = !closed.has(id);
    return (
      <div key={id}>
        <div
          className={`t3-row${directSel.has(id) ? " sel" : selected.has(id) ? " sub" : ""}${hovered === id ? " hov" : ""}${shown ? "" : " hidden"}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          data-node={id}
          title={`${n.name} — ${nodeKind(n)}${errors[id] ? `\n⚠ ${errors[id]}` : ""}`}
          onMouseEnter={() => onHover(id)}
          onMouseLeave={() => onHover(null)}
          onClick={(e) => onSelect(id, e.ctrlKey || e.shiftKey || e.metaKey)}
          onDoubleClick={() => setEditing(id)}
        >
          {n.kind === "group" || (n.kind === "body" && n.source.type === "part") ? (
            <button
              className="t3-caret"
              aria-label={isOpen ? "Recolher" : "Expandir"}
              onClick={(e) => {
                e.stopPropagation();
                setClosed((c) => {
                  const x = new Set(c);
                  if (x.has(id)) x.delete(id);
                  else x.add(id);
                  return x;
                });
              }}
            >
              <Icon name={isOpen ? "caretDown" : "caret"} />
            </button>
          ) : (
            <span className="t3-caret" />
          )}
          <span className="t3-ico" style={n.kind === "body" ? { color: n.color } : undefined}>
            <Icon name={nodeIcon(n)} />
          </span>
          {editing === id ? (
            <input
              className="t3-edit"
              autoFocus
              defaultValue={n.name}
              spellCheck={false}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => {
                setEditing(null);
                if (e.target.value.trim() && e.target.value !== n.name) onRename(id, e.target.value);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  (e.target as HTMLInputElement).value = n.name;
                  setEditing(null);
                }
              }}
            />
          ) : (
            <span className="t3-name">{n.name}</span>
          )}
          {errors[id] && (
            <span className="t3-err" title={errors[id]}>
              !
            </span>
          )}
          <button
            className="t3-act"
            title="Enquadrar no viewport"
            onClick={(e) => {
              e.stopPropagation();
              onFocus(id);
            }}
          >
            <Icon name="fit3d" />
          </button>
          <button
            className={`t3-act eye${n.visible ? "" : " off"}`}
            title={n.visible ? "Ocultar (H)" : "Exibir"}
            aria-pressed={!n.visible}
            onClick={(e) => {
              e.stopPropagation();
              onVisible(id, !n.visible);
            }}
          >
            <Icon name={n.visible ? "eye" : "eyeoff"} />
          </button>
        </div>
        {n.kind === "group" && isOpen && n.children.map((c) => row(c, depth + 1))}
        {n.kind === "body" && n.source.type === "part" && isOpen && featureRows(n.id, n.source.features, n.source.rollback, depth + 1)}
      </div>
    );
  };

  /** Histórico da peça: operações na ordem, estado de cada uma e a barra de recuo. */
  const featureRows = (body: NodeId, features: readonly import("@agtn/solid").Feature[], rollback: number | null, depth: number) => {
    const st = new Map((status[body] ?? []).map((s) => [s.id, s]));
    const rb = rollback ?? features.length;
    const bar = (
      <div key="__rb" className="t3-rb" style={{ marginLeft: 6 + depth * 14 }} title={rollback === null ? "Fim da peça" : "Barra de recuo: as operações abaixo estão desativadas"}>
        <span />
        {rollback !== null && (
          <button className="lnk" onClick={() => onRollbackEnd(body)}>
            avançar ao fim
          </button>
        )}
      </div>
    );
    const out: React.ReactNode[] = [];
    features.forEach((f, i) => {
      if (i === rb) out.push(bar);
      const s = st.get(f.id);
      const state = f.suppressed ? "suppressed" : i >= rb ? "rolledback" : (s?.state ?? "ok");
      const on = fsel?.body === body && fsel.id === f.id;
      out.push(
        <div
          key={f.id}
          className={`t3-row t3-feat ${state}${on ? " sel" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          data-feat={f.name}
          title={`${f.name} — ${FEATURE_LABEL[f.t]} · ${featureSummary(f)}${s?.error ? `\n⚠ ${s.error}` : ""}${state === "suppressed" ? "\n(suprimida)" : ""}${s && s.state === "ok" ? `\n${Math.round(s.ms)} ms` : ""}`}
          onClick={() => onFeature(body, f.id)}
          onDoubleClick={() => onFeatureAct(body, f.id, "edit")}
        >
          <span className="t3-caret" />
          <span className="t3-ico">
            <Icon name={featureIcon(f)} />
          </span>
          <span className="t3-name">{f.name}</span>
          {state === "error" && (
            <span className="t3-err" title={s?.error}>
              !
            </span>
          )}
          <button className="t3-act" title="Editar (duplo clique)" onClick={(e) => (e.stopPropagation(), onFeatureAct(body, f.id, "edit"))}>
            <Icon name="edit3d" />
          </button>
          <button className="t3-act" title="Recuar até aqui (desativa esta e as seguintes)" onClick={(e) => (e.stopPropagation(), onFeatureAct(body, f.id, "rollback"))}>
            <Icon name="rollback" />
          </button>
          <button className={`t3-act${f.suppressed ? " on" : ""}`} title={f.suppressed ? "Reativar" : "Suprimir"} onClick={(e) => (e.stopPropagation(), onFeatureAct(body, f.id, "suppress"))}>
            <Icon name="suppress" />
          </button>
        </div>,
      );
    });
    if (rb >= features.length) out.push(bar);
    if (!features.length) out.push(<div key="__e" className="t3-empty sm">Peça vazia — crie um esboço.</div>);
    return out;
  };

  return (
    <div className="t3" ref={listRef} role="tree" aria-label="Componentes do modelo 3D">
      {model.roots.length ? (
        model.roots.map((id) => row(id, 0))
      ) : (
        <div className="t3-empty">Nenhum componente. Crie uma primitiva ou importe um STEP.</div>
      )}
    </div>
  );
}
