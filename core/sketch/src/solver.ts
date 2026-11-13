import { type Constraint, type Id, type Sketch, type SEntity, BUILTIN_ENTITIES, BUILTIN_POINTS, CONSTRAINT_LABEL, constraintRefs, entityOf, entityPoints } from "./types";

/**
 * Solver de restrições do esboço.
 *
 * Método: Newton com passo de NORMA MÍNIMA (dx = −Jᵀ(JJᵀ+λI)⁻¹F) e busca linear. O passo de norma mínima move o
 * mínimo possível as variáveis livres — ao mudar uma cota, o resto do desenho fica onde estava (comportamento
 * esperado em CAD). Jacobiano por diferenças finitas centrais, só nas variáveis de cada equação.
 *
 * Diagnóstico (no ponto resolvido):
 * - graus de liberdade = nº de variáveis − posto(J);
 * - variáveis livres pelo espaço nulo de J (pontos sub-definidos para colorir);
 * - restrições redundantes pela construção incremental da base das linhas de J;
 * - inconsistência quando não converge; conflitos = restrições cuja remoção permite convergir.
 */

export type SketchStatus = "full" | "under" | "over" | "inconsistent" | "unsolved" | "empty";

export const STATUS_LABEL: Record<SketchStatus, string> = {
  full: "Totalmente definido",
  under: "Subdefinido",
  over: "Sobredefinido (restrição redundante)",
  inconsistent: "Inconsistente",
  unsolved: "Não convergiu",
  empty: "Vazio",
};

export interface SolveResult {
  readonly sketch: Sketch;
  readonly status: SketchStatus;
  /** graus de liberdade restantes */
  readonly dof: number;
  readonly freePoints: ReadonlySet<Id>;
  /** restrições redundantes (consistentes, mas desnecessárias) */
  readonly redundant: readonly Id[];
  /** restrições em conflito (inconsistente) */
  readonly conflicts: readonly Id[];
  readonly iterations: number;
  /** maior resíduo final (mm ou rad) */
  readonly residual: number;
  readonly message: string;
}

interface Eq {
  readonly cid: Id;
  readonly vars: readonly number[];
  readonly f: (x: Float64Array) => number;
}

interface System {
  readonly n: number;
  readonly x0: Float64Array;
  readonly eqs: Eq[];
  readonly pointVar: ReadonlyMap<Id, number>;
  readonly radiusVar: ReadonlyMap<Id, number>;
  readonly errors: string[];
}

const hyp = Math.hypot;

