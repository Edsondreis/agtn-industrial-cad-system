/**
 * Primitivas paramétricas do AGTN 3D. Especificações puras (serializáveis), validação com mensagens em pt-BR e
 * seção dos perfis estruturais. A construção no kernel fica em `occt.ts`.
 *
 * Convenção de posição local (antes do Placement):
 * - caixa: canto em (0,0,0), largura X, profundidade Y, altura Z;
 * - cilindro, cone, tubo: base centrada na origem, eixo +Z;
 * - esfera, toro: centro na origem (toro no plano XY);
 * - plano: retângulo no plano XY com canto na origem (superfície, sem volume);
 * - perfil estrutural: seção no plano XY (ver `profileSection`), extrudado em +Z pelo comprimento.
 */

export type ProfileSpec =
  /** cantoneira de abas a (Y) e b (X), espessura t; canto externo na origem */
  | { readonly shape: "L"; readonly a: number; readonly b: number; readonly t: number }
  /** perfil U: alma de altura h (Y) em x∈[0,tw]; abas de largura b (X) e espessura tf */
  | { readonly shape: "U"; readonly h: number; readonly b: number; readonly tw: number; readonly tf: number }
  /** perfil I/W: altura h, mesas de largura b e espessura tf, alma tw, centrado em X */
  | { readonly shape: "I"; readonly h: number; readonly b: number; readonly tw: number; readonly tf: number }
  /** tubo retangular/quadrado: largura b (X), altura h (Y), parede t; canto na origem */
  | { readonly shape: "RHS"; readonly b: number; readonly h: number; readonly t: number }
  /** barra chata: largura b (X) e espessura t (Y) */
  | { readonly shape: "FLAT"; readonly b: number; readonly t: number };

export type PrimitiveSpec =
  | { readonly kind: "box"; readonly w: number; readonly d: number; readonly h: number }
  | { readonly kind: "cylinder"; readonly r: number; readonly h: number }
  | { readonly kind: "sphere"; readonly r: number }
  /** r1 = raio da base, r2 = raio do topo (0 = cone pontudo) */
  | { readonly kind: "cone"; readonly r1: number; readonly r2: number; readonly h: number }
  /** R = raio maior (centro do tubo), r = raio menor */
  | { readonly kind: "torus"; readonly R: number; readonly r: number }
  | { readonly kind: "plane"; readonly w: number; readonly d: number }
  /** tubo redondo: diâmetro externo, parede, comprimento */
  | { readonly kind: "tube"; readonly od: number; readonly t: number; readonly h: number }
  | { readonly kind: "profile"; readonly profile: ProfileSpec; readonly length: number };

export type PrimitiveKind = PrimitiveSpec["kind"];

export const PRIMITIVE_LABEL: Record<PrimitiveKind, string> = {
  box: "Caixa",
  cylinder: "Cilindro",
  sphere: "Esfera",
  cone: "Cone",
  torus: "Toro",
  plane: "Plano",
  tube: "Tubo",
  profile: "Perfil estrutural",
};

export const PROFILE_LABEL: Record<ProfileSpec["shape"], string> = {
  L: "Cantoneira L",
  U: "Perfil U",
  I: "Perfil I/W",
  RHS: "Tubo retangular",
  FLAT: "Barra chata",
};

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Valida uma especificação. Retorna a lista de erros (vazia = válida). Mensagens prontas para o usuário. */
export function validatePrimitive(s: PrimitiveSpec): string[] {
  const e: string[] = [];
  const pos = (v: number, name: string) => {
    if (!fin(v)) e.push(`${name}: valor inválido.`);
    else if (v <= 0) e.push(`${name} deve ser maior que zero.`);
  };
  switch (s.kind) {
    case "box":
      pos(s.w, "Largura (X)");
      pos(s.d, "Profundidade (Y)");
      pos(s.h, "Altura (Z)");
      break;
    case "cylinder":
      pos(s.r, "Raio");
      pos(s.h, "Altura");
      break;
    case "sphere":
      pos(s.r, "Raio");
      break;
    case "cone":
      pos(s.h, "Altura");
      if (!fin(s.r1) || !fin(s.r2) || s.r1 < 0 || s.r2 < 0) e.push("Raios do cone não podem ser negativos.");
      else if (s.r1 === 0 && s.r2 === 0) e.push("Pelo menos um raio do cone deve ser maior que zero.");
      else if (Math.abs(s.r1 - s.r2) < 1e-9) e.push("Raios iguais: use um cilindro.");
      break;
    case "torus":
      pos(s.R, "Raio maior");
      pos(s.r, "Raio menor");
      if (fin(s.R) && fin(s.r) && s.r >= s.R) e.push("O raio menor deve ser menor que o raio maior.");
      break;
    case "plane":
      pos(s.w, "Largura (X)");
      pos(s.d, "Profundidade (Y)");
      break;
    case "tube":
      pos(s.od, "Diâmetro externo");
      pos(s.t, "Parede");
      pos(s.h, "Comprimento");
      if (fin(s.od) && fin(s.t) && 2 * s.t >= s.od) e.push("A parede deve ser menor que o raio externo (2·t < Ø).");
      break;
    case "profile":
      pos(s.length, "Comprimento");
      e.push(...validateProfile(s.profile));
      break;
    default:
      e.push("Tipo de primitiva desconhecido.");
  }
  return e;
}

