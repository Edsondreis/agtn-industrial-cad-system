import { type SheetSolved, type SolvedBend, type SolvedFlange, TOL, dimAbs, interfVol, sheetMath as M, type SheetV3 as V3 } from "@agtn/sheetgraph";
import { SolidError } from "@agtn/solid";
import { BooleanGlue, BooleanOp, type OcctKernel, type ShapeHandle } from "occt-wasm";
import { type Surface, expectedSurface, isContactLabel, sameSurface, splitLabel } from "./provenance";

/**
 * Sólido de chapa a partir do grafo resolvido. Cada aba vira um prisma (região plana × T) e cada dobra um setor
 * de anel (`revolve` do retângulo da linha de tangência em torno do eixo, ângulo θ). As peças são fundidas
 * com histórico (proveniência) e conferidas:
 *  - validade OCCT, um único sólido;
 *  - volume = fórmula do grafo (Σ A·T + Σ θ·T·(R+T/2)·L) e = Σ volumes das peças (nada sobreposto);
 *  - interferência entre peças NÃO vizinhas (volume comum) e contato;
 *  - toda face final com proveniência; nenhuma face não-contato some; superfícies conferidas;
 *  - espessura medida entre as faces A e B de cada aba; ângulo medido (normais orientadas, com sinal em torno
 *    do eixo) = θ de cada dobra; caixa envolvente = caixa exata do grafo.
 * Uma fusão OCCT bem-sucedida NÃO basta: qualquer conferência que falhar é erro explícito.
 */
export interface SheetBuild {
  readonly shape: ShapeHandle;
  /** rótulos de proveniência por índice de face (ordem de `getSubShapes(shape, "face")` = ordem da malha) */
  readonly faceLabels: readonly (readonly string[])[];
  readonly volume: number;
  readonly warnings: readonly string[];
  readonly ms: { readonly pieces: number; readonly checks: number; readonly fuse: number; readonly total: number };
}

const UBS = [2147483647, 2147483629, 2147483587];
/** id da peça do setor de dobra (a dobra tem o mesmo id da aba-filha) */
const pid = (b: SolvedBend) => `dobra|${b.id}`;
class HashCollision extends Error {}

type Reg = <H extends ShapeHandle>(h: H) => H;

interface Piece {
  id: string;
  label: string;
  kind: "aba" | "dobra";
  shape: ShapeHandle;
  /** rótulo de cada face da peça (mesma ordem de getSubShapes) */
  faces: string[];
  vol: number;
  box: { min: V3; max: V3 };
}

export interface BuildOptions {
  /** limites de hash tentados em sequência (colisão → próximo) */
  readonly ubs?: readonly number[];
  /** SOMENTE TESTES: altera os rótulos antes da conferência (prova que a conferência pega a troca) */
  readonly tamper?: (labels: string[][]) => void;
}

export function buildSheet(k: OcctKernel, s: SheetSolved, T: Reg, o: BuildOptions = {}): SheetBuild {
  for (const ub of o.ubs ?? UBS) {
    try {
      return buildWith(k, s, T, ub, o.tamper);
    } catch (e) {
      if (!(e instanceof HashCollision)) throw e;
    }
  }
  throw new SolidError("KERNEL", "Colisão de identificadores do OCCT em todas as tentativas — a proveniência das faces não pôde ser garantida.");
}