/** Monta variáveis e equações. Restrições mal formadas (referência inexistente) viram erro de validação. */
function build(s: Sketch, extra: readonly Constraint[] = []): System {
  const pointVar = new Map<Id, number>();
  const radiusVar = new Map<Id, number>();
  const x0: number[] = [];
  for (const p of Object.values(s.points)) {
    pointVar.set(p.id, x0.length);
    x0.push(p.x, p.y);
  }
  for (const e of Object.values(s.entities)) {
    if (e.t === "circle") {
      radiusVar.set(e.id, x0.length);
      x0.push(e.r);
    }
  }
  const errors: string[] = [];
  const P = (id: Id): ((x: Float64Array) => [number, number]) | null => {
    const v = pointVar.get(id);
    if (v !== undefined) return (x) => [x[v], x[v + 1]];
    const b = BUILTIN_POINTS[id];
    if (b) return () => [b.x, b.y];
    return null;
  };
  const pvars = (id: Id): number[] => {
    const v = pointVar.get(id);
    return v === undefined ? [] : [v, v + 1];
  };
  const ent = (id: Id): SEntity | null => entityOf(s, id) ?? null;
  const line = (id: Id) => {
    const e = ent(id);
    if (e?.t !== "line") return null;
    const a = P(e.p1);
    const b = P(e.p2);
    if (!a || !b) return null;
    return { a, b, vars: [...pvars(e.p1), ...pvars(e.p2)] };
  };
  /** círculo/arco: centro e raio */
  const circ = (id: Id) => {
    const e = ent(id);
    if (e?.t === "circle") {
      const c = P(e.c);
      const rv = radiusVar.get(e.id)!;
      if (!c) return null;
      return { c, r: (x: Float64Array) => x[rv], vars: [...pvars(e.c), rv] };
    }
    if (e?.t === "arc") {
      const c = P(e.c);
      const p1 = P(e.p1);
      if (!c || !p1) return null;
      return {
        c,
        r: (x: Float64Array) => {
          const [cx, cy] = c(x);
          const [px, py] = p1(x);
          return hyp(px - cx, py - cy);
        },
        vars: [...pvars(e.c), ...pvars(e.p1)],
      };
    }
    return null;
  };
  const eqs: Eq[] = [];
  const add = (cid: Id, vars: number[], f: (x: Float64Array) => number) => eqs.push({ cid, vars: [...new Set(vars)], f });
  const dir = (l: NonNullable<ReturnType<typeof line>>, x: Float64Array): [number, number] => {
    const [ax, ay] = l.a(x);
    const [bx, by] = l.b(x);
    return [bx - ax, by - ay];
  };
  const X0 = Float64Array.from(x0);
  /** lado escolhido pela geometria inicial (equações com módulo viram equações com sinal: deriváveis em 0) */
  const side = (v: number) => (v < 0 ? -1 : 1);

  // implícito: as duas pontas de um arco estão no mesmo raio
  for (const e of Object.values(s.entities)) {
    if (e.t !== "arc") continue;
    const c = P(e.c);
    const p1 = P(e.p1);
    const p2 = P(e.p2);
    if (!c || !p1 || !p2) {
      errors.push(`Arco ${e.id} com ponto inexistente.`);
      continue;
    }
    add(`__arc:${e.id}`, [...pvars(e.c), ...pvars(e.p1), ...pvars(e.p2)], (x) => {
      const [cx, cy] = c(x);
      const [ax, ay] = p1(x);
      const [bx, by] = p2(x);
      return hyp(bx - cx, by - cy) - hyp(ax - cx, ay - cy);
    });
  }

  const bad = (c: Constraint, why: string) => errors.push(`Restrição ${c.id}: ${why}`);
  for (const c of [...s.constraints, ...extra]) {
    switch (c.t) {
      case "coincident": {
        const a = P(c.a);
        const b = P(c.b);
        if (!a || !b) {
          bad(c, "ponto inexistente");
          break;
        }
        const v = [...pvars(c.a), ...pvars(c.b)];
        add(c.id, v, (x) => a(x)[0] - b(x)[0]);
        add(c.id, v, (x) => a(x)[1] - b(x)[1]);
        break;
      }
      case "fixed": {
        const a = P(c.p);
        if (!a) {
          bad(c, "ponto inexistente");
          break;
        }
        add(c.id, pvars(c.p), (x) => a(x)[0] - c.x);
        add(c.id, pvars(c.p), (x) => a(x)[1] - c.y);
        break;
      }
      case "pointOnLine":
      case "midpoint":
      case "pointLineDistance": {
        const p = P(c.p);
        const l = line(c.l);
        if (!p || !l) {
          bad(c, "ponto ou linha inexistente");
          break;
        }
        const v = [...pvars(c.p), ...l.vars];
        if (c.t === "midpoint") {
          add(c.id, v, (x) => p(x)[0] - (l.a(x)[0] + l.b(x)[0]) / 2);
          add(c.id, v, (x) => p(x)[1] - (l.a(x)[1] + l.b(x)[1]) / 2);
          break;
        }
        const val = c.t === "pointLineDistance" ? c.v : 0;
        const cross = (x: Float64Array) => {
          const [dx, dy] = dir(l, x);
          const [ax, ay] = l.a(x);
          const [px, py] = p(x);
          return (dx * (py - ay) - dy * (px - ax)) / Math.max(hyp(dx, dy), 1e-12);
        };
        // distância com sinal do lado inicial (|d| não é derivável em 0 → Jacobiano nulo e falso "redundante")
        const sg = side(cross(X0));
        add(c.id, v, (x) => (c.t === "pointLineDistance" ? sg * cross(x) - val : cross(x)));
        break;
      }
      case "pointOnCircle": {
        const p = P(c.p);
        const k = circ(c.c);
        if (!p || !k) {
          bad(c, "ponto ou círculo inexistente");
          break;
        }
        add(c.id, [...pvars(c.p), ...k.vars], (x) => {
          const [px, py] = p(x);
          const [cx, cy] = k.c(x);
          return hyp(px - cx, py - cy) - k.r(x);
        });
        break;
      }
      case "horizontal":
      case "vertical": {
        const l = line(c.l);
        if (!l) {
          bad(c, "linha inexistente");
          break;
        }
        const i = c.t === "horizontal" ? 1 : 0;
        add(c.id, l.vars, (x) => l.b(x)[i] - l.a(x)[i]);
        break;
      }
      case "parallel":
      case "perpendicular": {
        const a = line(c.a);
        const b = line(c.b);
        if (!a || !b) {
          bad(c, "exige duas linhas");
          break;
        }
        add(c.id, [...a.vars, ...b.vars], (x) => {
          const [ux, uy] = dir(a, x);
          const [vx, vy] = dir(b, x);
          const n = Math.max(hyp(ux, uy) * hyp(vx, vy), 1e-12);
          return c.t === "parallel" ? (ux * vy - uy * vx) / n : (ux * vx + uy * vy) / n;
        });
        break;
      }
      case "angle": {
        const a = line(c.a);
        const b = line(c.b);
        if (!a || !b) {
          bad(c, "exige duas linhas");
          break;
        }
        const target = (c.v * Math.PI) / 180;
        const theta = (x: Float64Array) => {
          const [ux, uy] = dir(a, x);
          const [vx, vy] = dir(b, x);
          return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
        };
        // ângulo com sinal (sentido da geometria inicial) e resíduo reduzido a (−π, π]: contínuo e derivável
        // em 0° e 180° (|atan2| tinha derivada nula/descontínua ali)
        const sg = side(theta(X0));
        add(c.id, [...a.vars, ...b.vars], (x) => wrapPi(sg * theta(x) - target));
        break;
      }
      case "tangent": {
        const la = line(c.a);
        const lb = line(c.b);
        const ca = circ(c.a);
        const cb = circ(c.b);
        if (la && cb) addLineCircleTangent(c.id, la, cb);
        else if (lb && ca) addLineCircleTangent(c.id, lb, ca);
        else if (ca && cb)
          add(c.id, [...ca.vars, ...cb.vars], (x) => {
            const [ax, ay] = ca.c(x);
            const [bx, by] = cb.c(x);
            const d = hyp(bx - ax, by - ay);
            return c.inner ? d - Math.abs(ca.r(x) - cb.r(x)) : d - (ca.r(x) + cb.r(x));
          });
        else bad(c, "tangência exige linha/arco/círculo com arco/círculo");
        break;
      }
      case "concentric": {
        const a = circ(c.a);
        const b = circ(c.b);
        if (!a || !b) {
          bad(c, "exige círculos/arcos");
          break;
        }
        const v = [...a.vars, ...b.vars];
        add(c.id, v, (x) => a.c(x)[0] - b.c(x)[0]);
        add(c.id, v, (x) => a.c(x)[1] - b.c(x)[1]);
        break;
      }
      case "equal": {
        const la = line(c.a);
        const lb = line(c.b);
        const ca = circ(c.a);
        const cb = circ(c.b);
        if (la && lb)
          add(c.id, [...la.vars, ...lb.vars], (x) => {
            const [ux, uy] = dir(la, x);
            const [vx, vy] = dir(lb, x);
            return hyp(ux, uy) - hyp(vx, vy);
          });
        else if (ca && cb) add(c.id, [...ca.vars, ...cb.vars], (x) => ca.r(x) - cb.r(x));
        else bad(c, "igualdade exige duas linhas ou dois círculos/arcos");
        break;
      }
      case "distance":
      case "distanceX":
      case "distanceY": {
        const a = P(c.a);
        const b = P(c.b);
        if (!a || !b) {
          bad(c, "ponto inexistente");
          break;
        }
        const v = [...pvars(c.a), ...pvars(c.b)];
        if (c.t === "distance") add(c.id, v, (x) => hyp(b(x)[0] - a(x)[0], b(x)[1] - a(x)[1]) - c.v);
        // cotas horizontais/verticais com sinal (b à direita/acima de a), como no SolidWorks
        else if (c.t === "distanceX") add(c.id, v, (x) => b(x)[0] - a(x)[0] - c.v);
        else add(c.id, v, (x) => b(x)[1] - a(x)[1] - c.v);
        break;
      }
      case "length": {
        const l = line(c.l);
        if (!l) {
          bad(c, "linha inexistente");
          break;
        }
        add(c.id, l.vars, (x) => {
          const [dx, dy] = dir(l, x);
          return hyp(dx, dy) - c.v;
        });
        break;
      }
      case "radius":
      case "diameter": {
        const k = circ(c.c);
        if (!k) {
          bad(c, "círculo/arco inexistente");
          break;
        }
        const val = c.t === "radius" ? c.v : c.v / 2;
        add(c.id, k.vars, (x) => k.r(x) - val);
        break;
      }
    }
  }
  return { n: x0.length, x0: Float64Array.from(x0), eqs, pointVar, radiusVar, errors };

  function addLineCircleTangent(cid: Id, l: NonNullable<ReturnType<typeof line>>, k: NonNullable<ReturnType<typeof circ>>) {
    const crossAt = (x: Float64Array) => {
      const [dx, dy] = dir(l, x);
      const [ax, ay] = l.a(x);
      const [cx, cy] = k.c(x);
      return dx * (cy - ay) - dy * (cx - ax);
    };
    const sg = side(crossAt(X0));
    add(cid, [...l.vars, ...k.vars], (x) => {
      const [dx, dy] = dir(l, x);
      const [ax, ay] = l.a(x);
      const [cx, cy] = k.c(x);
      return sg * ((dx * (cy - ay) - dy * (cx - ax)) / Math.max(hyp(dx, dy), 1e-12)) - k.r(x);
    });
  }
}

