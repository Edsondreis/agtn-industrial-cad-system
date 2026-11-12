import { type InitOptions, OcctError, OcctKernel, type ShapeHandle } from "occt-wasm";
import type { SolidKernel } from "./kernel";
import { isIdentity, placementMatrix } from "./placement";
import { type PrimitiveSpec, type Pt2, profileSection, validatePrimitive } from "./primitives";
import {
  type EdgeBuffers,
  type MassProps,
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
  private constructor(private readonly k: OcctKernel) {}

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

  release(ref: SolidRef): void {
    try {
      this.k.release(H(ref));
    } catch {
      /* já liberado */
    }
  }
  dispose(): void {
    this.k[Symbol.dispose]();
  }
}