export function validateProfile(p: ProfileSpec): string[] {
  const e: string[] = [];
  const pos = (v: number, name: string) => {
    if (!fin(v)) e.push(`${name}: valor inválido.`);
    else if (v <= 0) e.push(`${name} deve ser maior que zero.`);
  };
  switch (p.shape) {
    case "L":
      pos(p.a, "Aba a");
      pos(p.b, "Aba b");
      pos(p.t, "Espessura");
      if (p.t >= p.a || p.t >= p.b) e.push("A espessura deve ser menor que as abas.");
      break;
    case "U":
      pos(p.h, "Altura");
      pos(p.b, "Aba");
      pos(p.tw, "Espessura da alma");
      pos(p.tf, "Espessura da aba");
      if (2 * p.tf >= p.h) e.push("Abas se sobrepõem: 2·tf deve ser menor que a altura.");
      if (p.tw >= p.b) e.push("A alma deve ser mais fina que a largura da aba.");
      break;
    case "I":
      pos(p.h, "Altura");
      pos(p.b, "Largura da mesa");
      pos(p.tw, "Espessura da alma");
      pos(p.tf, "Espessura da mesa");
      if (2 * p.tf >= p.h) e.push("Mesas se sobrepõem: 2·tf deve ser menor que a altura.");
      if (p.tw >= p.b) e.push("A alma deve ser mais fina que a mesa.");
      break;
    case "RHS":
      pos(p.b, "Largura");
      pos(p.h, "Altura");
      pos(p.t, "Parede");
      if (2 * p.t >= Math.min(p.b, p.h)) e.push("Parede grande demais: 2·t deve ser menor que o menor lado.");
      break;
    case "FLAT":
      pos(p.b, "Largura");
      pos(p.t, "Espessura");
      break;
    default:
      e.push("Perfil desconhecido.");
  }
  return e;
}

export interface Pt2 {
  readonly x: number;
  readonly y: number;
}

/** Seção de um perfil: contorno externo (CCW) e, se houver, um furo (CCW também; o kernel subtrai). */
export interface Section {
  readonly outer: readonly Pt2[];
  readonly hole: readonly Pt2[] | null;
}

const P = (x: number, y: number): Pt2 => ({ x, y });

/** Geometria exata da seção (cantos vivos; raios de laminação não modelados). */
export function profileSection(p: ProfileSpec): Section {
  switch (p.shape) {
    case "L":
      return { outer: [P(0, 0), P(p.b, 0), P(p.b, p.t), P(p.t, p.t), P(p.t, p.a), P(0, p.a)], hole: null };
    case "U":
      return {
        outer: [P(0, 0), P(p.b, 0), P(p.b, p.tf), P(p.tw, p.tf), P(p.tw, p.h - p.tf), P(p.b, p.h - p.tf), P(p.b, p.h), P(0, p.h)],
        hole: null,
      };
    case "I": {
      const hb = p.b / 2;
      const hw = p.tw / 2;
      return {
        outer: [
          P(-hb, 0), P(hb, 0), P(hb, p.tf), P(hw, p.tf), P(hw, p.h - p.tf), P(hb, p.h - p.tf), P(hb, p.h),
          P(-hb, p.h), P(-hb, p.h - p.tf), P(-hw, p.h - p.tf), P(-hw, p.tf), P(-hb, p.tf),
        ],
        hole: null,
      };
    }
    case "RHS":
      return {
        outer: [P(0, 0), P(p.b, 0), P(p.b, p.h), P(0, p.h)],
        hole: [P(p.t, p.t), P(p.b - p.t, p.t), P(p.b - p.t, p.h - p.t), P(p.t, p.h - p.t)],
      };
    case "FLAT":
      return { outer: [P(0, 0), P(p.b, 0), P(p.b, p.t), P(0, p.t)], hole: null };
  }
}

/** Área de polígono (shoelace), positiva para CCW. */
export function polygonArea(pts: readonly Pt2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Área líquida da seção (mm²) — usada para peso linear e conferência do sólido. */
export function sectionArea(p: ProfileSpec): number {
  const s = profileSection(p);
  return Math.abs(polygonArea(s.outer)) - (s.hole ? Math.abs(polygonArea(s.hole)) : 0);
}

/** Nome curto para árvore/BOM, ex.: "Perfil U 100×50×6×8 L=1500". */
export function describePrimitive(s: PrimitiveSpec): string {
  const n = (v: number) => String(Math.round(v * 1000) / 1000).replace(".", ",");
  switch (s.kind) {
    case "box":
      return `Caixa ${n(s.w)}×${n(s.d)}×${n(s.h)}`;
    case "cylinder":
      return `Cilindro Ø${n(2 * s.r)}×${n(s.h)}`;
    case "sphere":
      return `Esfera Ø${n(2 * s.r)}`;
    case "cone":
      return `Cone Ø${n(2 * s.r1)}/Ø${n(2 * s.r2)}×${n(s.h)}`;
    case "torus":
      return `Toro R${n(s.R)} r${n(s.r)}`;
    case "plane":
      return `Plano ${n(s.w)}×${n(s.d)}`;
    case "tube":
      return `Tubo Ø${n(s.od)}×${n(s.t)} L=${n(s.h)}`;
    case "profile": {
      const p = s.profile;
      const dims =
        p.shape === "L" ? `${n(p.a)}×${n(p.b)}×${n(p.t)}`
        : p.shape === "U" || p.shape === "I" ? `${n(p.h)}×${n(p.b)}×${n(p.tw)}×${n(p.tf)}`
        : p.shape === "RHS" ? `${n(p.b)}×${n(p.h)}×${n(p.t)}`
        : `${n(p.b)}×${n(p.t)}`;
      return `${PROFILE_LABEL[p.shape]} ${dims} L=${n(s.length)}`;
    }
  }
}