/* ------------------------------------------------------------------------------- álgebra */

function residuals(sys: System, x: Float64Array, F: Float64Array) {
  for (let i = 0; i < sys.eqs.length; i++) F[i] = sys.eqs[i].f(x);
}

function jacobian(sys: System, x: Float64Array, J: Float64Array) {
  const n = sys.n;
  J.fill(0);
  for (let i = 0; i < sys.eqs.length; i++) {
    const eq = sys.eqs[i];
    for (const v of eq.vars) {
      const old = x[v];
      const h = 1e-7 * Math.max(1, Math.abs(old));
      x[v] = old + h;
      const fp = eq.f(x);
      x[v] = old - h;
      const fm = eq.f(x);
      x[v] = old;
      J[i * n + v] = (fp - fm) / (2 * h);
    }
  }
}

/** Resolve A·y = b (A m×m) por eliminação de Gauss com pivotamento parcial. */
function solveDense(A: Float64Array, b: Float64Array, m: number): Float64Array | null {
  const a = A.slice();
  const y = b.slice();
  for (let k = 0; k < m; k++) {
    let p = k;
    for (let i = k + 1; i < m; i++) if (Math.abs(a[i * m + k]) > Math.abs(a[p * m + k])) p = i;
    if (Math.abs(a[p * m + k]) < 1e-300) return null;
    if (p !== k) {
      for (let j = 0; j < m; j++) [a[k * m + j], a[p * m + j]] = [a[p * m + j], a[k * m + j]];
      [y[k], y[p]] = [y[p], y[k]];
    }
    const piv = a[k * m + k];
    for (let i = k + 1; i < m; i++) {
      const f = a[i * m + k] / piv;
      if (f === 0) continue;
      for (let j = k; j < m; j++) a[i * m + j] -= f * a[k * m + j];
      y[i] -= f * y[k];
    }
  }
  for (let k = m - 1; k >= 0; k--) {
    let s = y[k];
    for (let j = k + 1; j < m; j++) s -= a[k * m + j] * y[j];
    y[k] = s / a[k * m + k];
  }
  return y;
}

