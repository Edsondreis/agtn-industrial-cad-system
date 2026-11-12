import { type InitOptions, OcctError, OcctKernel, type ShapeHandle } from "occt-wasm";
import type { SolidKernel } from "./kernel";
import { isIdentity, placementMatrix } from "./placement";
import { type PrimitiveSpec, type Pt2, profileSection, validatePrimitive } from "./primitives";
import {
  type EdgeBuffers,
  type EdgeInfo,
  type FaceInfo,
  type MassProps,
  type Measurement,
  type StepNode,
  type TopoInfo,
  type TopoKind,
  type TopoSel,
  type Vec3,
  type MeshBuffers,
  type Placement,
  QUALITY_VIEW,
  type ShapeKind,
  SolidError,
  type SolidRef,
  type TessellationQuality,
  type TopoRange,
} from "./types";

const H = (r: SolidRef) => r as unknown as ShapeHandle;
const R = (h: ShapeHandle) => h as unknown as SolidRef;

/** Traduz falhas do OCCT para mensagens do AGTN. */
function wrap(op: string, e: unknown): SolidError {
  if (e instanceof SolidError) return e;
  if (e instanceof OcctError) {
    if (e.code === "BOOLEAN_FAILED") return new SolidError("BOOLEAN", `Operação booleana falhou (${op}). Verifique se os sólidos se tocam e são válidos.`, [e.message]);
    if (e.code === "IMPORT_EXPORT_FAILED") return new SolidError("IO", `Falha ao ler/gravar o arquivo (${op}).`, [e.message]);
    return new SolidError("KERNEL", `O motor geométrico não conseguiu executar "${op}".`, [e.message]);
  }
  return new SolidError("KERNEL", `Erro inesperado em "${op}".`, [String((e as Error)?.message ?? e)]);
}

/**
 * Implementação do `SolidKernel` sobre OCCT 8 (occt-wasm). Roda igual em Node (testes), no WebView e em Web Worker.
 * O `.wasm` é carregado de um arquivo separado (exigência da LGPL: o usuário pode substituí-lo).
 */
export class OcctSolidKernel implements SolidKernel {
  readonly name = "OCCT 8 (WebAssembly)";
  /** sub-shapes por corpo, na ordem de exploração do OCCT (mesma ordem da malha/arestas) */
  private readonly subs = new Map<number, Partial<Record<TopoKind, ShapeHandle[]>>>();
  private constructor(private readonly k: OcctKernel) {}

  /** Acesso ao módulo WASM (diagnóstico de memória). */
  get wasmMemoryBytes(): number {
    const mod = this.k.getRawModule() as unknown as { HEAP8?: Int8Array; wasmMemory?: WebAssembly.Memory };
    return mod.wasmMemory?.buffer.byteLength ?? mod.HEAP8?.buffer.byteLength ?? 0;
  }
  get liveShapes(): number {
    return this.k.shapeCount;
  }

  private sub(ref: SolidRef, kind: TopoKind): ShapeHandle[] {
    let c = this.subs.get(ref);
    if (!c) this.subs.set(ref, (c = {}));
    let list = c[kind];
    if (!list) list = c[kind] = this.k.getSubShapes(H(ref), kind);
    return list;
  }
  private subAt(ref: SolidRef, kind: TopoKind, index: number): ShapeHandle {
    const list = this.sub(ref, kind);
    if (!Number.isInteger(index) || index < 0 || index >= list.length)
      throw new SolidError("INVALID_PARAMS", `Elemento ${kind} nº ${index} não existe neste corpo (há ${list.length}).`);
    return list[index];
  }

  static async create(opts?: InitOptions): Promise<OcctSolidKernel> {
    try {
      return new OcctSolidKernel(await OcctKernel.init(opts));
    } catch (e) {
      throw new SolidError("NOT_READY", "Não foi possível iniciar o motor 3D (OCCT).", [String((e as Error)?.message ?? e)]);
    }
  }

  /** Executa `fn`, libera os temporários e traduz erros. */
  private run<T>(op: string, fn: (tmp: ShapeHandle[]) => T): T {
    const tmp: ShapeHandle[] = [];
    try {
      return fn(tmp);
    } catch (e) {
      throw wrap(op, e);
    } finally {
      for (const t of tmp) {
        try {
          this.k.release(t);
        } catch {
          /* já liberado */
        }
      }
    }
  }

