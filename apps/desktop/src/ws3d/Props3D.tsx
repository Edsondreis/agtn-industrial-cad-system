import { type BodyNode, MATERIALS, type MaterialId, type Model3D, type NodeId, bodies, massKg, pathOf, sourceLabel, subtree } from "@agtn/model3d";
import type { MassProps, Placement, PrimitiveSpec, TopoInfo, Vec3 } from "@agtn/solid";
import { NumField, TextField } from "../ui/fields";
import { PRIM_FIELDS, PROFILE_FIELDS } from "./PrimitiveDialog";
import type { BodyGeom, SheetInfo } from "./protocol";
import { kSourceLabel } from "./part/sheetUi";
import { KIND_LABEL, type Sel, type Ws3dSnapshot } from "./store";
import { fmt } from "./viewport";

const SURF: Record<string, string> = {
  plane: "Plana",
  cylinder: "Cilíndrica",
  cone: "Cônica",
  sphere: "Esférica",
  torus: "Toroidal",
  bspline: "B-spline (forma livre)",
  bezier: "Bézier",
  revolution: "De revolução",
  extrusion: "Extrudada",
  offset: "Offset",
};
const CURVE: Record<string, string> = { line: "Reta", circle: "Circular", ellipse: "Elíptica", bspline: "B-spline", bezier: "Bézier" };

const Row = ({ k, v, unit, title }: { k: string; v: React.ReactNode; unit?: string; title?: string }) => (
  <div className="p3-row" title={title}>
    <span className="k">{k}</span>
    <span className="v">
      {v}
      {unit && <i>{unit}</i>}
    </span>
  </div>
);
const vec = (p: Vec3 | undefined, d = 3) => (p ? `${fmt(p.x, d)} ; ${fmt(p.y, d)} ; ${fmt(p.z, d)}` : "—");
const dims = (m: MassProps) => {
  const b = m.bbox;
  return `${fmt(b.max.x - b.min.x, 2)} × ${fmt(b.max.y - b.min.y, 2)} × ${fmt(b.max.z - b.min.z, 2)}`;
};

export interface Props3DActions {
  rename(id: NodeId, name: string): void;
  placement(id: NodeId, p: Placement): void;
  color(id: NodeId, c: string): void;
  material(id: NodeId, m: MaterialId): void;
  spec(id: NodeId, s: PrimitiveSpec): void;
}

/** Painel de propriedades: corpo/conjunto selecionado, elemento topológico (geometria exata) ou medição. */
export type PartialOf = (id: NodeId) => { readonly name: string; readonly error: string } | undefined;

