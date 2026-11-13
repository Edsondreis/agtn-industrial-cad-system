import { loadPrefs } from "../../app/prefs";
import { type BodyNode, type Model3D, type NodeId, worldMatrix } from "@agtn/model3d";
import { type Sketch, defaultRegions, profiles } from "@agtn/sketch";
import { type FeatId, type Feature, type FeatureDraft, type FeatureKind, type Frame, type PlaneRef, type StdPlane, STD_FRAMES, applyMatrix } from "@agtn/solid";

export type PartSource = Extract<BodyNode["source"], { type: "part" }>;

export const isPart = (m: Model3D, id: NodeId | null | undefined): id is NodeId => {
  const n = id ? m.nodes[id] : undefined;
  return !!n && n.kind === "body" && n.source.type === "part";
};
export const partSrc = (m: Model3D, id: NodeId): PartSource | null => {
  const n = m.nodes[id];
  return n?.kind === "body" && n.source.type === "part" ? n.source : null;
};

/** Plano local → mundo (posicionamento do corpo). */
export function worldFrame(m: Model3D, body: NodeId | null, f: Frame): Frame {
  if (!body || !m.nodes[body]) return f;
  const w = worldMatrix(m, body);
  const o = applyMatrix(w, f.o);
  const dir = (d: Frame["x"]) => {
    const p = applyMatrix(w, { x: f.o.x + d.x, y: f.o.y + d.y, z: f.o.z + d.z });
    return { x: p.x - o.x, y: p.y - o.y, z: p.z - o.z };
  };
  return { o, x: dir(f.x), y: dir(f.y), n: dir(f.n) };
}

export function stdFrame(plane: StdPlane, offset: number): Frame {
  const f = STD_FRAMES[plane];
  return { ...f, o: { x: f.n.x * offset, y: f.n.y * offset, z: f.n.z * offset } };
}

export const PLANE_LABEL: Record<StdPlane, string> = { XY: "Plano XY (superior)", XZ: "Plano XZ (frontal)", YZ: "Plano YZ (lateral)" };
export const planeText = (p: PlaneRef) => (p.t === "std" ? `${p.plane}${p.offset ? ` + ${p.offset} mm` : ""}` : `Face plana${p.offset ? ` + ${p.offset} mm` : ""}`);

export const FEATURE_ICON: Record<FeatureKind, string> = {
  primitive: "cube3d",
  sketch: "sketch3d",
  extrude: "extrude3d",
  revolve: "revolve3d",
  sweep: "sweep3d",
  loft: "loft3d",
  fillet: "fillet3d",
  chamfer: "chamfer3d",
  shell: "shell3d",
  hole: "hole3d",
  mirror: "mirror3d",
  pattern: "patlin3d",
  combine: "union3d",
  sheetBase: "sheetBase3d",
  sheetFlange: "sheetFlange3d",
  sheetContour: "sheetContour3d",
  sheetBendLine: "sheetBend3d",
  sheetCut: "sheetCut3d",
  sheetRelief: "sheetRelief3d",
  sheetCorner: "sheetCorner3d",
  sheetFlatCut: "sheetCut3d",
};
export const featureIcon = (f: Feature) =>
  f.t === "pattern" && f.kind === "circular" ? "patcir3d" : f.t === "combine" ? (f.op === "cut" ? "cut3d" : f.op === "intersect" ? "intersect3d" : "union3d") : FEATURE_ICON[f.t];

const n = (v: number) => String(Number(v.toFixed(3))).replace(".", ",");
const OP = { new: "novo", join: "unir", cut: "cortar", intersect: "interseção" } as const;