const maxAbs = (v: Float64Array) => {
  let m = 0;
  for (const x of v) m = Math.max(m, Math.abs(x));
  return m;
};

function wrapPi(a: number): number {
  const t = a % (2 * Math.PI);
  return t > Math.PI ? t - 2 * Math.PI : t <= -Math.PI ? t + 2 * Math.PI : t;
}

/**
 * Tolerância do resíduo: 1e-9 (mm/rad), mas nunca abaixo do que o double resolve na escala do desenho
 * (8·ε·|x|max): em coordenadas de 1e7 mm o erro de arredondamento já passa de 1e-9.
 */
const TOL0 = 1e-9;
const tolFor = (x: Float64Array) => {
  let S = 1;
  for (const v of x) S = Math.max(S, Math.abs(v));
  return Math.max(TOL0, 8 * 2.220446049250313e-16 * S);
};

function newton(sys: System, x: Float64Array, maxIter = 60): { converged: boolean; iterations: number; residual: number } {
  const TOL = tolFor(x);
  const m = sys.eqs.length;
  const n = sys.n;
  if (!m) return { converged: true, iterations: 0, residual: 0 };
  const F = new Float64Array(m);
  const Ft = new Float64Array(m);
  const J = new Float64Array(m * n);
  const A = new Float64Array(m * m);
  residuals(sys, x, F);
  let err = maxAbs(F);
  let it = 0;
  for (; it < maxIter && err > TOL; it++) {
    jacobian(sys, x, J);
    // A = J Jᵀ + λI (λ pequeno, relativo à escala; torna o passo bem definido com equações redundantes)
    let diag = 0;
    for (let i = 0; i < m; i++)
      for (let k = 0; k <= i; k++) {
        let s = 0;
        const ri = i * n;
        const rk = k * n;
        for (let j = 0; j < n; j++) s += J[ri + j] * J[rk + j];
        A[i * m + k] = s;
        A[k * m + i] = s;
        if (i === k) diag = Math.max(diag, s);
      }
    const lam = 1e-12 * Math.max(diag, 1);
    for (let i = 0; i < m; i++) A[i * m + i] += lam;
    const y = solveDense(A, F, m);
    if (!y) break;
    const dx = new Float64Array(n);
    for (let i = 0; i < m; i++) {
      const yi = y[i];
      if (yi === 0) continue;
      const ri = i * n;
      for (let j = 0; j < n; j++) dx[j] -= J[ri + j] * yi;
    }
    // busca linear (meia passada até reduzir o resíduo)
    let alpha = 1;
    const xs = x.slice();
    let improved = false;
    for (let k = 0; k < 12; k++) {
      for (let j = 0; j < n; j++) x[j] = xs[j] + alpha * dx[j];
      residuals(sys, x, Ft);
      const e = maxAbs(Ft);
      if (e < err || e <= TOL) {
        err = e;
        F.set(Ft);
        improved = true;
        break;
      }
      alpha /= 2;
    }
    if (!improved) {
      x.set(xs);
      break;
    }
  }
  return { converged: err <= 10 * TOL, iterations: it, residual: err };
}