function buildWith(k: OcctKernel, s: SheetSolved, T: Reg, UB: number, tamper?: BuildOptions["tamper"]): SheetBuild {
  const t0 = performance.now();
  const size = sizeOf(s);
  const warnings: string[] = [];
  const faces = (h: ShapeHandle) => k.getSubShapes(h, "face").map(T);
  const surf = (f: ShapeHandle): Surface | null => {
    const st = k.surfaceType(f);
    const d = k.surfaceData(f) as unknown as { location: V3; normal?: V3; axis?: V3; radius?: number };
    if (st === "plane") return { kind: "plane", p: d.location, n: d.normal! };
    if (st === "cylinder") return { kind: "cyl", p: d.location, axis: d.axis!, r: d.radius! };
    return null;
  };

  /* ---------------------------------------------------------------------------- peças com rótulos */
  const pieces: Piece[] = [];
  const classify = (shape: ShapeHandle, cands: string[], what: string): string[] => {
    const fs = faces(shape);
    const used = new Set<string>();
    return fs.map((f) => {
      const sf = surf(f);
      let hits = sf ? cands.filter((c) => !used.has(c) && sameSurface(expectedSurface(s, c)!, sf, size)) : [];
      if (hits.length > 1) {
        // faces coplanares da MESMA peça (arestas alinhadas): o centro da face decide pelo trecho da aresta
        const c = k.getSurfaceCenterOfMass(f);
        hits = hits.filter((h) => insideSpan(s, h, c, size));
      }
      if (hits.length !== 1) throw new SolidError("KERNEL", `Proveniência: face de ${what} sem correspondência única no grafo (${hits.length} candidatas).`);
      used.add(hits[0]);
      return hits[0];
    });
  };
  const flangeById = new Map(s.flanges.map((f) => [f.id, f]));
  const childBends = (fid: string) => s.bends.filter((b) => b.parent === fid);
  const visit = (f: SolvedFlange) => {
    pieces.push(prism(f));
    for (const b of childBends(f.id)) {
      pieces.push(sector(b));
      visit(flangeById.get(b.child)!);
    }
  };
  function prism(f: SolvedFlange): Piece {
    const W = (p: { x: number; y: number }, z = 0) => M.apply(f.G, M.v3(p.x, p.y, z));
    const wire = (pts: V3[]) => T(k.makeWire(pts.map((p, i) => T(k.makeLineEdge(p, pts[(i + 1) % pts.length])))));
    let face = T(k.makeFace(wire(f.flat.map((e) => W(e.a)))));
    const cands = ["A", "B", ...f.flat.map((e) => `e:${e.key}`)].map((r) => `${f.id}/${r}`);
    if (f.holes.length) {
      const hw = f.holes.map((h) => {
        const segs = h.loop.segs;
        if (segs.length === 1 && segs[0].t === "circle") {
          cands.push(`${f.id}/h:${h.key}`);
          return T(k.makeWire([T(k.makeCircleEdge(W(segs[0].c), M.applyDir(f.G, M.v3(0, 0, 1)), segs[0].r))]));
        }
        segs.forEach((_, i) => cands.push(`${f.id}/h:${h.key}:${i}`));
        return T(
          k.makeWire(
            segs.map((sg) => {
              if (sg.t === "line") return T(k.makeLineEdge(W(sg.a), W(sg.b)));
              if (sg.t === "circle") throw new SolidError("INVALID_PARAMS", "Círculo dentro de um contorno de recorte.");
              const a0 = Math.atan2(sg.a.y - sg.c.y, sg.a.x - sg.c.x) + sg.sweep / 2;
              const mid = { x: sg.c.x + sg.r * Math.cos(a0), y: sg.c.y + sg.r * Math.sin(a0) };
              return T(k.makeArcEdge(W(sg.a), W(mid), W(sg.b)));
            }),
          ),
        );
      });
      face = T(k.addHolesInFace(face, hw));
    }
    const z = M.applyDir(f.G, M.v3(0, 0, s.T));
    const shape = T(k.extrude(face, z.x, z.y, z.z));
    return finish(f.id, f.label, "aba", shape, cands);
  }
  function sector(b: SolvedBend): Piece {
    const pf = flangeById.get(b.parent)!;
    const [A, B] = b.tangent;
    const W = (p: { x: number; y: number }, z: number) => M.apply(pf.G, M.v3(p.x, p.y, z));
    const pts = [W(A, 0), W(B, 0), W(B, s.T), W(A, s.T)];
    const face = T(k.makeFace(T(k.makeWire(pts.map((p, i) => T(k.makeLineEdge(p, pts[(i + 1) % 4])))))));
    const shape = T(k.revolve(face, { point: b.axis.p, direction: b.axis.dir }, (b.deflectionDeg * Math.PI) / 180));
    const roles = ["ext", "c0", "c1", "l0", "l1", ...(b.R > 0 ? ["int"] : [])];
    return finish(pid(b), b.label, "dobra", shape, roles.map((r) => `${b.id}/${r}`));
  }
  function finish(id: string, label: string, kind: Piece["kind"], shape: ShapeHandle, cands: string[]): Piece {
    if (!k.isValid(shape)) throw new SolidError("KERNEL", `${label}: a peça gerada não é um sólido válido.`);
    const fl = classify(shape, cands, label);
    const bb = k.getBoundingBox(shape);
    return { id, label, kind, shape, faces: fl, vol: k.getVolume(shape), box: { min: M.v3(bb.xmin, bb.ymin, bb.zmin), max: M.v3(bb.xmax, bb.ymax, bb.zmax) } };
  }
  visit(flangeById.get(s.root)!);
  const tPieces = performance.now();

  /* ---------------------------------------------------------------------- interferência e contato */
  // vizinhas no grafo (aba–dobra–aba): contato por construção, não verificadas
  const neighbor = new Set<string>();
  // dobras irmãs (mesma aba-pai) se tocam no canto aberto pela aresta da tangência: verificadas quanto a
  // VOLUME comum (com θ > 90° elas se cruzam sobre o canto), mas o toque na aresta não é aviso
  const sibling = new Set<string>();
  const pair = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const b of s.bends) {
    neighbor.add(pair(pid(b), b.parent));
    neighbor.add(pair(pid(b), b.child));
    for (const c of s.bends) if (c !== b && c.parent === b.parent) sibling.add(pair(pid(b), pid(c)));
  }
  const gap = dimAbs(size);
  const boxesTouch = (p: Piece, q: Piece) =>
    p.box.min.x <= q.box.max.x + gap && q.box.min.x <= p.box.max.x + gap && p.box.min.y <= q.box.max.y + gap && q.box.min.y <= p.box.max.y + gap && p.box.min.z <= q.box.max.z + gap && q.box.min.z <= p.box.max.z + gap;
  const interf: string[] = [];
  for (let i = 0; i < pieces.length; i++)
    for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[i];
      const q = pieces[j];
      if (neighbor.has(pair(p.id, q.id)) || !boxesTouch(p, q)) continue;
      let v = 0;
      try {
        v = k.getVolume(T(k.common(p.shape, q.shape)));
      } catch {
        v = 0; // sem volume comum calculável: a conferência global de volume decide
      }
      if (v > interfVol(Math.min(p.vol, q.vol))) interf.push(`${p.kind === "dobra" ? "dobra " : ""}${p.label} × ${q.kind === "dobra" ? "dobra " : ""}${q.label}: ${fmt(v, 3)} mm³`);
      else if (!sibling.has(pair(p.id, q.id)) && k.distanceBetween(p.shape, q.shape) <= TOL.contactDist) warnings.push(`Contato (sem sobreposição) entre ${p.label} e ${q.label}.`);
    }
  if (interf.length) throw new SolidError("INVALID_PARAMS", `Interferência entre abas/dobras: ${interf.join("; ")}.`);
  const tChecks = performance.now();

  /* ---------------------------------------------------------------------------- fusão com histórico */
  const labels = new Map<number, Set<string>>();
  const hashAll = (hs: ShapeHandle[]) => {
    const out = hs.map((h) => k.hashCode(h, UB));
    if (new Set(out).size !== out.length) throw new HashCollision();
    return out;
  };
  const track = (inputHashes: number[], out: ShapeHandle, evo: { modified: number[] }) => {
    const outHashes = hashAll(faces(out));
    const next = new Map<number, Set<string>>();
    const put = (h: number, ls: Iterable<string> | undefined) => {
      if (!ls) return;
      const cur = next.get(h) ?? new Set<string>();
      for (const l of ls) cur.add(l);
      next.set(h, cur);
    };
    const outSet = new Set(outHashes);
    const mod = new Set<number>();
    const m = evo.modified;
    for (let i = 0; i < m.length; ) {
      const src = m[i];
      const n = m[i + 1];
      mod.add(src);
      for (let j = 0; j < n; j++) put(m[i + 2 + j], labels.get(src));
      i += 2 + n;
    }
    for (const h of inputHashes) if (!mod.has(h) && outSet.has(h)) put(h, labels.get(h));
    labels.clear();
    for (const [h, l] of next) if (outSet.has(h)) labels.set(h, l);
    return outHashes;
  };
  // uma única fusão geral (BOPAlgo, todas as peças de uma vez) com histórico das faces
  const all: number[] = [];
  for (const p of pieces)
    for (const [i, h] of hashAll(faces(p.shape)).entries()) {
      if (labels.has(h)) throw new HashCollision();
      labels.set(h, new Set([p.faces[i]]));
      all.push(h);
    }
  let acc: ShapeHandle = pieces[0].shape;
  if (pieces.length > 1) {
    const evo = k.booleanOp(BooleanOp.Fuse, [pieces[0].shape], pieces.slice(1).map((p) => p.shape), { inputFaceHashes: all, hashUpperBound: UB, glue: BooleanGlue.Shift });
    acc = T(evo.result);
    track(all, acc, evo);
  }
  {
    const h = hashAll(faces(acc));
    const evo = k.unifySameDomainWithHistory(acc, h, UB);
    acc = T(evo.result);
    track(h, acc, evo);
  }
  // composto com um sólido → o sólido
  const solids = k.getSubShapes(acc, "solid").map(T);
  if (solids.length !== 1) throw new SolidError("KERNEL", `A chapa resultou em ${solids.length} sólidos — as abas não ficaram ligadas.`);
  if (k.getShapeType(acc) === "compound") acc = solids[0];
  const tFuse = performance.now();

  /* ------------------------------------------------------------------------------------ conferências */
  if (!k.isValid(acc)) throw new SolidError("KERNEL", "O sólido de chapa não é válido no OCCT.");
  const vol = k.getVolume(acc);
  const sumP = pieces.reduce((a, p) => a + p.vol, 0);
  const vtol = Math.max(TOL.interfVolMin, 1e-9 * s.volume);
  if (Math.abs(vol - s.volume) > vtol)
    throw new SolidError("KERNEL", `Volume do sólido ${fmt(vol, 6)} mm³ ≠ volume do grafo ${fmt(s.volume, 6)} mm³ (Σ A·T + Σ θ·T·(R+T/2)·L).`);
  if (Math.abs(vol - sumP) > vtol) throw new SolidError("INVALID_PARAMS", `Peças sobrepostas: volume fundido ${fmt(vol, 6)} mm³ < soma das peças ${fmt(sumP, 6)} mm³.`);

  const finalFaces = faces(acc);
  const finalH = hashAll(finalFaces);
  const faceLabels = finalH.map((h) => [...(labels.get(h) ?? [])].sort());
  tamper?.(faceLabels);
  const seen = new Set<string>();
  finalFaces.forEach((f, i) => {
    if (!faceLabels[i].length) throw new SolidError("KERNEL", `Proveniência: a face ${i} do sólido de chapa não tem origem no grafo.`);
    const sf = surf(f);
    for (const l of faceLabels[i]) {
      seen.add(l);
      const ex = expectedSurface(s, l);
      if (!sf || !ex || !sameSurface(ex, sf, size)) throw new SolidError("KERNEL", `Proveniência inconsistente: a face ${i} (${l}) não está na superfície que o grafo gerou.`);
    }
  });
  for (const p of pieces)
    for (const l of p.faces)
      if (!seen.has(l) && !isContactLabel(l, s)) throw new SolidError("INVALID_PARAMS", `A face ${l} sumiu na fusão — outra parte da peça ocupa o lugar dela (interferência).`);

  // espessura medida (A × B) e ângulo medido (normais orientadas, sinal em torno do eixo)
  const planeOf = (label: string): { p: V3; n: V3 } => {
    const i = faceLabels.findIndex((ls) => ls.includes(label));
    if (i < 0) throw new SolidError("KERNEL", `Conferência: face ${label} não encontrada.`);
    const f = finalFaces[i];
    const d = k.surfaceData(f) as unknown as { location: V3; normal: V3 };
    const n = k.shapeOrientation(f) === "reversed" ? M.mul3(d.normal, -1) : d.normal;
    return { p: d.location, n: M.unit3(n) };
  };
  for (const f of s.flanges) {
    const a = planeOf(`${f.id}/A`);
    const b = planeOf(`${f.id}/B`);
    const t = Math.abs(M.dot3(M.sub3(b.p, a.p), a.n));
    if (Math.abs(t - s.T) > dimAbs(size)) throw new SolidError("KERNEL", `${f.label}: espessura medida ${fmt(t, 6)} mm ≠ T ${fmt(s.T, 6)} mm.`);
    if (M.dot3(a.n, b.n) > -1 + 1e-12) throw new SolidError("KERNEL", `${f.label}: faces A e B não são opostas.`);
  }
  for (const b of s.bends) {
    const nP = planeOf(`${b.parent}/A`).n;
    const nC = planeOf(`${b.child}/A`).n;
    const u = M.unit3(b.axis.dir);
    const ang = (Math.atan2(M.dot3(M.cross3(nP, nC), u), M.dot3(nP, nC)) * 180) / Math.PI;
    if (Math.abs(ang - b.deflectionDeg) > TOL.dimAngDeg)
      throw new SolidError("KERNEL", `${b.label}: ângulo medido ${fmt(ang, 7)}° ≠ θ ${fmt(b.deflectionDeg, 7)}° (sentido ou eixo invertido).`);
  }
  // caixa envolvente exata
  const ex = exactBox(s);
  const bb = k.getBoundingBox(acc);
  const btol = dimAbs(size) + 10 * TOL.occt;
  const got = [bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax];
  const want = [ex.min.x, ex.min.y, ex.min.z, ex.max.x, ex.max.y, ex.max.z];
  if (got.some((g, i) => Math.abs(g - want[i]) > btol)) throw new SolidError("KERNEL", `Caixa envolvente do sólido diferente da do grafo (${got.map((g) => fmt(g, 4)).join(", ")} × ${want.map((g) => fmt(g, 4)).join(", ")}).`);
  const t1 = performance.now();
  return { shape: acc, faceLabels, volume: vol, warnings, ms: { pieces: tPieces - t0, checks: tChecks - tPieces, fuse: tFuse - tChecks, total: t1 - t0 } };
}