export function Props3D({ model, snap, geom, act, partial, sheet }: { model: Model3D; snap: Ws3dSnapshot; geom: (id: NodeId) => BodyGeom | undefined; act: Props3DActions; partial?: PartialOf; sheet?: (id: NodeId) => SheetInfo | undefined }) {
  const sel = snap.sel;
  if (snap.measuring || (sel.length === 2 && snap.measure)) return <MeasurePanel snap={snap} model={model} />;
  if (!sel.length) return <Summary model={model} geom={geom} />;
  if (sel.length > 1) return <Multi sel={sel} model={model} geom={geom} />;
  const s = sel[0];
  if (s.t === "topo") return <TopoPanel s={s} info={snap.info?.info ?? null} model={model} />;
  const n = model.nodes[s.id];
  if (!n) return null;
  return (
    <div className="p3">
      <section>
        <h4>{n.kind === "group" ? "Conjunto" : "Corpo"}</h4>
        <div className="p3-row edit">
          <span className="k">Nome</span>
          <TextField value={n.name} onCommit={(v) => act.rename(n.id, v)} />
        </div>
        <Row k="Caminho" v={<span className="mono-sm">{pathOf(model, n.id)}</span>} />
        {n.kind === "body" && <Row k="Definição" v={sourceLabel(n.source)} />}
      </section>
      {n.kind === "body" && n.source.type === "primitive" && <ParamsEditor body={n} onSpec={(sp) => act.spec(n.id, sp)} />}
      <PlacementEditor p={n.placement} onChange={(p) => act.placement(n.id, p)} relative={!!n.parent} />
      {n.kind === "body" && (
        <section>
          <h4>Aparência e material</h4>
          <div className="p3-row edit">
            <span className="k">Cor</span>
            <input type="color" value={n.color} onChange={(e) => act.color(n.id, e.target.value)} aria-label="Cor do corpo" />
          </div>
          <div className="p3-row edit">
            <span className="k">Material</span>
            <select value={n.material} onChange={(e) => act.material(n.id, e.target.value as MaterialId)}>
              {(Object.keys(MATERIALS) as MaterialId[]).map((m) => (
                <option key={m} value={m}>
                  {MATERIALS[m].label}
                  {MATERIALS[m].density ? ` (${String(MATERIALS[m].density).replace(".", ",")} g/cm³)` : ""}
                </option>
              ))}
            </select>
          </div>
        </section>
      )}
      <PartialNote ids={n.kind === "body" ? [n.id] : subtree(model, n.id)} model={model} partial={partial} />
      {n.kind === "body" && sheet?.(n.id) && <SheetPanel info={sheet(n.id)!} body={n} />}
      <Physical ids={n.kind === "body" ? [n.id] : subtree(model, n.id)} model={model} geom={geom} />
    </div>
  );
}

