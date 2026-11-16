/**
 * P-F5-01 — normalização do ponto de partida dos laços de faces de revolução que fecham num polo.
 *
 * CAUSA RAIZ (docs/P-F5-01_CAUSA_RAIZ.md): o tradutor STEP → B-rep do OCCT (StepToTopoDS_TranslateEdgeLoop e o
 * reparo de pcurves/arestas que vem em seguida) perde a aresta de costura de uma face sobre
 * SURFACE_OF_REVOLUTION que fecha num polo (geratriz tocando o eixo — tampo elíptico, calota) quando o laço
 * (EDGE_LOOP) começa por um ponto que NÃO é o polo. A face fica só com o círculo da borda, a faixa V colapsa,
 * a área vai a zero e o sólido sai inválido (vessel_revolved: volume −28,47 %). Reproduzido no occt-wasm 5.17.1
 * e 5.17.2 e no OCCT nativo 7.8.1 e 8.0.1; independe do modo de pcurve, da precisão do vértice, do sentido da
 * aresta e da parametrização. O mesmo laço iniciado no polo é lido exatamente.
 *
 * CORREÇÃO: um EDGE_LOOP é uma lista CÍCLICA (ISO 10303-42, edge_loop): o elemento por onde a lista começa não
 * tem significado geométrico nem topológico. Aqui, só para faces de revolução com costura que toca o eixo,
 * a lista é girada para começar pela passagem da costura que SAI do polo. Nenhuma coordenada, curva, superfície,
 * parâmetro, orientação ou entidade é criada, alterada ou removida — só a ordem cíclica da lista de referências.
 * O B-rep continua sendo o do OCCT (exato). O arquivo original não é tocado: a normalização é feita numa cópia
 * em memória, entregue ao leitor.
 *
 * SEGUNDO CASO (mesma classe, achado na suíte): face de revolução limitada SÓ por VERTEX_LOOP cuja geratriz é uma
 * cônica fechada (círculo/elipse) com centro sobre o eixo — elipsoide/esfera de revolução numa face só (o próprio
 * OCCT grava assim). O leitor aplica os limites naturais da superfície: a cônica inteira gira, as duas metades
 * (uma de cada lado do eixo) geram a mesma superfície duas vezes, com normais opostas, e o volume se anula
 * (medido: −53 mm³ para 56 548 667,8 mm³) — com o verificador de forma APROVANDO. Correção: a face passa a apontar
 * para uma cópia da SURFACE_OF_REVOLUTION cuja geratriz é a MESMA cônica recortada (TRIMMED_CURVE, por parâmetro)
 * entre os dois pontos onde ela cruza o eixo — meia cônica, calculada analiticamente. A superfície continua sendo o
 * mesmo conjunto de pontos (a outra metade gerava pontos repetidos). Só com ângulo plano em radiano (senão: pula).
 *
 * Entrada não confiável: nada é executado; entidades que não se consegue interpretar são ignoradas (o laço fica
 * como veio e a verificação de forma do motor continua acusando, se for o caso).
 */
import { type Arg, indexEntities, parseBody } from "./part21";

export interface PoleLoopFix {
  /** #id da ADVANCED_FACE / FACE_SURFACE */
  readonly face: number;
  /** #id do EDGE_LOOP girado */
  readonly loop: number;
  /** #id da EDGE_CURVE de costura que toca o eixo */
  readonly seam: number;
  /** quantas posições a lista foi girada */
  readonly shift: number;
}

/** Face de revolução limitada por VERTEX_LOOP cuja geratriz foi recortada à meia cônica (segundo caso). */
export interface HalfConicFix {
  readonly face: number;
  /** SURFACE_OF_REVOLUTION original (não é alterada) */
  readonly surface: number;
  /** novas entidades: cópia da superfície e TRIMMED_CURVE */
  readonly newSurface: number;
  readonly trimmed: number;
  /** parâmetros do recorte (rad) */
  readonly t0: number;
  readonly t1: number;
}

export interface PoleNormalization {
  /** texto entregue ao leitor (idêntico ao original se nada mudou) */
  readonly text: string;
  readonly fixes: readonly PoleLoopFix[];
  readonly halfConics: readonly HalfConicFix[];
  /** laços com polo que não foram mexidos e por quê (diagnóstico, não erro) */
  readonly skipped: readonly string[];
  /** faces de revolução com polo encontradas (corrigidas + já no formato certo + puladas) */
  readonly poleFaces: number;
}

type V3 = readonly [number, number, number];

/** Distância relativa abaixo da qual o vértice é considerado sobre o eixo: d_polo / d_borda < 1e-6. */
export const POLE_REL_TOL = 1e-6;