  primitive(spec: PrimitiveSpec, placement?: Placement): SolidRef {
    const errs = validatePrimitive(spec);
    if (errs.length) throw new SolidError("INVALID_PARAMS", errs[0], errs);
    return this.run(`criar ${spec.kind}`, (tmp) => {
      const raw = this.buildRaw(spec, tmp);
      if (!placement || isIdentity(placement)) return R(raw);
      tmp.push(raw);
      return R(this.k.transform(raw, placementMatrix(placement)));
    });
  }

  private buildRaw(s: PrimitiveSpec, tmp: ShapeHandle[]): ShapeHandle {
    const k = this.k;
    switch (s.kind) {
      case "box":
        return k.makeBox(s.w, s.d, s.h);
      case "cylinder":
        return k.makeCylinder(s.r, s.h);
      case "sphere":
        return k.makeSphere(s.r);
      case "cone":
        return k.makeCone(s.r1, s.r2, s.h);
      case "torus":
        return k.makeTorus(s.R, s.r);
      case "plane":
        return k.makeRectangle(s.w, s.d);
      case "tube": {
        const outer = k.makeCylinder(s.od / 2, s.h);
        const inner = k.makeCylinder(s.od / 2 - s.t, s.h);
        tmp.push(outer, inner);
        return this.single(k.cut(outer, inner), tmp);
      }
      case "profile": {
        const sec = profileSection(s.profile);
        const outer = this.prism(sec.outer, s.length, tmp);
        if (!sec.hole) return outer;
        tmp.push(outer);
        const hole = this.prism(sec.hole, s.length, tmp);
        tmp.push(hole);
        return this.single(k.cut(outer, hole), tmp);
      }
    }
  }