/**
 * Newton + reinícios determinísticos: um ponto inicial degenerado (ex.: dois pontos coincidentes com cota de
 * distância — o Jacobiano é nulo ali) não é inconsistência. Perturba as variáveis numa fração da escala do
 * desenho com sementes fixas (resultado reproduzível) e tenta de novo.
 */
function newtonRobust(sys: System, x: Float64Array): ReturnType<typeof newton> & { restarts: number } {
  const x0 = x.slice();
  let r = newton(sys, x);
  if (r.converged) return { ...r, restarts: 0 };
  let S = 1;
  for (const v of x0) S = Math.max(S, Math.abs(v));
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296) * 2 - 1;
  for (let k = 1; k <= 3; k++) {
    const amp = S * 1e-3 * k;
    for (let j = 0; j < x.length; j++) x[j] = x0[j] + amp * rnd();
    r = newton(sys, x);
    if (r.converged) return { ...r, restarts: k };
  }
  x.set(x0);
  return { ...newton(sys, x), restarts: 3 };
}

/** Mínimos quadrados (Gauss-Newton amortecido) a partir de x: |Jᵀ F| ≈ 0 com resíduo > tol ⇒ sem solução local. */
function stationaryResidual(sys: System, x: Float64Array): { residual: number; grad: number } {
  const m = sys.eqs.length;
  const n = sys.n;
  const F = new Float64Array(m);
  const J = new Float64Array(m * n);
  const y = x.slice();
  let lam = 1e-3;
  residuals(sys, y, F);
  let f2 = F.reduce((s, v) => s + v * v, 0);
  for (let it = 0; it < 80; it++) {
    jacobian(sys, y, J);
    const g = new Float64Array(n);
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) g[j] += J[i * n + j] * F[i];
    const H = new Float64Array(n * n);
    for (let i = 0; i < m; i++)
      for (const a of sys.eqs[i].vars) for (const b of sys.eqs[i].vars) H[a * n + b] += J[i * n + a] * J[i * n + b];
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const A = H.slice();
      for (let j = 0; j < n; j++) A[j * n + j] += lam * (1 + H[j * n + j]);
      const d = solveDense(A, g, n);
      if (!d) break;
      const t = y.slice();
      for (let j = 0; j < n; j++) t[j] -= d[j];
      const Ft = new Float64Array(m);
      residuals(sys, t, Ft);
      const ft2 = Ft.reduce((s, v) => s + v * v, 0);
      if (ft2 < f2) {
        y.set(t);
        F.set(Ft);
        f2 = ft2;
        lam = Math.max(lam / 3, 1e-12);
        improved = true;
      } else lam *= 4;
    }
    if (!improved) break;
  }
  jacobian(sys, y, J);
  const g = new Float64Array(n);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) g[j] += J[i * n + j] * F[i];
  return { residual: Math.sqrt(f2), grad: Math.sqrt(g.reduce((s, v) => s + v * v, 0)) };
}