/* ======================================================================================== auxiliares */

const fmt = (v: number, p: number) => v.toFixed(p).replace(".", ",");

function sizeOf(s: SheetSolved): number {
  const b = exactBox(s);
  return Math.max(1, Math.abs(b.min.x), Math.abs(b.min.y), Math.abs(b.min.z), Math.abs(b.max.x), Math.abs(b.max.y), Math.abs(b.max.z));
}

/** O centro da face cai dentro do trecho da aresta (ou do segmento do furo) do rótulo? */
function insideSpan(s: SheetSolved, label: string, c: V3, size: number): boolean {
  const [owner, role] = splitLabel(label);
  if (!role.startsWith("e:") && !role.startsWith("h:")) return true;
  const f = s.flanges.find((x) => x.id === owner);
  if (!f) return true;
  const inv = M.invert(f.G);
  const q = M.apply(inv, c);
  let a: { x: number; y: number } | undefined;
  let b: { x: number; y: number } | undefined;
  if (role.startsWith("e:")) {
    const e = f.flat.find((x) => x.key === role.slice(2));
    a = e?.a;
    b = e?.b;
  } else if (role.startsWith("h:")) {
    const [key, idx] = role.slice(2).split(":");
    const sg = f.holes.find((h) => h.key === key)?.loop.segs[Number(idx ?? 0)];
    if (sg && sg.t === "line") {
      a = sg.a;
      b = sg.b;
    } else if (sg && sg.t === "arc") {
      const ang = Math.atan2(q.y - sg.c.y, q.x - sg.c.x);
      const a0 = Math.atan2(sg.a.y - sg.c.y, sg.a.x - sg.c.x);
      let t = (ang - a0) * Math.sign(sg.sweep);
      t = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return t <= Math.abs(sg.sweep);
    }
  }
  if (!a || !b) return true;
  const d = M.sub2(b, a);
  const L = M.len2(d);
  const t = M.dot2(M.sub2(M.v2(q.x, q.y), a), d) / L;
  const tol = dimAbs(size);
  return t > tol && t < L - tol;
}

