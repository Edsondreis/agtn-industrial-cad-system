import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Sphere,
  Vector3,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type { BodyGeom } from "./protocol";
import type { DisplayMode } from "./store";

export const ACCENT = new Color("#4b93ea");
export const HOVER = new Color("#8cc2ff");
const EDGE_DARK = new Color("#11151a");
const EDGE_WIRE = new Color("#b9c4d0");

/** Faixa [início, quantidade] de um elemento: busca binária pelo triângulo/segmento. */
export function rangeIndexOf(ranges: Int32Array, item: number): number {
  let lo = 0;
  let hi = ranges.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = ranges[mid * 2];
    if (item < s) hi = mid - 1;
    else if (item >= s + ranges[mid * 2 + 1]) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Representação visual de um corpo: malha sombreada, arestas (com mapa segmento → aresta topológica) e
 * os dados exatos do OCCT (faixas por face/aresta, vértices). Destaques são criados sob demanda.
 */
export class BodyVisual {
  readonly root = new Group();
  readonly mesh: Mesh;
  readonly edges: LineSegments;
  /** segmento i das arestas → índice da aresta topológica */
  readonly segEdge: Int32Array;
  readonly sphere: Sphere;
  private readonly meshMat: MeshPhongMaterial;
  private readonly edgeMat: LineBasicMaterial;
  private base = new Color("#9aa7b6");
  private bodySelected = false;
  private bodyHover = false;
  private mode: DisplayMode = "sombreado-arestas";

  constructor(readonly geom: BodyGeom) {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(geom.positions, 3));
    g.setAttribute("normal", new BufferAttribute(geom.normals, 3));
    g.setIndex(new BufferAttribute(geom.indices, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    this.meshMat = new MeshPhongMaterial({
      color: this.base,
      shininess: 38,
      specular: new Color("#3a3f46"),
      side: DoubleSide, // superfícies abertas (plano, STEP com cascas) também aparecem
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.mesh = new Mesh(g, this.meshMat);
    this.mesh.userData.body = geom.id;

    // arestas: polilinhas → segmentos
    let segs = 0;
    for (let i = 0; i < geom.edges.length; i += 2) segs += Math.max(0, geom.edges[i + 1] - 1);
    const pos = new Float32Array(segs * 6);
    this.segEdge = new Int32Array(segs);
    let s = 0;
    for (let e = 0; e < geom.edges.length / 2; e++) {
      const start = geom.edges[e * 2];
      const n = geom.edges[e * 2 + 1];
      for (let k = 0; k < n - 1; k++) {
        const a = (start + k) * 3;
        const b = (start + k + 1) * 3;
        pos.set(geom.edgePoints.subarray(a, a + 3), s * 6);
        pos.set(geom.edgePoints.subarray(b, b + 3), s * 6 + 3);
        this.segEdge[s++] = e;
      }
    }
    const eg = new BufferGeometry();
    eg.setAttribute("position", new BufferAttribute(pos, 3));
    eg.computeBoundingSphere();
    this.edgeMat = new LineBasicMaterial({ color: EDGE_DARK, transparent: true, opacity: 0.85 });
    this.edges = new LineSegments(eg, this.edgeMat);
    this.edges.userData.body = geom.id;
    this.root.add(this.mesh, this.edges);
    this.sphere = g.boundingSphere ? g.boundingSphere.clone() : new Sphere(new Vector3(), 1);
    if (geom.positions.length === 0 && pos.length) this.sphere.copy(eg.boundingSphere!);
  }

  get id() {
    return this.geom.id;
  }

  setColor(hex: string) {
    this.base.set(hex);
    this.refreshColors();
  }
  setState(selected: boolean, hover: boolean) {
    if (selected === this.bodySelected && hover === this.bodyHover) return;
    this.bodySelected = selected;
    this.bodyHover = hover;
    this.refreshColors();
  }
  private refreshColors() {
    const c = this.base.clone();
    if (this.bodySelected) c.lerp(ACCENT, 0.55);
    else if (this.bodyHover) c.lerp(HOVER, 0.3);
    this.meshMat.color.copy(c);
    this.meshMat.emissive.copy(this.bodySelected ? ACCENT : new Color(0)).multiplyScalar(this.bodySelected ? 0.12 : 0);
    // arestas também indicam seleção (essencial no modo arame)
    const edgeBase = this.mode === "arame" ? EDGE_WIRE : EDGE_DARK;
    this.edgeMat.color.copy(this.bodySelected ? ACCENT : this.bodyHover && this.mode === "arame" ? HOVER : edgeBase);
  }

  /** Translúcido (corpos ao fundo durante o esboço; prévia "fantasma"). */
  setGhost(on: boolean, opacity = 0.32) {
    this.meshMat.transparent = on;
    this.meshMat.opacity = on ? opacity : 1;
    this.meshMat.depthWrite = !on;
    this.mesh.renderOrder = on ? 2 : 0;
    this.edgeMat.opacity = on ? Math.min(0.6, opacity + 0.25) : this.mode === "arame" ? 1 : 0.85;
  }

  setMode(mode: DisplayMode) {
    this.mode = mode;
    this.mesh.visible = mode !== "arame";
    this.edges.visible = mode !== "sombreado";
    this.edgeMat.opacity = mode === "arame" ? 1 : 0.85;
    this.refreshColors();
  }

  faceOfTriangle(tri: number): number {
    return rangeIndexOf(this.geom.faces, tri);
  }

  /** Malha só com os triângulos de uma face (compartilha posições/normais com o corpo). */
  faceOverlay(face: number, color: Color, opacity: number): Mesh | null {
    const start = this.geom.faces[face * 2];
    const count = this.geom.faces[face * 2 + 1];
    if (start === undefined || !count) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", this.mesh.geometry.getAttribute("position"));
    g.setAttribute("normal", this.mesh.geometry.getAttribute("normal"));
    g.setIndex(new BufferAttribute(this.geom.indices.slice(start * 3, (start + count) * 3), 1));
    const m = new Mesh(
      g,
      new MeshBasicMaterial({ color, transparent: true, opacity, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    );
    m.renderOrder = 5;
    m.userData.shared = true;
    return m;
  }

  /** Linha grossa sobre uma aresta topológica. */
  edgeOverlay(edge: number, color: Color, widthPx: number, w: number, h: number): LineSegments2 | null {
    const start = this.geom.edges[edge * 2];
    const n = this.geom.edges[edge * 2 + 1];
    if (start === undefined || n < 2) return null;
    const p: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const a = (start + k) * 3;
      const b = (start + k + 1) * 3;
      p.push(...this.geom.edgePoints.subarray(a, a + 3), ...this.geom.edgePoints.subarray(b, b + 3));
    }
    const g = new LineSegmentsGeometry().setPositions(p);
    const mat = new LineMaterial({ color: color.getHex(), linewidth: widthPx, depthTest: true, transparent: true });
    mat.resolution.set(w, h);
    const l = new LineSegments2(g, mat);
    l.renderOrder = 6;
    return l;
  }

  vertex(i: number): Vector3 {
    const v = this.geom.vertices;
    return new Vector3(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
  }
  get vertexCount() {
    return this.geom.vertices.length / 3;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.edges.geometry.dispose();
    this.meshMat.dispose();
    this.edgeMat.dispose();
  }
}

/** Libera geometria/material de um destaque (sem tocar atributos compartilhados com o corpo). */
export function disposeOverlay(o: Mesh | LineSegments2) {
  if (o instanceof LineSegments2) {
    o.geometry.dispose();
    (o.material as LineMaterial).dispose();
    return;
  }
  // atributos de posição/normal pertencem ao corpo: só o índice é do destaque
  (o.material as MeshBasicMaterial).dispose();
  o.geometry.setIndex(null);
}