/** Posto, variáveis livres e restrições redundantes no ponto x. */
function analyze(sys: System, x: Float64Array) {
  const m = sys.eqs.length;
  const n = sys.n;
  const J = new Float64Array(m * n);
  jacobian(sys, x, J);
  let scale = 0;
  for (const v of J) scale = Math.max(scale, Math.abs(v));
  const tol = 1e-7 * Math.max(1, scale);
  // base ortonormal incremental das linhas (Gram-Schmidt modificado, 2 passes)
  const basis: Float64Array[] = [];
  const redundantEq = new Set<number>();
  for (let i = 0; i < m; i++) {
    const r = J.slice(i * n, (i + 1) * n);
    for (let pass = 0; pass < 2; pass++)
      for (const b of basis) {
        let d = 0;
        for (let j = 0; j < n; j++) d += r[j] * b[j];
        for (let j = 0; j < n; j++) r[j] -= d * b[j];
      }
    let nr = 0;
    for (let j = 0; j < n; j++) nr += r[j] * r[j];
    nr = Math.sqrt(nr);
    if (nr > tol) {
      for (let j = 0; j < n; j++) r[j] /= nr;
      basis.push(r);
    } else redundantEq.add(i);
  }
  const rank = basis.length;
  // variável livre ⇔ tem componente fora do espaço das linhas (projeção do eixo da variável no complemento)
  const free = new Set<number>();
  for (let v = 0; v < n; v++) {
    let inRow = 0;
    for (const b of basis) inRow += b[v] * b[v];
    if (1 - inRow > 1e-8) free.add(v);
  }
  return { rank, free, redundantEq };
}

function apply(s: Sketch, sys: System, x: Float64Array): Sketch {
  const points: Record<Id, (typeof s.points)[string]> = {};
  for (const [id, p] of Object.entries(s.points)) {
    const v = sys.pointVar.get(id)!;
    points[id] = { ...p, x: clean(x[v]), y: clean(x[v + 1]) };
  }
  const entities: Record<Id, SEntity> = {};
  for (const [id, e] of Object.entries(s.entities)) {
    entities[id] = e.t === "circle" ? { ...e, r: clean(x[sys.radiusVar.get(id)!]) } : e;
  }
  return { ...s, points, entities };
}

/** Arredonda ruído numérico (1e-12 mm) para cotas exatas como 500,000000000001 virarem 500. */
function clean(v: number): number {
  const r = Math.round(v * 1e9) / 1e9;
  return Math.abs(r - v) < 1e-10 ? (Object.is(r, -0) ? 0 : r) : v;
}

export interface SolveOptions {
  /** restrições temporárias (arrasto de ponto) */
  extra?: readonly Constraint[];
  /** não procurar conflitos (mais rápido durante arrasto) */
  skipConflictSearch?: boolean;
}

/** Resolve o esboço. Se for inconsistente, a geometria original é mantida (nunca aplica solução parcial). */
/** Nome legível de uma restrição para mensagens: "Comprimento 50 (D16)". */
export function describeConstraint(s: Sketch, id: Id): string {
  const c = s.constraints.find((k) => k.id === id);
  if (!c) return id;
  const v = "v" in c ? ` ${String(Number(c.v.toFixed(4))).replace(".", ",")}${c.t === "angle" ? "°" : ""}` : "";
  return `${CONSTRAINT_LABEL[c.t]}${v} (${id})`;
}

/**
 * Resolve o esboço por partes independentes (grupos de pontos ligados por entidades/restrições): cada grupo é
 * um sistema menor — mesmo resultado matemático, muito mais rápido em esboços grandes, e os conflitos ficam
 * localizados no grupo que falhou. Inconsistente/não convergido em qualquer grupo → nada é aplicado.
 */