/** Caixa exata: vértices dos prismas + extremos analíticos dos arcos das dobras. */
export function exactBox(s: SheetSolved): { min: V3; max: V3 } {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const put = (p: V3) => {
    const v = [p.x, p.y, p.z];
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], v[i]);
      hi[i] = Math.max(hi[i], v[i]);
    }
  };
  for (const f of s.flanges) for (const e of f.flat) for (const z of [0, s.T]) put(M.apply(f.G, M.v3(e.a.x, e.a.y, z)));
  const E = [M.v3(1, 0, 0), M.v3(0, 1, 0), M.v3(0, 0, 1)];
  for (const b of s.bends) {
    const pf = s.flanges.find((x) => x.id === b.parent)!;
    const u = M.unit3(b.axis.dir);
    const th = (b.deflectionDeg * Math.PI) / 180;
    for (const t of b.tangent)
      for (const z of [0, s.T]) {
        const p = M.apply(pf.G, M.v3(t.x, t.y, z));
        // centro do arco no eixo, na mesma seção
        const c = M.add3(b.axis.p, M.mul3(u, M.dot3(M.sub3(p, b.axis.p), u)));
        const r = M.sub3(p, c);
        const w = M.cross3(u, r);
        const at = (phi: number) => M.add3(c, M.add3(M.mul3(r, Math.cos(phi)), M.mul3(w, Math.sin(phi))));
        put(at(0));
        put(at(th));
        for (const e of E) {
          const phi = Math.atan2(M.dot3(w, e), M.dot3(r, e));
          for (const ph of [phi, phi + Math.PI, phi - Math.PI]) if (ph > 0 && ph < th) put(at(ph));
        }
      }
  }
  return { min: M.v3(lo[0], lo[1], lo[2]), max: M.v3(hi[0], hi[1], hi[2]) };
}