export function normalizeRevolutionPoleLoops(text: string): PoleNormalization {
  const same: PoleNormalization = { text, fixes: [], halfConics: [], skipped: [], poleFaces: 0 };
  // atalho barato: sem superfície de revolução não há o que normalizar
  if (!text.includes("SURFACE_OF_REVOLUTION")) return same;
  const dataAt = text.search(/\bDATA\s*;/);
  if (dataAt < 0) return same;
  const idx = indexEntities(text, dataAt);
  const cache = new Map<number, { type: string; args: Arg[] } | null>();
  const ent = (id: number) => {
    if (cache.has(id)) return cache.get(id)!;
    const r = idx.get(id);
    let v: { type: string; args: Arg[] } | null = null;
    if (r) {
      try {
        const parts = parseBody(text.slice(r[0], r[1]));
        if (parts.length === 1) v = parts[0]; // entidades complexas ficam de fora (não são o caso tratado)
      } catch {
        v = null;
      }
    }
    cache.set(id, v);
    return v;
  };
  const ref = (a: Arg | undefined) => (a && a.t === "ref" ? a.v : null);
  const nums = (a: Arg | undefined): number[] | null => (a && a.t === "list" && a.v.every((x) => x.t === "num") ? a.v.map((x) => (x as { v: number }).v) : null);
  const point = (id: number | null): V3 | null => {
    const e = id === null ? null : ent(id);
    if (!e || e.type !== "CARTESIAN_POINT") return null;
    const c = nums(e.args[1]);
    return c && c.length === 3 && c.every(Number.isFinite) ? [c[0], c[1], c[2]] : null;
  };
  const direction = (id: number | null): V3 | null => {
    const e = id === null ? null : ent(id);
    if (!e || e.type !== "DIRECTION") return null;
    const c = nums(e.args[1]);
    return c && c.length === 3 && c.every(Number.isFinite) ? [c[0], c[1], c[2]] : null;
  };
  const vertexPoint = (id: number | null): V3 | null => {
    const e = id === null ? null : ent(id);
    return e && e.type === "VERTEX_POINT" ? point(ref(e.args[1])) : null;
  };
  const distToAxis = (p: V3, o: V3, d: V3) => {
    const w = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const c = [w[1] * d[2] - w[2] * d[1], w[2] * d[0] - w[0] * d[2], w[0] * d[1] - w[1] * d[0]];
    return Math.hypot(c[0], c[1], c[2]) / Math.hypot(d[0], d[1], d[2]);
  };

  const fixes: PoleLoopFix[] = [];
  const halfConics: HalfConicFix[] = [];
  const appended: string[] = [];
  let nextId = 0;
  for (const id of idx.keys()) nextId = Math.max(nextId, id);
  nextId++;
  // ângulo plano do arquivo: o recorte é escrito em radiano; com outra unidade o segundo caso é pulado
  const radians = /PLANE_ANGLE_UNIT\s*\(\s*\)\s*SI_UNIT\s*\(\s*\$\s*,\s*\.RADIAN\.\s*\)/i.test(text) && !/CONVERSION_BASED_UNIT[^;]*PLANE_ANGLE_UNIT|PLANE_ANGLE_UNIT[^;]*CONVERSION_BASED_UNIT/i.test(text);
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const real = (x: number) => {
    const t = Number(x).toPrecision(17);
    return /[.eE]/.test(t) ? t.replace(/e/, "E") : t + ".";
  };
  /** VERTEX_LOOP único numa face de revolução com geratriz cônica fechada centrada no eixo → meia cônica. */
  const halfConic = (faceId: number, surfId: number, swept: number | null, o: V3, d: V3): void => {
    const c = swept === null ? null : ent(swept);
    if (!c || (c.type !== "CIRCLE" && c.type !== "ELLIPSE")) return;
    const pl = ent(ref(c.args[1]) ?? -1);
    if (!pl || pl.type !== "AXIS2_PLACEMENT_3D") return;
    const C = point(ref(pl.args[1]));
    const N0 = pl.args[2]?.t === "null" ? ([0, 0, 1] as V3) : direction(ref(pl.args[2]));
    const X0 = pl.args[3]?.t === "null" ? null : direction(ref(pl.args[3]));
    const a = c.args[2]?.t === "num" ? c.args[2].v : NaN;
    const b = c.type === "ELLIPSE" ? (c.args[3]?.t === "num" ? c.args[3].v : NaN) : a;
    if (!C || !N0 || !(a > 0) || !(b > 0)) return;
    const N = unit(N0);
    const du = unit(d);
    // referência X: projeção de ref_direction no plano da cônica (ISO 10303-42); sem ela, X arbitrário ⟂ N
    let X: V3;
    if (X0) {
      const k = dot(X0, N);
      X = unit([X0[0] - k * N[0], X0[1] - k * N[1], X0[2] - k * N[2]]);
    } else X = unit(Math.abs(N[0]) < 0.9 ? cross(N, [1, 0, 0]) : cross(N, [0, 1, 0]));
    const Y = cross(N, X);
    const size = Math.max(a, b);
    // a cônica precisa estar num plano que contém o eixo e ter o centro sobre o eixo
    if (Math.abs(dot(N, du)) > 1e-9 || distToAxis(C, o, du) / size > POLE_REL_TOL) {
      skipped.push(`#${faceId}: VERTEX_LOOP em revolução de ${c.type} fora do eixo — mantido (limites naturais do leitor).`);
      return;
    }
    if (!radians) {
      skipped.push(`#${faceId}: VERTEX_LOOP em revolução — ângulo plano do arquivo não é radiano; recorte não aplicado.`);
      return;
    }
    // P(t) − C = a·cos t·X + b·sin t·Y ; sobre o eixo ⇔ (P − C) × d = 0 ⇔ a·cos t·(X×d)·N + b·sin t·(Y×d)·N = 0
    const al = dot(cross(X, du), N), be = dot(cross(Y, du), N);
    const t0 = Math.atan2(-a * al, b * be);
    const t1 = t0 + Math.PI;
    const tId = nextId++, sId = nextId++;
    const surfRange = idx.get(surfId)!;
    const surfBody = text.slice(surfRange[0], surfRange[1]);
    // cópia da superfície trocando só a referência da geratriz (1º #id depois do nome)
    const m = /^(\s*SURFACE_OF_REVOLUTION\s*\(\s*'(?:[^']|'')*'\s*,\s*)#\d+/.exec(surfBody);
    if (!m) {
      nextId -= 2;
      skipped.push(`#${faceId}: SURFACE_OF_REVOLUTION #${surfId} em formato inesperado — mantido.`);
      return;
    }
    appended.push(`#${tId}=TRIMMED_CURVE('',#${swept},(PARAMETER_VALUE(${real(t0)})),(PARAMETER_VALUE(${real(t1)})),.T.,.PARAMETER.);`);
    appended.push(`#${sId}=${m[1].replace(/^\s*/, "")}#${tId}${surfBody.slice(m[0].length)};`);
    const fr = idx.get(faceId)!;
    const fb = text.slice(fr[0], fr[1]);
    // troca a referência da superfície na face (3º argumento) — reconstrói pela estrutura já interpretada
    const fm = new RegExp(`#${surfId}(\\s*,\\s*\\.[TF]\\.\\s*\\)\\s*)$`).exec(fb);
    if (!fm) {
      appended.length -= 2;
      nextId -= 2;
      skipped.push(`#${faceId}: ADVANCED_FACE em formato inesperado — mantida.`);
      return;
    }
    edits.push({ start: fr[0], end: fr[1], body: fb.slice(0, fm.index) + `#${sId}` + fm[1] });
    halfConics.push({ face: faceId, surface: surfId, newSurface: sId, trimmed: tId, t0, t1 });
  };
  const skipped: string[] = [];
  const edits: { start: number; end: number; body: string }[] = [];
  const done = new Set<number>();
  let poleFaces = 0;

  for (const [faceId, r] of idx) {
    // filtro textual antes de interpretar
    let s = r[0];
    while (s < r[1] && /\s/.test(text[s])) s++;
    if (!text.startsWith("ADVANCED_FACE", s) && !text.startsWith("FACE_SURFACE", s)) continue;
    const face = ent(faceId);
    if (!face || (face.type !== "ADVANCED_FACE" && face.type !== "FACE_SURFACE")) continue;
    const surf = ent(ref(face.args[2]) ?? -1);
    if (!surf || surf.type !== "SURFACE_OF_REVOLUTION") continue;
    const axis = ent(ref(surf.args[2]) ?? -1);
    if (!axis || axis.type !== "AXIS1_PLACEMENT") continue;
    const o = point(ref(axis.args[1]));
    const d = axis.args[2]?.t === "null" ? ([0, 0, 1] as V3) : direction(ref(axis.args[2]));
    if (!o || !d || !(Math.hypot(...d) > 0)) continue;
    const bounds = face.args[1]?.t === "list" ? face.args[1].v : [];
    let faceHasPole = false;
    if (bounds.length === 1) {
      const fb0 = ent(ref(bounds[0]) ?? -1);
      const vl = fb0 && (fb0.type === "FACE_BOUND" || fb0.type === "FACE_OUTER_BOUND") ? ent(ref(fb0.args[1]) ?? -1) : null;
      if (vl && vl.type === "VERTEX_LOOP") {
        poleFaces++;
        halfConic(faceId, ref(face.args[2])!, ref(surf.args[1]), o, d);
        continue;
      }
    }
    for (const b of bounds) {
      const fb = ent(ref(b) ?? -1);
      if (!fb || (fb.type !== "FACE_BOUND" && fb.type !== "FACE_OUTER_BOUND")) continue;
      const loopId = ref(fb.args[1]);
      const loop = loopId === null ? null : ent(loopId);
      if (!loop || loop.type !== "EDGE_LOOP" || loop.args[1]?.t !== "list") continue;
      const items = loop.args[1].v;
      const oes = items.map((a) => {
        const oeId = ref(a);
        const oe = oeId === null ? null : ent(oeId);
        if (!oe || oe.type !== "ORIENTED_EDGE") return null;
        const ecId = ref(oe.args[3]);
        const ec = ecId === null ? null : ent(ecId);
        const or = oe.args[4];
        if (!ec || ec.type !== "EDGE_CURVE" || !or || or.t !== "enum") return null;
        return { oeId: oeId!, ecId: ecId!, fwd: or.v === "T", vs: ref(ec.args[1]), ve: ref(ec.args[2]) };
      });
      if (oes.some((x) => x === null) || oes.length < 2) continue;
      const list = oes as NonNullable<(typeof oes)[number]>[];
      // costura = mesma EDGE_CURVE usada duas vezes no laço
      const count = new Map<number, number>();
      for (const x of list) count.set(x.ecId, (count.get(x.ecId) ?? 0) + 1);
      const seams = [...count].filter(([, n]) => n === 2).map(([id]) => id);
      const poles: { seam: number; pole: number }[] = [];
      let twoPoles = false;
      for (const sid of seams) {
        const x = list.find((y) => y.ecId === sid)!;
        const ps = vertexPoint(x.vs);
        const pe = vertexPoint(x.ve);
        if (!ps || !pe || x.vs === null || x.ve === null) continue;
        const ds = distToAxis(ps, o, d);
        const de = distToAxis(pe, o, d);
        const big = Math.max(ds, de);
        if (!(big > 0)) {
          twoPoles = true;
          continue;
        }
        const sOn = ds / big < POLE_REL_TOL;
        const eOn = de / big < POLE_REL_TOL;
        if (sOn && eOn) twoPoles = true;
        else if (sOn) poles.push({ seam: sid, pole: x.vs });
        else if (eOn) poles.push({ seam: sid, pole: x.ve });
      }
      if (!poles.length && !twoPoles) continue;
      faceHasPole = true;
      if (twoPoles || poles.length !== 1) {
        skipped.push(`#${faceId}/#${loopId}: costura com ${twoPoles ? "polo nas duas pontas" : `${poles.length} polos`} — laço mantido como veio.`);
        continue;
      }
      const { seam, pole } = poles[0];
      // passagem da costura que sai do polo: orientação .T. começa em edge_start; .F. começa em edge_end
      const j = list.findIndex((x) => x.ecId === seam && (x.fwd ? x.vs : x.ve) === pole);
      if (j < 0) {
        skipped.push(`#${faceId}/#${loopId}: costura #${seam} não passa pelo vértice do polo #${pole} — laço mantido.`);
        continue;
      }
      if (j === 0 || done.has(loopId!)) continue;
      // reescreve SÓ a lista de referências do EDGE_LOOP (mesmos elementos, girados)
      const lr = idx.get(loopId!)!;
      const body = text.slice(lr[0], lr[1]);
      const m = /\(\s*#\d+(?:\s*,\s*#\d+)*\s*\)(\s*\)\s*)$/.exec(body);
      if (!m) {
        skipped.push(`#${faceId}/#${loopId}: lista do laço em formato inesperado — laço mantido.`);
        continue;
      }
      const refs = list.map((x) => x.oeId);
      const rot = [...refs.slice(j), ...refs.slice(0, j)];
      const nb = body.slice(0, m.index) + "(" + rot.map((n) => `#${n}`).join(",") + ")" + m[1];
      edits.push({ start: lr[0], end: lr[1], body: nb });
      done.add(loopId!);
      fixes.push({ face: faceId, loop: loopId!, seam, shift: j });
    }
    if (faceHasPole) poleFaces++;
  }
  if (!edits.length) return { text, fixes, halfConics, skipped, poleFaces };
  // novas entidades entram no fim da seção DATA (depois da última entidade)
  if (appended.length) {
    let last = 0;
    for (const r of idx.values()) last = Math.max(last, r[1]);
    const endsec = text.indexOf("ENDSEC", last);
    if (endsec < 0) return { text, fixes: [], halfConics: [], skipped: [...skipped, "seção DATA sem ENDSEC — nada alterado."], poleFaces };
    edits.push({ start: endsec, end: endsec, body: appended.join("\n") + "\n" });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.body + out.slice(e.end);
  return { text: out, fixes, halfConics, skipped, poleFaces };
}
