import { type SheetSolved, TOL, dimAbs, sheetMath as M, type SheetV3 as V3 } from "@agtn/sheetgraph";

/**
 * PROVENIÊNCIA (2.2) — identidade de cada face do sólido de chapa POR CONSTRUÇÃO:
 *  1. na geração: cada face de cada peça (prisma da aba, setor da dobra) recebe um rótulo semântico no momento
 *     em que é criada (a peça é nova e de estrutura conhecida);
 *  2. propagação: as fusões usam `fuseWithHistory` / `unifySameDomainWithHistory`; o histórico leva os rótulos
 *     até as faces finais (face final = união dos rótulos das faces de origem);
 *  3. conferência (complementar, NUNCA fonte do resultado): cada rótulo de cada face final é testado contra a
 *     superfície exata que o grafo diz ter gerado. Divergência → erro "proveniência inconsistente".
 * Rótulos: «aba»/A, «aba»/B, «aba»/e:«aresta», «aba»/h:«furo»[:i], «dobra»/int|ext|c0|c1|l0|l1.
 * Contatos previstos (somem na fusão ou sobram em parte): «dobra»/c0, «dobra»/c1, «pai»/e:«aresta dobrada»,
 * «filha»/e:raiz. Qualquer OUTRA face que suma é erro (algo engoliu a peça: interferência).
 */
export type Surface = { readonly kind: "plane"; readonly p: V3; readonly n: V3 } | { readonly kind: "cyl"; readonly p: V3; readonly axis: V3; readonly r: number };

export const isContactLabel = (label: string, s: SheetSolved): boolean => {
  const [owner, role] = splitLabel(label);
  if (role === "c0" || role === "c1") return s.bends.some((b) => b.id === owner);
  if (role === "e:raiz") return s.flanges.some((f) => f.id === owner && f.parentBend);
  if (role.startsWith("e:")) {
    const key = role.slice(2);
    // faixa parcial (k^n) e degraus (k^n:p0/p1, A>B): encostam na dobra por construção
    if (key.includes("^") || key.includes(">")) return s.flanges.some((f) => f.id === owner);
    return s.bends.some((b) => b.parent === owner && b.edge === key);
  }
  return false;
};
const BEND_ROLES = new Set(["int", "ext", "c0", "c1", "l0", "l1"]);
export function splitLabel(label: string): [string, string] {
  const i = label.lastIndexOf("/");
  return [label.slice(0, i), label.slice(i + 1)];
}