export function solve(s: Sketch, opts: SolveOptions = {}): SolveResult {
  const parts = partition(s, opts.extra ?? []);
  if (parts.length <= 1) return solveOne(s, opts);
  let points = { ...s.points };
  let entities = { ...s.entities };
  let dof = 0;
  let iterations = 0;
  let residual = 0;
  const free = new Set<Id>();
  const red: Id[] = [];
  for (const part of parts) {
    const r = solveOne(part.sketch, { ...opts, extra: part.extra });
    if (r.status === "inconsistent" || r.status === "unsolved") return { ...r, sketch: s };
    if (r.status === "empty") continue;
    points = { ...points, ...r.sketch.points };
    entities = { ...entities, ...r.sketch.entities };
    dof += r.dof;
    iterations = Math.max(iterations, r.iterations);
    residual = Math.max(residual, r.residual);
    r.freePoints.forEach((p) => free.add(p));
    red.push(...r.redundant);
  }
  const status: SketchStatus = red.length ? "over" : dof === 0 ? "full" : "under";
  const msg =
    status === "over"
      ? `Restrição redundante: ${red.map((c) => describeConstraint(s, c)).join(", ")} (já determinada pelas outras).`
      : status === "full"
        ? "Totalmente definido."
        : `Subdefinido: ${dof} grau(s) de liberdade.`;
  return result({ ...s, points, entities }, status, dof, free, red, [], iterations, residual, msg);
}

/** Grupos independentes: union-find sobre pontos (entidade une seus pontos; restrição une o que referencia). */
function partition(s: Sketch, extra: readonly Constraint[]): { sketch: Sketch; extra: Constraint[] }[] {
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let x = a;
    while (parent.get(x) !== r) {
      const nx = parent.get(x)!;
      parent.set(x, r);
      x = nx;
    }
    return r;
  };
  const isFixed = (id: Id) => id in BUILTIN_POINTS || id in BUILTIN_ENTITIES;
  for (const id of Object.keys(s.points)) parent.set(id, id);
  const unite = (ids: Id[]) => {
    const ok = ids.filter((i) => parent.has(i));
    for (let i = 1; i < ok.length; i++) {
      const a = find(ok[0]);
      const b = find(ok[i]);
      if (a !== b) parent.set(b, a);
    }
  };
  const ptsOfRef = (id: Id): Id[] => {
    if (isFixed(id)) return [];
    if (s.points[id]) return [id];
    const e = s.entities[id];
    return e ? entityPoints(e) : ["__missing"];
  };
  for (const e of Object.values(s.entities)) unite(entityPoints(e));
  const all = [...s.constraints, ...extra];
  for (const c of all) {
    const pts = constraintRefs(c).flatMap(ptsOfRef);
    if (pts.includes("__missing")) return [{ sketch: s, extra: [...extra] }]; // referência quebrada: um sistema só reporta
    unite(pts);
  }
  const groups = new Map<Id, { points: Set<Id>; entities: Set<Id>; cons: Constraint[]; extra: Constraint[] }>();
  const g = (root: Id) => {
    let x = groups.get(root);
    if (!x) groups.set(root, (x = { points: new Set(), entities: new Set(), cons: [], extra: [] }));
    return x;
  };
  for (const id of Object.keys(s.points)) g(find(id)).points.add(id);
  for (const e of Object.values(s.entities)) {
    const ps = entityPoints(e);
    if (ps.length) g(find(ps[0])).entities.add(e.id);
  }
  const home = (c: Constraint) => {
    const pts = constraintRefs(c).flatMap(ptsOfRef);
    return pts.length ? find(pts[0]) : null;
  };
  for (const c of s.constraints) {
    const h = home(c);
    if (h === null) return [{ sketch: s, extra: [...extra] }]; // restrição só entre referências fixas: deixa o solver único avaliar
    g(h).cons.push(c);
  }
  for (const c of extra) {
    const h = home(c);
    if (h !== null) g(h).extra.push(c);
  }
  const out: { sketch: Sketch; extra: Constraint[] }[] = [];
  for (const grp of groups.values()) {
    const points: Record<Id, Sketch["points"][string]> = {};
    for (const id of grp.points) points[id] = s.points[id];
    const entities: Record<Id, SEntity> = {};
    for (const id of grp.entities) entities[id] = s.entities[id];
    out.push({ sketch: { ...s, points, entities, constraints: grp.cons }, extra: grp.extra });
  }
  return out;
}