/** Resumo curto dos parâmetros (árvore e propriedades). */
export function featureSummary(f: Feature): string {
  switch (f.t) {
    case "primitive":
      return f.spec.kind;
    case "sketch": {
      const ents = Object.values(f.sketch.entities).length;
      return `${planeText(f.plane)} · ${ents} entidade(s)`;
    }
    case "extrude":
      return f.through ? `passante · ${OP[f.op]}` : `${n(f.depth)} mm${f.mode === "symmetric" ? " simétrica" : f.mode === "two" ? ` + ${n(f.depth2)} mm` : ""} · ${OP[f.op]}`;
    case "revolve":
      return `${n(f.angle)}° · ${OP[f.op]}`;
    case "sweep":
    case "loft":
      return OP[f.op];
    case "fillet":
      return `R ${n(f.r)} · ${f.edges.length} aresta(s)`;
    case "chamfer":
      return `${n(f.d)} mm · ${f.edges.length} aresta(s)`;
    case "shell":
      return `parede ${n(f.thickness)} mm · ${f.faces.length} face(s) aberta(s)`;
    case "hole":
      return `Ø${n(f.d)} ${f.through ? "passante" : `× ${n(f.depth)}`}${f.cbore ? " · rebaixo" : ""}${f.csink ? " · escareado" : ""}`;
    case "mirror":
      return `${planeText(f.plane)} · ${f.targets ? `${f.targets.length} operação(ões)` : "corpo inteiro"}`;
    case "pattern":
      return f.kind === "linear" ? `${f.count} × ${n(f.spacing)} mm` : `${f.count} × ${n(f.angle)}°`;
    case "combine":
      return `${OP[f.op]} · ${f.tools.length} corpo(s)`;
    case "sheetBase":
      return `T ${n(f.T)} · R ${n(f.R)} · K ${f.K === null ? "tabela" : n(f.K)}`;
    case "sheetFlange":
      return `${n(f.length)} mm · θ ${n(f.deflectionDeg)}° (α ${n(180 - f.deflectionDeg)}°) · ${f.edges.length} aresta(s)${f.position && f.position !== "dentro" ? ` · material ${f.position === "fora" ? "por fora" : "dobra por fora"}` : ""}${(f.offsetStart ?? 0) + (f.offsetEnd ?? 0) > 0 ? ` · recuos ${n(f.offsetStart ?? 0)}/${n(f.offsetEnd ?? 0)}` : ""}`;
    case "sheetContour":
      return `${f.segments.length} segmento(s) · ${f.ref}`;
    case "sheetBendLine":
      return `θ ${n(f.deflectionDeg)}° (α ${n(180 - f.deflectionDeg)}°) · ${f.side}`;
    case "sheetCut":
      return "passante";
    case "sheetFlatCut":
      return "na planificação · atravessa dobras";
    case "sheetCorner":
      return `${{ aberto: "aberto", sobreposto: "sobreposto", encosto: "encosto", esquadria: "esquadria" }[f.kind]} · g ${n(f.gap)} · ${f.corners.length} canto(s)`;
    case "sheetRelief":
      return `${{ retangular: "retangular", oblongo: "oblongo", lagrima: "lágrima" }[f.kind]} · ${f.width === null ? "automático" : `w ${n(f.width)}`} · g ${n(f.gap)} · ${f.bends.length} dobra(s)`;
  }
}

/** Esboços disponíveis antes da posição `at`. */
export const sketchesBefore = (features: readonly Feature[], at: number) => features.slice(0, at).filter((f): f is Extract<Feature, { t: "sketch" }> => f.t === "sketch");
/** Operações que produzem/alteram sólido antes de `at` (alvos de padrão/espelho). */
export const solidFeaturesBefore = (features: readonly Feature[], at: number) => features.slice(0, at).filter((f) => f.t !== "sketch" && !f.suppressed);

/** Há sólido antes desta posição? (define o padrão "Unir" × "Novo sólido") */
export const hasSolidBefore = (features: readonly Feature[], at: number) => features.slice(0, at).some((f) => !f.suppressed && f.t !== "sketch");

export interface RegionInfo {
  index: number;
  area: number;
  holes: number;
  isDefault: boolean;
  /** ponto interno (para o manipulador) */
  interior: { x: number; y: number };
}
export function regionsOf(s: Sketch): { regions: RegionInfo[]; open: number } {
  const p = profiles(s);
  const def = new Set(defaultRegions(p));
  return { regions: p.regions.map((r) => ({ index: r.index, area: r.area, holes: r.holes.length, isDefault: def.has(r.index), interior: r.interior })), open: p.openEnds.length };
}

/** Linhas do esboço que servem de eixo (inclui os eixos X/Y do esboço). */
export function axisLines(s: Sketch): { id: string; label: string }[] {
  const out = [
    { id: "AX", label: "Eixo X do esboço" },
    { id: "AY", label: "Eixo Y do esboço" },
  ];
  for (const e of Object.values(s.entities)) if (e.t === "line") out.push({ id: e.id, label: `Linha ${e.id}${e.cons ? " (construção)" : ""}` });
  return out;
}