  /** Polígono no plano XY extrudado em +Z. */
  private prism(pts: readonly Pt2[], length: number, tmp: ShapeHandle[]): ShapeHandle {
    const k = this.k;
    const edges = pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return k.makeLineEdge({ x: p.x, y: p.y, z: 0 }, { x: q.x, y: q.y, z: 0 });
    });
    tmp.push(...edges);
    const wire = k.makeWire(edges);
    tmp.push(wire);
    const face = k.makeFace(wire);
    tmp.push(face);
    return k.extrude(face, 0, 0, length);
  }

  /** Booleanas do OCCT devolvem compostos; um composto com um único sólido (e nada mais) vira o próprio sólido. */
  private single(h: ShapeHandle, tmp: ShapeHandle[]): ShapeHandle {
    if (this.k.getShapeType(h) !== "compound") return h;
    const solids = this.k.getSubShapes(h, "solid");
    const faces = this.k.getSubShapes(h, "face");
    const ownFaces = solids.length === 1 ? this.k.getSubShapes(solids[0], "face").length : -1;
    tmp.push(...faces);
    if (solids.length === 1 && ownFaces === faces.length) {
      tmp.push(h);
      return solids[0];
    }
    tmp.push(...solids);
    return h;
  }

  place(ref: SolidRef, placement: Placement): SolidRef {
    return this.run("posicionar", () => R(this.k.transform(H(ref), placementMatrix(placement))));
  }
  copy(ref: SolidRef): SolidRef {
    return this.run("copiar", () => R(this.k.copy(H(ref))));
  }

  fuse(a: SolidRef, b: SolidRef): SolidRef {
    return this.run("união", (tmp) => R(this.single(this.k.fuse(H(a), H(b)), tmp)));
  }
  cut(a: SolidRef, b: SolidRef): SolidRef {
    return this.run("corte", (tmp) => R(this.single(this.k.cut(H(a), H(b)), tmp)));
  }
  common(a: SolidRef, b: SolidRef): SolidRef {
    return this.run("interseção", (tmp) => R(this.single(this.k.common(H(a), H(b)), tmp)));
  }

  kind(ref: SolidRef): ShapeKind {
    return this.run("tipo", () => this.k.getShapeType(H(ref)) as ShapeKind);
  }
  isValid(ref: SolidRef): boolean {
    try {
      return this.k.isValid(H(ref));
    } catch {
      return false;
    }
  }

  props(ref: SolidRef): MassProps {
    return this.run("propriedades", () => {
      const h = H(ref);
      const b = this.k.getBoundingBox(h);
      const kind = this.k.getShapeType(h);
      const hasVolume = kind === "solid" || kind === "compsolid" || kind === "compound";
      const c = this.k.getCenterOfMass(h);
      return {
        volume: hasVolume ? this.k.getVolume(h) : 0,
        area: this.k.getSurfaceArea(h),
        centroid: { x: c.x, y: c.y, z: c.z },
        bbox: { min: { x: b.xmin, y: b.ymin, z: b.zmin }, max: { x: b.xmax, y: b.ymax, z: b.zmax } },
      };
    });
  }

  topology(ref: SolidRef) {
    return this.run("topologia", () => {
      const h = H(ref);
      const count = (t: "solid" | "face" | "edge" | "vertex") => {
        const subs = this.k.getSubShapes(h, t);
        const n = subs.length;
        for (const s of subs) this.k.release(s);
        return n;
      };
      return { solids: count("solid"), faces: count("face"), edges: count("edge"), vertices: count("vertex") };
    });
  }

  mesh(ref: SolidRef, q: TessellationQuality = QUALITY_VIEW): MeshBuffers {
    return this.run("malha", () => {
      const m = this.k.meshShape(H(ref), { linearDeflection: q.linear, angularDeflection: q.angular });
      const faces: TopoRange[] = [];
      const g = m.faceGroups;
      // o OCCT devolve início/quantidade em ÍNDICES; normalizamos para triângulos
      if (g) for (let i = 0; i + 2 < g.length; i += 3) faces.push({ start: g[i] / 3, count: g[i + 1] / 3, id: g[i + 2] });
      return { positions: m.positions, normals: m.normals, indices: m.indices, faces };
    });
  }

  edges(ref: SolidRef, q: TessellationQuality = QUALITY_VIEW): EdgeBuffers {
    return this.run("arestas", () => {
      const d = this.k.wireframe(H(ref), { deflection: q.linear });
      const edges: TopoRange[] = [];
      const g = d.edgeGroups;
      // o OCCT devolve início/quantidade em floats (XYZ); normalizamos para pontos
      for (let i = 0; i + 2 < g.length; i += 3) edges.push({ start: g[i] / 3, count: g[i + 1] / 3, id: g[i + 2] });
      return { points: d.points, edges };
    });
  }

  toStep(ref: SolidRef): string {
    return this.run("exportar STEP", () => this.k.exportStep(H(ref), { unit: "mm" }));
  }
  fromStep(data: string | Uint8Array): SolidRef {
    return this.run("importar STEP", () => {
      const input = typeof data === "string" ? data : data.slice().buffer;
      return R(this.k.importStep(input));
    });
  }
  toBrep(ref: SolidRef): Uint8Array {
    return this.run("gravar BREP", () => this.k.toBREPBinary(H(ref)));
  }
  fromBrep(data: Uint8Array): SolidRef {
    return this.run("ler BREP", () => R(this.k.fromBREPBinary(data)));
  }

  transform(ref: SolidRef, matrix: readonly number[]): SolidRef {
    if (matrix.length !== 12 || !matrix.every(Number.isFinite)) throw new SolidError("INVALID_PARAMS", "Matriz de posicionamento inválida.");
    return this.run("posicionar", () => R(this.k.transform(H(ref), [...matrix])));
  }

  count(ref: SolidRef, kind: TopoKind): number {
    return this.run("contar", () => this.sub(ref, kind).length);
  }

  info(ref: SolidRef, kind: TopoKind, index: number): TopoInfo {
    return this.run("consultar geometria", () => {
      const h = this.subAt(ref, kind, index);
      if (kind === "vertex") return { kind: "vertex", point: vec(this.k.vertexPosition(h)) };
      if (kind === "face") return this.faceInfo(h);
      return this.edgeInfo(h);
    });
  }

  private faceInfo(f: ShapeHandle): FaceInfo {
    const k = this.k;
    const base = { kind: "face" as const, surface: String(k.surfaceType(f)), area: k.getSurfaceArea(f), center: vec(k.getSurfaceCenterOfMass(f)) };
    const d = k.surfaceData(f) as unknown as Record<string, unknown>;
    switch (d.kind) {
      case "plane":
        return { ...base, normal: vec(d.normal as Vec3) };
      case "cylinder":
        return { ...base, axis: vec(d.axis as Vec3), axisPoint: vec(d.location as Vec3), radius: d.radius as number };
      case "cone":
        return { ...base, axis: vec(d.axis as Vec3), axisPoint: vec(d.location as Vec3), radius: d.refRadius as number, semiAngle: ((d.semiAngle as number) * 180) / Math.PI };
      case "sphere":
        return { ...base, axisPoint: vec(d.location as Vec3), radius: d.radius as number };
      case "torus":
        return { ...base, axis: vec(d.axis as Vec3), axisPoint: vec(d.location as Vec3), radius: d.majorRadius as number, minorRadius: d.minorRadius as number };
      default:
        return base;
    }
  }

  private edgeInfo(e: ShapeHandle): EdgeInfo {
    const k = this.k;
    const vs = k.getSubShapes(e, "vertex");
    const pts = vs.map((v) => vec(k.vertexPosition(v)));
    for (const v of vs) k.release(v);
    const d = k.curveData(e) as unknown as Record<string, unknown>;
    const start = pts[0] ?? { x: NaN, y: NaN, z: NaN };
    const end = pts[pts.length - 1] ?? start;
    const base = { kind: "edge" as const, curve: String(d.kind ?? k.curveType(e)), length: k.curveLength(e), start, end, closed: k.curveIsClosed(e) };
    if (d.kind === "line") return { ...base, direction: vec(d.direction as Vec3) };
    if (d.kind === "circle") return { ...base, center: vec(d.center as Vec3), radius: d.radius as number, axis: vec(d.axis as Vec3) };
    return base;
  }

  vertexPoints(ref: SolidRef): Float64Array {
    return this.run("vértices", () => {
      const list = this.sub(ref, "vertex");
      const out = new Float64Array(list.length * 3);
      list.forEach((v, i) => {
        const p = this.k.vertexPosition(v);
        out[i * 3] = p.x;
        out[i * 3 + 1] = p.y;
        out[i * 3 + 2] = p.z;
      });
      return out;
    });
  }

  measure(a: TopoSel, b: TopoSel): Measurement {
    return this.run("medir", () => {
      const ha = a.kind === "solid" ? H(a.ref) : this.subAt(a.ref, a.kind, a.index);
      const hb = b.kind === "solid" ? H(b.ref) : this.subAt(b.ref, b.kind, b.index);
      const distance = this.k.distanceBetween(ha, hb);
      const ia = a.kind === "solid" ? null : this.info(a.ref, a.kind, a.index);
      const ib = b.kind === "solid" ? null : this.info(b.ref, b.kind, b.index);
      let pa: Vec3 | undefined;
      let pb: Vec3 | undefined;
      // pontos exatos: vértice × (vértice | aresta | face), conferidos contra a distância do kernel
      const proj = (pv: Vec3, sel: TopoSel, h: ShapeHandle): Vec3 | undefined => {
        if (sel.kind === "vertex") return this.k.vertexPosition(h);
        if (sel.kind === "edge") return this.k.projectPointOnEdge(h, pv).point;
        if (sel.kind === "face") return this.k.projectPointOnFace(h, pv);
        return undefined;
      };
      if (ia?.kind === "vertex") {
        pa = ia.point;
        pb = proj(pa, b, hb);
      } else if (ib?.kind === "vertex") {
        pb = ib.point;
        pa = proj(pb, a, ha);
      }
      if (pa && pb && Math.abs(dist3(pa, pb) - distance) > 1e-6 * Math.max(1, distance)) {
        pa = undefined; // projeção caiu fora do limite do elemento: só a distância é exata
        pb = undefined;
      }
      const m: { -readonly [K in keyof Measurement]: Measurement[K] } = { distance };
      if (pa && pb) {
        m.pa = vec(pa);
        m.pb = vec(pb);
        m.delta = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z };
      }
      const dirOf = (i: TopoInfo | null): { v: Vec3; line: boolean } | null =>
        i?.kind === "face" && i.normal ? { v: i.normal, line: false } : i?.kind === "edge" && i.direction ? { v: i.direction, line: true } : null;
      const da = dirOf(ia);
      const db = dirOf(ib);
      if (da && db) {
        const c = Math.min(1, Math.abs(dot(unit(da.v), unit(db.v))));
        let ang = (Math.acos(c) * 180) / Math.PI; // 0..90 entre direções
        if (da.line !== db.line) ang = 90 - ang; // reta × plano: ângulo com o plano
        m.angle = ang;
        if (!da.line && !db.line && ia?.kind === "face" && ib?.kind === "face" && c > 1 - 1e-12)
          m.planeGap = Math.abs(dot(unit(da.v), { x: ib.center.x - ia.center.x, y: ib.center.y - ia.center.y, z: ib.center.z - ia.center.z }));
      }
      return m;
    });
  }

  importStepTree(data: string): StepNode[] {
    return this.run("importar STEP", () => {
      const doc = this.k.importXCAFFromSTEP(data);
      try {
        const walk = (label: number, depth: number): StepNode | null => {
          if (depth > 64) return null;
          const info = doc.getLabelInfo(label as never);
          let proto = label;
          let matrix: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
          const real = (nm: string) => (/^=>\[[\d:]+\]$/.test(nm) ? "" : nm); // nome automático do OCCT
          let name = real(info.name);
          let pinfo = info;
          if (info.isComponent) {
            const r = doc.getReferredLabel(label as never);
            if (r !== null) {
              proto = r as unknown as number;
              matrix = doc.getLocation(label as never);
              if (info.shapeHandle !== null) this.k.release(info.shapeHandle);
              pinfo = doc.getLabelInfo(r);
              name = name || real(pinfo.name);
            }
          }
          const color = pinfo.hasColor ? ([pinfo.color[0], pinfo.color[1], pinfo.color[2]] as const) : undefined;
          if (pinfo.isAssembly) {
            if (pinfo.shapeHandle !== null) this.k.release(pinfo.shapeHandle);
            const children = doc.getChildren(proto as never).map((c) => walk(c as unknown as number, depth + 1)).filter((c): c is StepNode => !!c);
            return { name: name || "Conjunto", matrix, children };
          }
          if (pinfo.shapeHandle === null) return null;
          const brep = this.k.toBREPBinary(pinfo.shapeHandle);
          this.k.release(pinfo.shapeHandle);
          return { name: name || "Corpo", matrix, brep, color };
        };
        const roots = doc.getRoots().map((r) => walk(r as unknown as number, 0)).filter((n): n is StepNode => !!n);
        if (!roots.length) throw new SolidError("IO", "O arquivo STEP não contém geometria.");
        return roots;
      } finally {
        doc.close();
      }
    });
  }

  exportStepTree(nodes: readonly StepNode[]): string {
    return this.run("exportar STEP", (tmp) => {
      const build = (n: StepNode): ShapeHandle => {
        let local: ShapeHandle;
        if (n.brep) local = this.k.fromBREPBinary(n.brep);
        else local = this.k.makeCompound((n.children ?? []).map(build));
        tmp.push(local);
        const placed = this.k.transform(local, [...n.matrix]);
        tmp.push(placed);
        return placed;
      };
      const doc = this.k.createXCAFDocument();
      try {
        if (nodes.length === 1 && nodes[0].brep) {
          doc.addShape(build(nodes[0]), { name: nodes[0].name });
        } else {
          const shapes = nodes.map(build);
          const root = this.k.makeCompound(shapes);
          tmp.push(root);
          const tag = doc.addShape(root, { assembly: true, name: "AGTN" });
          // nomeia componentes e protótipos em todos os níveis (compostos aninhados viram subconjuntos)
          const nameAll = (labels: ReturnType<typeof doc.getChildren>, list: readonly StepNode[]) => {
            labels.forEach((c, i) => {
              const n = list[i];
              if (!n) return;
              doc.setName(c, n.name);
              const r = doc.getReferredLabel(c);
              if (r === null) return;
              doc.setName(r, n.name);
              if (n.children?.length) nameAll(doc.getChildren(r), n.children);
            });
          };
          nameAll(doc.getChildren(tag), nodes);
        }
        return doc.exportSTEP({ unit: "mm" });
      } finally {
        doc.close();
      }
    });
  }

  toStl(ref: SolidRef, deflection = 0.05): Uint8Array {
    return this.run("exportar STL", () => this.k.exportStl(H(ref), deflection, false));
  }

  release(ref: SolidRef): void {
    const c = this.subs.get(ref);
    if (c) {
      for (const list of Object.values(c)) for (const h of list ?? []) this.release(h as unknown as SolidRef);
      this.subs.delete(ref);
    }
    try {
      this.k.release(H(ref));
    } catch {
      /* já liberado */
    }
  }
  dispose(): void {
    this.subs.clear();
    this.k[Symbol.dispose]();
  }
}

const vec = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: p.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