function solveOne(s: Sketch, opts: SolveOptions = {}): SolveResult {
  const sys = build(s, opts.extra);
  if (sys.errors.length) return fail(s, sys, sys.errors[0], []);
  if (!sys.n && !Object.keys(s.entities).length) return result(s, "empty", 0, new Set(), [], [], 0, 0, "Esboço vazio.");
  const x = sys.x0.slice();
  const r = newtonRobust(sys, x);
  if (!r.converged) {
    // Inconsistência comprovada: remover uma restrição torna o sistema solúvel, ou o mínimo dos quadrados é
    // estacionário com resíduo — sem solução local. Caso contrário é falha NUMÉRICA de convergência.
    const conflicts = opts.skipConflictSearch ? [] : findConflicts(s, opts.extra);
    const st = conflicts.length ? null : stationaryResidual(sys, x);
    const proven = conflicts.length > 0 || (st !== null && st.residual > 1e3 * tolFor(x) && st.grad < 1e-6 * Math.max(1, st.residual));
    if (!proven)
      return result(s, "unsolved", 0, new Set(), [], [], r.iterations, r.residual, "O solver não convergiu a partir desta posição (falha numérica, não conflito comprovado) — aproxime a geometria da forma desejada e tente de novo.");
    const names = conflicts.length ? ` Em conflito: ${conflicts.map((c) => describeConstraint(s, c)).join(", ")}.` : "";
    return result(s, "inconsistent", 0, new Set(), [], conflicts, r.iterations, r.residual, `Restrições inconsistentes — não existe geometria que satisfaça todas.${names}`);
  }
  const a = analyze(sys, x);
  const dof = sys.n - a.rank;
  const freePoints = new Set<Id>();
  for (const [id, v] of sys.pointVar) if (a.free.has(v) || a.free.has(v + 1)) freePoints.add(id);
  for (const [id, v] of sys.radiusVar) if (a.free.has(v)) freePoints.add(id);
  const red = [...new Set([...a.redundantEq].map((i) => sys.eqs[i].cid).filter((c) => !c.startsWith("__")))];
  const status: SketchStatus = red.length ? "over" : dof === 0 ? "full" : "under";
  const msg =
    status === "over"
      ? `Restrição redundante: ${red.map((c) => describeConstraint(s, c)).join(", ")} (já determinada pelas outras).`
      : status === "full"
        ? "Totalmente definido."
        : `Subdefinido: ${dof} grau(s) de liberdade.`;
  return result(apply(s, sys, x), status, dof, freePoints, red, [], r.iterations, r.residual, msg);
}

function result(sketch: Sketch, status: SketchStatus, dof: number, freePoints: Set<Id>, redundant: Id[], conflicts: Id[], iterations: number, residual: number, message: string): SolveResult {
  return { sketch, status, dof, freePoints, redundant, conflicts, iterations, residual, message };
}
function fail(s: Sketch, _sys: System, message: string, conflicts: Id[]): SolveResult {
  return result(s, "inconsistent", 0, new Set(), [], conflicts, 0, Infinity, message);
}

/** Restrições cuja remoção torna o sistema solúvel (diagnóstico; até 80 restrições). */
function findConflicts(s: Sketch, extra?: readonly Constraint[]): Id[] {
  if (s.constraints.length > 80) return [];
  const out: Id[] = [];
  for (const c of s.constraints) {
    const test: Sketch = { ...s, constraints: s.constraints.filter((k) => k.id !== c.id) };
    const sys = build(test, extra);
    if (sys.errors.length) continue;
    const x = sys.x0.slice();
    if (newtonRobust(sys, x).converged) out.push(c.id);
  }
  return out;
}

/** Arrasta um ponto até `to` respeitando as restrições (o ponto vai o mais perto possível). */
export function drag(s: Sketch, pointId: Id, to: { x: number; y: number }): SolveResult {
  const pin: Constraint = { id: "__drag", t: "fixed", p: pointId, x: to.x, y: to.y };
  const r = solve(s, { extra: [pin], skipConflictSearch: true });
  if (r.status !== "inconsistent") return { ...r, ...solveAfterDrag(r.sketch) };
  return solve(s, { skipConflictSearch: true });
}
function solveAfterDrag(s: Sketch): Pick<SolveResult, "status" | "dof" | "freePoints" | "redundant" | "message"> {
  const r = solve(s, { skipConflictSearch: true });
  return { status: r.status, dof: r.dof, freePoints: r.freePoints, redundant: r.redundant, message: r.message };
}