/** Peça de chapa: medidas da planificação e tabela de dobras — leitura do mesmo grafo do sólido. */
function SheetPanel({ info, body }: { info: SheetInfo; body: BodyNode }) {
  const fp = info.flat;
  const ok = fp.state === "valida";
  return (
    <section className="p3-sheet" data-testid="sheet-panel">
      <h4>Chapa</h4>
      <Row k="Espessura" v={fmt(info.T, 3)} unit="mm" />
      <Row k="Abas / dobras" v={`${info.flanges.length} / ${fp.bends.length}`} />
      <Row k="Planificação" v={<b className={ok ? "ok" : "bad"} data-testid="flat-state">{ok ? "válida" : "inválida"}</b>} />
      {!ok && fp.reasons.map((r, i) => <div key={i} className="fd-note bad">{r}</div>)}
      {ok && (
        <>
          <Row k="Blank" v={<span data-testid="flat-blank">{`${fmt(fp.box.maxX - fp.box.minX, 3)} × ${fmt(fp.box.maxY - fp.box.minY, 3)}`}</span>} unit="mm" />
          <Row k="Área plana" v={fmt(fp.area, 2)} unit="mm²" />
          <Row k="Corte" v={fmt(fp.cutLength, 2)} unit="mm" />
          <Row k="Massa" v={fmt(massKg(info.T * fp.area, body.material), 3)} unit="kg" title="T × área plana × densidade do material" />
        </>
      )}
      <Row k="Regeneração" v={`${fmt(info.ms.solve + info.ms.build, 0)} ms`} title={`grafo ${fmt(info.ms.solve, 1)} ms · OCCT ${fmt(info.ms.build, 1)} ms`} />
      {fp.bends.length > 0 && (
        <table className="p3-bends" data-testid="bend-table">
          <thead>
            <tr>
              <th>#</th>
              <th title="Ângulo de dobra (deflexão)">θ</th>
              <th title="Ângulo interno = 180° − θ">α</th>
              <th>R</th>
              <th>K</th>
              <th>BA</th>
              <th>BD</th>
              <th>L</th>
            </tr>
          </thead>
          <tbody>
            {fp.bends.map((b) => (
              <tr key={b.id} title={`${b.label} · ${b.sense} · K ${kSourceLabel(b.kSource).toLowerCase()}`}>
                <td>D{b.n}</td>
                <td>{fmt(b.deflectionDeg, 2)}°</td>
                <td>{fmt(b.includedDeg, 2)}°</td>
                <td>{fmt(b.R, 2)}</td>
                <td>{fmt(b.K, 3)}</td>
                <td>{fmt(b.BA, 3)}</td>
                <td>{fmt(b.BD, 3)}</td>
                <td>{fmt(b.L, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Peça com operação falhando: as medidas abaixo são do último sólido válido — dito explicitamente. */
function PartialNote({ ids, model, partial }: { ids: NodeId[]; model: Model3D; partial?: PartialOf }) {
  const bad = ids.map((id) => ({ id, p: partial?.(id) })).filter((x) => x.p);
  if (!bad.length) return null;
  return (
    <section className="p3-partial" data-testid="partial-note">
      {bad.map(({ id, p }) => (
        <div key={id}>
          <b>⚠ {model.nodes[id]?.name}: {p!.name} falhou.</b> Volume, área e massa abaixo são do último sólido válido (antes dela) — não do modelo completo.
        </div>
      ))}
    </section>
  );
}

function ParamsEditor({ body, onSpec }: { body: BodyNode; onSpec: (s: PrimitiveSpec) => void }) {
  if (body.source.type !== "primitive") return null;
  const s = body.source.spec;
  const fields = s.kind === "profile" ? [...PROFILE_FIELDS[s.profile.shape], ["length", "Comprimento"] as [string, string]] : PRIM_FIELDS[s.kind];
  const get = (k: string) => (s.kind === "profile" ? (k === "length" ? s.length : (s.profile as unknown as Record<string, number>)[k]) : (s as unknown as Record<string, number>)[k]);
  const set = (k: string, v: number) => {
    if (s.kind === "profile") onSpec(k === "length" ? { ...s, length: v } : { ...s, profile: { ...s.profile, [k]: v } as typeof s.profile });
    else onSpec({ ...s, [k]: v } as PrimitiveSpec);
  };
  return (
    <section>
      <h4>Parâmetros</h4>
      {fields.map(([k, label]) => (
        <div className="p3-row edit" key={k}>
          <span className="k">{label}</span>
          <span className="unit-in">
            <NumField value={get(k)} onCommit={(v) => set(k, v)} />
            <i>mm</i>
          </span>
        </div>
      ))}
    </section>
  );
}

function PlacementEditor({ p, onChange, relative }: { p: Placement; onChange: (p: Placement) => void; relative: boolean }) {
  const ax = ["x", "y", "z"] as const;
  return (
    <section>
      <h4>Posição {relative ? <small>(relativa ao conjunto)</small> : null}</h4>
      <div className="xyz">
        {ax.map((a) => (
          <label key={a}>
            <b className={`ax-${a}`}>{a.toUpperCase()}</b>
            <NumField value={p.origin[a]} onCommit={(v) => onChange({ ...p, origin: { ...p.origin, [a]: v } })} />
          </label>
        ))}
      </div>
      <div className="xyz">
        {ax.map((a) => (
          <label key={a}>
            <b className={`ax-${a}`}>∠{a.toUpperCase()}</b>
            <NumField value={p.rot[a]} onCommit={(v) => onChange({ ...p, rot: { ...p.rot, [a]: v } })} />
          </label>
        ))}
      </div>
    </section>
  );
}

function Physical({ ids, model, geom }: { ids: NodeId[]; model: Model3D; geom: (id: NodeId) => BodyGeom | undefined }) {
  const list = ids.map((id) => model.nodes[id]).filter((n): n is BodyNode => n?.kind === "body");
  const gs = list.map((b) => ({ b, g: geom(b.id) })).filter((x): x is { b: BodyNode; g: BodyGeom } => !!x.g);
  if (!list.length) return null;
  if (!gs.length)
    return (
      <section>
        <h4>Propriedades físicas</h4>
        <div className="note">Calculando…</div>
      </section>
    );
  const vol = gs.reduce((a, x) => a + x.g.props.volume, 0);
  const area = gs.reduce((a, x) => a + x.g.props.area, 0);
  const mass = gs.reduce((a, x) => a + massKg(x.g.props.volume, x.b.material), 0);
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const { g } of gs)
    for (const a of ["x", "y", "z"] as const) {
      min[a] = Math.min(min[a], g.props.bbox.min[a]);
      max[a] = Math.max(max[a], g.props.bbox.max[a]);
    }
  const box: MassProps = { volume: vol, area, centroid: { x: 0, y: 0, z: 0 }, bbox: { min, max } };
  const one = gs.length === 1 ? gs[0].g : null;
  return (
    <section>
      <h4>Propriedades físicas {gs.length > 1 ? <small>({gs.length} corpos)</small> : null}</h4>
      <Row k="Volume" v={fmt(vol / 1000, 3)} unit="cm³" title={`${fmt(vol, 3)} mm³`} />
      <Row k="Área" v={fmt(area / 100, 3)} unit="cm²" title={`${fmt(area, 3)} mm²`} />
      <Row k="Massa teórica" v={fmt(mass, 3)} unit="kg" />
      <Row k="Caixa (X×Y×Z)" v={dims(box)} unit="mm" />
      {one && <Row k="Centro de massa" v={vec(one.props.centroid, 2)} unit="mm" />}
      {one && <Row k="Topologia" v={`${one.topo.faces} faces · ${one.topo.edges} arestas · ${one.topo.vertices} vértices`} />}
    </section>
  );
}

function TopoPanel({ s, info, model }: { s: Extract<Sel, { t: "topo" }>; info: TopoInfo | null; model: Model3D }) {
  const body = model.nodes[s.body];
  return (
    <div className="p3">
      <section>
        <h4>
          {KIND_LABEL[s.kind]} nº {s.index + 1}
        </h4>
        <Row k="Corpo" v={body?.name ?? "—"} />
        {!info && <div className="note">Consultando a geometria exata…</div>}
        {info?.kind === "face" && (
          <>
            <Row k="Superfície" v={SURF[info.surface] ?? info.surface} />
            <Row k="Área" v={fmt(info.area, 3)} unit="mm²" />
            {info.radius !== undefined && <Row k={info.surface === "torus" ? "Raio maior" : "Raio"} v={fmt(info.radius, 4)} unit="mm" />}
            {info.radius !== undefined && (info.surface === "cylinder" || info.surface === "sphere") && <Row k="Diâmetro" v={fmt(info.radius * 2, 4)} unit="mm" />}
            {info.minorRadius !== undefined && <Row k="Raio menor" v={fmt(info.minorRadius, 4)} unit="mm" />}
            {info.semiAngle !== undefined && <Row k="Semiângulo" v={fmt(info.semiAngle, 4)} unit="°" />}
            {info.normal && <Row k="Normal" v={vec(info.normal, 4)} />}
            {info.axis && <Row k="Eixo" v={vec(info.axis, 4)} />}
            {info.axisPoint && <Row k="Ponto do eixo" v={vec(info.axisPoint)} unit="mm" />}
            <Row k="Centro" v={vec(info.center)} unit="mm" />
          </>
        )}
        {info?.kind === "edge" && (
          <>
            <Row k="Curva" v={CURVE[info.curve] ?? info.curve} />
            <Row k="Comprimento" v={fmt(info.length, 4)} unit="mm" />
            {info.radius !== undefined && <Row k="Raio" v={fmt(info.radius, 4)} unit="mm" />}
            {info.radius !== undefined && <Row k="Diâmetro" v={fmt(info.radius * 2, 4)} unit="mm" />}
            {info.center && <Row k="Centro" v={vec(info.center)} unit="mm" />}
            {info.direction && <Row k="Direção" v={vec(info.direction, 4)} />}
            <Row k={info.closed ? "Ponto" : "Início"} v={vec(info.start)} unit="mm" />
            {!info.closed && <Row k="Fim" v={vec(info.end)} unit="mm" />}
          </>
        )}
        {info?.kind === "vertex" && (
          <>
            <Row k="X" v={fmt(info.point.x, 4)} unit="mm" />
            <Row k="Y" v={fmt(info.point.y, 4)} unit="mm" />
            <Row k="Z" v={fmt(info.point.z, 4)} unit="mm" />
          </>
        )}
      </section>
      <div className="note p3-tip">Valores lidos da geometria B-Rep do OCCT (não da malha de visualização). Ctrl+clique em outro elemento para medir.</div>
    </div>
  );
}

function MeasurePanel({ snap, model }: { snap: Ws3dSnapshot; model: Model3D }) {
  const m = snap.measure;
  const name = (s: Sel) => (s.t === "node" ? (model.nodes[s.id]?.name ?? "?") : `${KIND_LABEL[s.kind]} ${s.index + 1} de ${model.nodes[s.body]?.name ?? "?"}`);
  return (
    <div className="p3">
      <section>
        <h4>Medir</h4>
        {!m && (
          <div className="note">
            {snap.sel.length === 0 && "Clique no primeiro elemento (vértice, aresta, face ou corpo)."}
            {snap.sel.length === 1 && "Clique no segundo elemento."}
            {snap.sel.length === 2 && "Calculando com a geometria exata…"}
          </div>
        )}
        {snap.sel[0] && <Row k="1º" v={name(snap.sel[0])} />}
        {snap.sel[1] && <Row k="2º" v={name(snap.sel[1])} />}
      </section>
      {m && (
        <section className="meas">
          <Row k="Distância mínima" v={<b>{fmt(m.m.distance, 4)}</b>} unit="mm" />
          {m.m.delta && (
            <>
              <Row k="ΔX" v={fmt(m.m.delta.x, 4)} unit="mm" />
              <Row k="ΔY" v={fmt(m.m.delta.y, 4)} unit="mm" />
              <Row k="ΔZ" v={fmt(m.m.delta.z, 4)} unit="mm" />
            </>
          )}
          {m.m.angle !== undefined && <Row k="Ângulo" v={fmt(m.m.angle, 4)} unit="°" />}
          {m.m.planeGap !== undefined && <Row k="Entre planos paralelos" v={fmt(m.m.planeGap, 4)} unit="mm" />}
          {m.m.pa && <Row k="Ponto 1" v={vec(m.m.pa)} unit="mm" />}
          {m.m.pb && <Row k="Ponto 2" v={vec(m.m.pb)} unit="mm" />}
        </section>
      )}
      <div className="note p3-tip">Distância mínima exata calculada pelo OCCT (BRepExtrema). Esc sai do modo medir.</div>
    </div>
  );
}

function Summary({ model, geom }: { model: Model3D; geom: (id: NodeId) => BodyGeom | undefined }) {
  const all = bodies(model);
  return (
    <div className="p3">
      <section>
        <h4>Modelo</h4>
        <Row k="Corpos" v={all.length} />
        <Row k="Conjuntos" v={Object.values(model.nodes).filter((n) => n.kind === "group").length} />
      </section>
      {all.length > 0 && <Physical ids={all.map((b) => b.id)} model={model} geom={geom} />}
      <div className="note p3-tip">Selecione um corpo, face, aresta ou vértice para ver as propriedades exatas.</div>
    </div>
  );
}

function Multi({ sel, model, geom }: { sel: readonly Sel[]; model: Model3D; geom: (id: NodeId) => BodyGeom | undefined }) {
  const nodes = sel.filter((s): s is Extract<Sel, { t: "node" }> => s.t === "node").flatMap((s) => subtree(model, s.id));
  return (
    <div className="p3">
      <section>
        <h4>{sel.length} itens selecionados</h4>
        <div className="note">Ctrl+clique soma/retira itens. Com 2 itens a medição aparece aqui.</div>
      </section>
      {nodes.length > 0 && <Physical ids={[...new Set(nodes)]} model={model} geom={geom} />}
    </div>
  );
}