/** Rascunho inicial de cada operação (valores práticos para chapa/caldeiraria em mm). */
export function defaultDraft(kind: FeatureKind, features: readonly Feature[], at: number, opts: { sketch?: FeatId; op?: "join" | "cut" | "intersect" } = {}): FeatureDraft | null {
  const sks = sketchesBefore(features, at);
  const sk = opts.sketch ?? sks.at(-1)?.id ?? "";
  const solid = hasSolidBefore(features, at);
  const op = solid ? "join" : "new";
  switch (kind) {
    case "extrude":
      return { t: "extrude", sketch: sk, regions: null, depth: 10, mode: "one", depth2: 10, reverse: false, through: false, op };
    case "revolve":
      return { t: "revolve", sketch: sk, regions: null, axis: "AY", angle: 360, op };
    case "sweep":
      return { t: "sweep", profile: sks.at(-2)?.id ?? sk, path: sk, op };
    case "loft":
      return { t: "loft", sections: sks.slice(-2).map((s) => s.id), ruled: false, op };
    case "fillet":
      return { t: "fillet", edges: [], r: 2 };
    case "chamfer":
      return { t: "chamfer", edges: [], d: 1 };
    case "shell":
      return { t: "shell", faces: [], thickness: 2 };
    case "hole":
      return { t: "hole", sketch: sk, d: 8.5, depth: 10, through: true, reverse: false, cbore: null, csink: null };
    case "mirror":
      return { t: "mirror", plane: { t: "std", plane: "YZ", offset: 0 }, targets: null };
    case "pattern":
      return { t: "pattern", kind: "linear", targets: solidFeaturesBefore(features, at).filter((f) => ["extrude", "revolve", "sweep", "loft", "hole"].includes(f.t)).slice(-1).map((f) => f.id), dir: { t: "axis", a: "X" }, count: 3, spacing: 20, angle: 360, reverse: false };
    case "combine":
      return { t: "combine", op: opts.op ?? "join", tools: [] };
    /* chapa: padrões AGTN (medida até o vértice virtual externo; K da tabela material × processo) */
    case "sheetBase":
      return { t: "sheetBase", sketch: sk, T: 2, R: 2, K: null, material: "aco_carbono", process: "ar", ref: "externa", side: "cima" };
    case "sheetFlange":
      return { t: "sheetFlange", edges: [], length: 30, deflectionDeg: 90, R: null, K: null, side: "cima", ref: "externa" };
    case "sheetContour":
      return {
        t: "sheetContour",
        edge: { flange: "", edge: "" },
        ref: "externa",
        segments: [
          { id: "s1", length: 30, deflectionDeg: 90, side: "cima", R: null, K: null },
          { id: "s2", length: 15, deflectionDeg: 90, side: "cima", R: null, K: null },
        ],
      };
    case "sheetBendLine": {
      const s = sks.find((x) => x.id === sk);
      const line = s ? (Object.values(s.sketch.entities).find((e) => e.t === "line" && !e.cons)?.id ?? "") : "";
      return { t: "sheetBendLine", sketch: sk, line, flange: sheetBaseBefore(features, at) ?? "", deflectionDeg: 90, R: null, K: null, side: "cima", ref: "externa", fixed: "esq" };
    }
    case "sheetCut":
      return { t: "sheetCut", sketch: sk, flange: sheetBaseBefore(features, at) ?? "" };
    case "sheetFlatCut":
      return { t: "sheetFlatCut", sketch: sk };
    case "sheetRelief":
      return { t: "sheetRelief", bends: [], kind: "retangular", gap: loadPrefs().reliefGap, width: null, depth: null };
    case "sheetCorner":
      return { t: "sheetCorner", corners: [], kind: "sobreposto", gap: loadPrefs().reliefGap, closer: "a", relief: "retangular" };
    default:
      return null;
  }
}

/** Operações que dependem de escolher arestas/faces no modelo. */
export const PICKS: Partial<Record<FeatureKind, "edge" | "face">> = { fillet: "edge", chamfer: "edge", shell: "face", sheetFlange: "edge", sheetContour: "edge" };

/** Base de chapa antes da posição (id da operação = id da aba-base). */
export const sheetBaseBefore = (features: readonly Feature[], at: number): FeatId | null => features.slice(0, at).find((f) => f.t === "sheetBase" && !f.suppressed)?.id ?? null;

export const DRAFT_ID = "__draft";
/** Lista de operações com o rascunho inserido/substituído — para a prévia. */
export function withDraft(features: readonly Feature[], at: number, editing: FeatId | null, draft: FeatureDraft, name: string): Feature[] {
  const f = { ...(draft as object), id: editing ?? DRAFT_ID, name } as Feature;
  if (editing) return features.map((x) => (x.id === editing ? { ...f, suppressed: x.suppressed } : x));
  return [...features.slice(0, at), f, ...features.slice(at)];
}