/** Superfície exata (mundo) que o grafo diz ter gerado para o rótulo. */
export function expectedSurface(s: SheetSolved, label: string): Surface | null {
  const [owner, role] = splitLabel(label);
  // a dobra tem o mesmo id da aba-filha: o papel decide (A/B/e:/h: = aba; int/ext/c0/c1/l0/l1 = dobra)
  const f = BEND_ROLES.has(role) ? undefined : s.flanges.find((x) => x.id === owner);
  const T = s.T;
  if (f) {
    const P = (x: number, y: number, z: number) => M.apply(f.G, M.v3(x, y, z));
    const D = (x: number, y: number, z: number) => M.applyDir(f.G, M.v3(x, y, z));
    if (role === "A") return { kind: "plane", p: P(0, 0, 0), n: D(0, 0, -1) };
    if (role === "B") return { kind: "plane", p: P(0, 0, T), n: D(0, 0, 1) };
    if (role.startsWith("e:")) {
      const e = f.flat.find((x) => x.key === role.slice(2));
      if (!e) return null;
      if (e.arc) return { kind: "cyl", p: P(e.arc.c.x, e.arc.c.y, 0), axis: D(0, 0, 1), r: M.len2(M.sub2(e.a, e.arc.c)) };
      const d = M.unit2(M.sub2(e.b, e.a));
      return { kind: "plane", p: P(e.a.x, e.a.y, 0), n: D(d.y, -d.x, 0) };
    }
    if (role.startsWith("h:")) {
      const [key, idx] = role.slice(2).split(":");
      const h = f.holes.find((x) => x.key === key);
      if (!h) return null;
      const sg = h.loop.segs[idx === undefined ? 0 : Number(idx)];
      if (!sg) return null;
      if (sg.t === "line") {
        const d = M.unit2(M.sub2(sg.b, sg.a));
        return { kind: "plane", p: P(sg.a.x, sg.a.y, 0), n: D(d.y, -d.x, 0) };
      }
      return { kind: "cyl", p: P(sg.c.x, sg.c.y, 0), axis: D(0, 0, 1), r: sg.r };
    }
    return null;
  }
  const b = BEND_ROLES.has(role) ? s.bends.find((x) => x.id === owner) : undefined;
  if (!b) return null;
  const parent = s.flanges.find((x) => x.id === b.parent)!;
  const child = s.flanges.find((x) => x.id === b.child)!;
  const [A, B] = b.tangent;
  const d = M.unit2(M.sub2(B, A));
  const PP = (p: { x: number; y: number }, z = 0) => M.apply(parent.G, M.v3(p.x, p.y, z));
  switch (role) {
    case "int":
      return { kind: "cyl", p: b.axis.p, axis: b.axis.dir, r: b.R };
    case "ext":
      return { kind: "cyl", p: b.axis.p, axis: b.axis.dir, r: b.R + T };
    case "c0":
      return { kind: "plane", p: PP(A), n: M.applyDir(parent.G, M.v3(d.y, -d.x, 0)) };
    case "c1":
      return { kind: "plane", p: M.apply(child.G, M.v3(0, b.SB, 0)), n: M.applyDir(child.G, M.v3(0, -1, 0)) };
    case "l0":
      return { kind: "plane", p: PP(A), n: M.applyDir(parent.G, M.v3(-d.x, -d.y, 0)) };
    case "l1":
      return { kind: "plane", p: PP(B), n: M.applyDir(parent.G, M.v3(d.x, d.y, 0)) };
  }
  return null;
}

/** Superfície medida no OCCT é a mesma (plano: mesma reta normal e mesmo plano; cilindro: mesmo eixo e raio)? */
export function sameSurface(a: Surface, b: Surface, size: number): boolean {
  const tol = dimAbs(size) + TOL.occt;
  if (a.kind === "plane" && b.kind === "plane") {
    const c = M.len3(M.cross3(M.unit3(a.n), M.unit3(b.n)));
    return c <= 1e-9 && Math.abs(M.dot3(M.sub3(b.p, a.p), M.unit3(a.n))) <= tol;
  }
  if (a.kind === "cyl" && b.kind === "cyl") {
    const ua = M.unit3(a.axis);
    if (M.len3(M.cross3(ua, M.unit3(b.axis))) > 1e-9) return false;
    const w = M.sub3(b.p, a.p);
    const off = M.len3(M.cross3(w, ua));
    return off <= tol && Math.abs(a.r - b.r) <= tol;
  }
  return false;
}

/** Aresta escolhida no viewport → aresta do grafo (aba + chave), pelos rótulos das duas faces vizinhas. */
export function edgeFromFaces(labelsA: readonly string[], labelsB: readonly string[]): { flange: string; edge: string } | null | "ambigua" {
  const hits = new Set<string>();
  const probe = (plane: readonly string[], side: readonly string[]) => {
    for (const p of plane) {
      const [f, r] = splitLabel(p);
      if (r !== "A" && r !== "B") continue;
      for (const q of side) {
        const [g, e] = splitLabel(q);
        if (g === f && e.startsWith("e:")) hits.add(`${f}\u0000${e.slice(2)}`);
      }
    }
  };
  probe(labelsA, labelsB);
  probe(labelsB, labelsA);
  if (hits.size === 0) return null;
  if (hits.size > 1) return "ambigua";
  const [f, e] = [...hits][0].split("\u0000");
  return { flange: f, edge: e };
}
