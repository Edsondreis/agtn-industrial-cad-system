import { type SheetSolved, type SolvedBend, type SolvedFlange, TOL, dimAbs, edgeMid, interfVol, loopArea, sheetMath as M, type SheetV3 as V3 } from "@agtn/sheetgraph";
import { SolidError } from "@agtn/solid";
import { BooleanGlue, BooleanOp, type OcctKernel, type ShapeHandle } from "occt-wasm";
import { type Surface, expectedSurface, isContactLabel, sameSurface } from "./provenance";

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
  /*
   * PROVENIÊNCIA POR CONSTRUÇÃO (ETAPA 2.0 · A1): cada aresta do contorno é criada com o seu rótulo; a face
   * plana guarda as arestas na ordem dos fios (conferido ponta a ponta com as coordenadas exatas da
   * construção); `extrudeWithHistory` / `revolveWithHistory` dizem qual face nasceu de qual aresta
   * (`edgeGenerated`) e quais são o início e o fim (`firstShape` / `lastShape`). Nenhuma classificação por
   * posição: a conferência contra a superfície do grafo vem depois, só como verificação.
   */
  const pieces: Piece[] = [];
  const near3 = (a: V3, b: V3) => M.len3(M.sub3(a, b)) <= dimAbs(size) + TOL.occt;
  const vertsOf = (e: ShapeHandle): V3[] => k.getSubShapes(e, "vertex").map(T).map((v) => k.vertexPosition(v) as unknown as V3);
  type Built = { label: string; ends: V3[] | null };
  /** rótulo de cada aresta da face, na ordem dos fios, conferido pelas pontas */
  const faceEdgeLabels = (face: ShapeHandle, built: Built[], what: string): ShapeHandle[] => {
    const fe = k.getSubShapes(face, "edge").map(T);
    if (fe.length !== built.length) throw new SolidError("KERNEL", `Proveniência: ${what} tem ${fe.length} arestas na face e ${built.length} na construção.`);
    fe.forEach((e, i) => {
      const want = built[i].ends;
      const got = vertsOf(e);
      if (want === null) {
        if (got.length !== 1) throw new SolidError("KERNEL", `Proveniência: ${what}, aresta ${i + 1} deveria ser um círculo fechado.`);
        return;
      }
      const ok = got.length === 2 && ((near3(got[0], want[0]) && near3(got[1], want[1])) || (near3(got[0], want[1]) && near3(got[1], want[0])));
      if (!ok) throw new SolidError("KERNEL", `Proveniência: ${what}, a aresta ${i + 1} da face não é a construída (${built[i].label}).`);
    });
    return fe;
  };
  /** rótulos das faces do sólido gerado, pelo histórico da extrusão/revolução */
  const labelsFrom = (out: ShapeHandle, evo: { edgeGenerated: number[]; firstShape: number[]; lastShape: number[] }, edgeHashes: number[], built: Built[], first: string, last: string, what: string): string[] => {
    const byHash = new Map<number, string>();
    const put = (h: number, l: string) => {
      if (byHash.has(h) && byHash.get(h) !== l) throw new HashCollision();
      byHash.set(h, l);
    };
    evo.firstShape.forEach((h) => put(h, first));
    evo.lastShape.forEach((h) => put(h, last));
    const g = evo.edgeGenerated;
    for (let i = 0; i < g.length; ) {
      const src = g[i];
      const n = g[i + 1];
      const j = edgeHashes.indexOf(src);
      for (let q = 0; q < n; q++) if (j >= 0) put(g[i + 2 + q], built[j].label);
      i += 2 + n;
    }
    const fs = faces(out);
    return fs.map((f, i) => {
      const l = byHash.get(k.hashCode(f, UB));
      if (!l) throw new SolidError("KERNEL", `Proveniência: a face ${i + 1} de ${what} não tem origem no histórico da construção.`);
      return l;
    });
  };
  const hashes = (hs: ShapeHandle[]) => {
    const out = hs.map((h) => k.hashCode(h, UB));
    if (new Set(out).size !== out.length) throw new HashCollision();
    return out;
  };

  const flangeById = new Map(s.flanges.map((f) => [f.id, f]));
  const childBends = (fid: string) => s.bends.filter((b) => b.parent === fid);
  const visit = (f: SolvedFlange) => {
    pieces.push(prism(f));
    for (const b of childBends(f.id)) {
      if (!b.folded) pieces.push(...flatStrip(b));
      else if (b.cut) pieces.push(...sectors(b));
      else pieces.push(sector(b));
      visit(flangeById.get(b.child)!);
    }
  };
  function prism(f: SolvedFlange): Piece {
    const W = (p: { x: number; y: number }, z = 0) => M.apply(f.G, M.v3(p.x, p.y, z));
    const built: Built[] = [];
    const line = (a: V3, b: V3, label: string) => {
      built.push({ label, ends: [a, b] });
      return T(k.makeLineEdge(a, b));
    };
    const outer = T(
      k.makeWire(
        f.flat.map((e) => {
          if (!e.arc) return line(W(e.a), W(e.b), `${f.id}/e:${e.key}`);
          const m = edgeMid(e);
          built.push({ label: `${f.id}/e:${e.key}`, ends: [W(e.a), W(e.b)] });
          return T(k.makeArcEdge(W(e.a), W(m), W(e.b)));
        }),
      ),
    );
    let face = T(k.makeFace(outer));
    if (f.holes.length) {
      const hw = f.holes.map((h) => {
        const segs = h.loop.segs;
        if (segs.length === 1 && segs[0].t === "circle") {
          built.push({ label: `${f.id}/h:${h.key}`, ends: null });
          return T(k.makeWire([T(k.makeCircleEdge(W(segs[0].c), M.applyDir(f.G, M.v3(0, 0, 1)), segs[0].r))]));
        }
        // laço interno no sentido horário (o OCCT inverte um furo anti-horário e a ordem das arestas mudaria):
        // percorre os trechos ao contrário, cada um com o rótulo do índice ORIGINAL
        const ccw = loopArea(h.loop) > 0;
        const order = segs.map((_, i) => i);
        if (ccw) order.reverse();
        const rev = (sg: (typeof segs)[number]): (typeof segs)[number] =>
          !ccw || sg.t === "circle" ? sg : sg.t === "line" ? { t: "line", a: sg.b, b: sg.a } : { ...sg, a: sg.b, b: sg.a, sweep: -sg.sweep };
        return T(
          k.makeWire(
            order.map((i) => {
              const sg = rev(segs[i]);
              const label = `${f.id}/h:${h.key}:${i}`;
              if (sg.t === "line") return line(W(sg.a), W(sg.b), label);
              if (sg.t === "circle") throw new SolidError("INVALID_PARAMS", "Círculo dentro de um contorno de recorte.");
              const a0 = Math.atan2(sg.a.y - sg.c.y, sg.a.x - sg.c.x) + sg.sweep / 2;
              const mid = { x: sg.c.x + sg.r * Math.cos(a0), y: sg.c.y + sg.r * Math.sin(a0) };
              built.push({ label, ends: [W(sg.a), W(sg.b)] });
              return T(k.makeArcEdge(W(sg.a), W(mid), W(sg.b)));
            }),
          ),
        );
      });
      face = T(k.addHolesInFace(face, hw));
    }
    const fe = faceEdgeLabels(face, built, f.label);
    const eh = hashes(fe);
    const z = M.applyDir(f.G, M.v3(0, 0, s.T));
    const evo = k.extrudeWithHistory(face, z.x, z.y, z.z, [k.hashCode(face, UB), ...eh], UB);
    const shape = T(evo.result);
    return finish(f.id, f.label, "aba", shape, labelsFrom(shape, evo, eh, built, `${f.id}/A`, `${f.id}/B`, f.label));
  }
  /**
   * Região de dobra com recorte (ETAPA 2.4): uma revolução PARCIAL por fatia de material [u0, u1] × [s0, s1] da
   * planificação, de φ0 = s0 / (R + K·T) a φ1 = s1 / (R + K·T) (fibra neutra). Faces novas: u:i (plano normal ao
   * eixo em u_i, contato entre fatias ou parede do recorte) e s:j (plano radial em φ_j, parede do recorte).
   */
  function sectors(b: SolvedBend): Piece[] {
    const cut = b.cut!;
    const pf = flangeById.get(b.parent)!;
    const [A, B] = b.tangent;
    const d = M.unit2(M.sub2(B, A));
    const up = b.side === "cima";
    const z0 = `${b.id}/${up ? "ext" : "int"}`;
    const zT = `${b.id}/${up ? "int" : "ext"}`;
    const rho = b.R + b.K * s.T;
    const near = (x: number, y: number) => Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(y));
    const uLab = (u: number, end: boolean) => (near(u, 0) && !end ? `${b.id}/l0` : near(u, b.L) && end ? `${b.id}/l1` : `${b.id}/u:${cut.us.findIndex((x) => near(x, u))}`);
    const sLab = (w: number) => (near(w, 0) ? `${b.id}/c0` : near(w, b.BA) ? `${b.id}/c1` : `${b.id}/s:${cut.ss.findIndex((x) => near(x, w))}`);
    const out: Piece[] = [];
    cut.slabs.forEach((q, i) =>
      q.mat.forEach(([s0, s1], j) => {
        const rot = M.rotation(b.axis.p, b.axis.dir, s0 / rho);
        const W = (u: number, z: number) => M.apply(rot, M.apply(pf.G, M.v3(A.x + d.x * u, A.y + d.y * u, z)));
        const pts = [W(q.u0, 0), W(q.u1, 0), W(q.u1, s.T), W(q.u0, s.T)];
        const labels = [z0, uLab(q.u1, true), zT, uLab(q.u0, false)];
        const built: Built[] = pts.map((p, k2) => ({ label: labels[k2], ends: [p, pts[(k2 + 1) % 4]] }));
        const face = T(k.makeFace(T(k.makeWire(pts.map((p, k2) => T(k.makeLineEdge(p, pts[(k2 + 1) % 4])))))));
        const what = `${b.label} (fatia ${i + 1}.${j + 1})`;
        const fe = faceEdgeLabels(face, built, what);
        const eh = hashes(fe);
        const evo = k.revolveWithHistory(face, { point: b.axis.p, direction: b.axis.dir }, (s1 - s0) / rho, [k.hashCode(face, UB), ...eh], UB);
        const shape = T(evo.result);
        out.push(finish(`${pid(b)}§${i}.${j}`, what, "dobra", shape, labelsFrom(shape, evo, eh, built, sLab(s0), sLab(s1), what)));
      }),
    );
    return out;
  }
  /**
   * Região de dobra DESDOBRADA (ETAPA 2.5): prisma plano BA × L × T no plano da pai (o comprimento desenvolvido é
   * conservado), com as mesmas faces nomeadas (c0, c1, l0, l1, int/ext viram planos; recortes: u:i, s:j).
   */
  function flatStrip(b: SolvedBend): Piece[] {
    const pf = flangeById.get(b.parent)!;
    const [A, B] = b.tangent;
    const d = M.unit2(M.sub2(B, A));
    const n = { x: d.y, y: -d.x };
    const up = b.side === "cima";
    const z0 = `${b.id}/${up ? "ext" : "int"}`;
    const zT = `${b.id}/${up ? "int" : "ext"}`;
    const near = (x: number, y: number) => Math.abs(x - y) <= 1e-12 * Math.max(1, Math.abs(y));
    const us = b.cut?.us ?? [];
    const ss = b.cut?.ss ?? [];
    const uLab = (u: number, end: boolean) => (near(u, 0) && !end ? `${b.id}/l0` : near(u, b.L) && end ? `${b.id}/l1` : `${b.id}/u:${us.findIndex((x) => near(x, u))}`);
    const sLab = (w: number) => (near(w, 0) ? `${b.id}/c0` : near(w, b.BA) ? `${b.id}/c1` : `${b.id}/s:${ss.findIndex((x) => near(x, w))}`);
    const rects = b.cut ? b.cut.slabs.flatMap((q) => q.mat.map(([s0, s1]) => ({ u0: q.u0, u1: q.u1, s0, s1 }))) : [{ u0: 0, u1: b.L, s0: 0, s1: b.BA }];
    const W = (u: number, w: number) => M.apply(pf.G, M.v3(A.x + d.x * u + n.x * w, A.y + d.y * u + n.y * w, 0));
    return rects.map((r, i) => {
      const pts = [W(r.u0, r.s0), W(r.u1, r.s0), W(r.u1, r.s1), W(r.u0, r.s1)];
      const labels = [sLab(r.s0), uLab(r.u1, true), sLab(r.s1), uLab(r.u0, false)];
      const built: Built[] = pts.map((p, k2) => ({ label: labels[k2], ends: [p, pts[(k2 + 1) % 4]] }));
      const face = T(k.makeFace(T(k.makeWire(pts.map((p, k2) => T(k.makeLineEdge(p, pts[(k2 + 1) % 4])))))));
      const what = `${b.label} (desdobrada${rects.length > 1 ? `, fatia ${i + 1}` : ""})`;
      const fe = faceEdgeLabels(face, built, what);
      const eh = hashes(fe);
      const z = M.applyDir(pf.G, M.v3(0, 0, s.T));
      const evo = k.extrudeWithHistory(face, z.x, z.y, z.z, [k.hashCode(face, UB), ...eh], UB);
      const shape = T(evo.result);
      return finish(rects.length > 1 ? `${pid(b)}§${i}` : pid(b), what, "dobra", shape, labelsFrom(shape, evo, eh, built, z0, zT, what));
    });
  }
  function sector(b: SolvedBend): Piece {
    const pf = flangeById.get(b.parent)!;
    const [A, B] = b.tangent;
    const W = (p: { x: number; y: number }, z: number) => M.apply(pf.G, M.v3(p.x, p.y, z));
    const up = b.side === "cima";
    // retângulo na linha de tangência: face z = 0 e z = T da pai; por dentro da dobra = z = T (cima) ou z = 0 (baixo)
    const z0 = `${b.id}/${up ? "ext" : "int"}`;
    const zT = `${b.id}/${up ? "int" : "ext"}`;
    const pts = [W(A, 0), W(B, 0), W(B, s.T), W(A, s.T)];
    const labels = [z0, `${b.id}/l1`, zT, `${b.id}/l0`];
    const built: Built[] = pts.map((p, i) => ({ label: labels[i], ends: [p, pts[(i + 1) % 4]] }));
    const face = T(k.makeFace(T(k.makeWire(pts.map((p, i) => T(k.makeLineEdge(p, pts[(i + 1) % 4])))))));
    const fe = faceEdgeLabels(face, built, b.label);
    const eh = hashes(fe);
    const evo = k.revolveWithHistory(face, { point: b.axis.p, direction: b.axis.dir }, (b.deflectionDeg * Math.PI) / 180, [k.hashCode(face, UB), ...eh], UB);
    const shape = T(evo.result);
    return finish(pid(b), b.label, "dobra", shape, labelsFrom(shape, evo, eh, built, `${b.id}/c0`, `${b.id}/c1`, b.label));
  }
  function finish(id: string, label: string, kind: Piece["kind"], shape: ShapeHandle, fl: string[]): Piece {
    if (!k.isValid(shape)) throw new SolidError("KERNEL", `${label}: a peça gerada não é um sólido válido.`);
    // conferência (não fonte): cada face da peça está na superfície que o grafo diz ter gerado
    faces(shape).forEach((f, i) => {
      const sf = surf(f);
      const ex = expectedSurface(s, fl[i]);
      if (!sf || !ex || !sameSurface(ex, sf, size)) throw new SolidError("KERNEL", `Proveniência inconsistente na construção: ${fl[i]} fora da superfície do grafo.`);
    });
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
      // fatias da mesma região de dobra (recorte 2.4) contam como a própria região
      const bp = p.id.split("§")[0];
      const bq = q.id.split("§")[0];
      if (bp === bq || neighbor.has(pair(bp, bq)) || !boxesTouch(p, q)) continue;
      let v = 0;
      try {
        v = k.getVolume(T(k.common(p.shape, q.shape)));
      } catch {
        v = 0; // sem volume comum calculável: a conferência global de volume decide
      }
      if (v > interfVol(Math.min(p.vol, q.vol))) interf.push(`${p.kind === "dobra" ? "dobra " : ""}${p.label} × ${q.kind === "dobra" ? "dobra " : ""}${q.label}: ${fmt(v, 3)} mm³`);
      else if (!sibling.has(pair(bp, bq)) && k.distanceBetween(p.shape, q.shape) <= TOL.contactDist) warnings.push(`Contato (sem sobreposição) entre ${p.label} e ${q.label}.`);
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
    if (Math.abs(ang - b.effectiveDeg) > TOL.dimAngDeg)
      throw new SolidError("KERNEL", `${b.label}: ângulo medido ${fmt(ang, 7)}° ≠ θ efetivo ${fmt(b.effectiveDeg, 7)}° (sentido ou eixo invertido).`);
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
    if (!b.folded) {
      // desdobrada: os cantos do prisma plano BA × L × T
      const [A, B] = b.tangent;
      const d = M.unit2(M.sub2(B, A));
      for (const t of [A, B]) for (const w of [0, b.BA]) for (const z of [0, s.T]) put(M.apply(pf.G, M.v3(t.x + d.y * w, t.y - d.x * w, z)));
      continue;
    }
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
