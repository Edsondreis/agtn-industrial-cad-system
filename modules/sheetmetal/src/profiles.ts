import type { BendDir, BendInput, Face, FlangeInput, ProfileInput } from "./engine";
import { deg } from "./bend";
import type { BendProcess, MaterialId, ValueSource } from "./materials";

/** Referência dimensional exibida ao usuário. */
export type DimRef = "externa" | "interna";

/** Parâmetros de uma dobra no configurador. */
export interface BendParams {
  /** θ — ângulo de dobra (deflexão). A UI pode receber o ângulo interno e converter. */
  angleDeg: number;
  R: number;
  K: number;
  /** origem do K: manual, estimado (tabela padrão), calibrado (tabela da fábrica) */
  kSource: ValueSource;
  kRuleId: string | null;
}

export interface DimParam {
  value: number;
  ref: DimRef;
}

export interface FabricationParams {
  material: MaterialId;
  process: BendProcess;
  toolName: string;
  vOpening: number | null;
  punchRadius: number | null;
  kTableId: string;
}

export type ProfileKind = "L" | "U" | "U_ENRIJECIDO";

export interface ProfileParams {
  kind: ProfileKind;
  T: number;
  partLength: number;
  /** Abas na ordem de percurso (veja `PROFILE_DEFS[kind].flangeLabels`) */
  dims: DimParam[];
  bends: BendParams[];
  fab: FabricationParams;
}

export interface ProfileDef {
  kind: ProfileKind;
  name: string;
  description: string;
  flangeLabels: string[];
  bendLabels: string[];
  /** índice da aba que fica horizontal no desenho da seção */
  baseIndex: number;
  /** sentido de cada dobra (todas iguais nos perfis abertos L/U) */
  dirs: BendDir[];
  defaults: () => Omit<ProfileParams, "fab">;
}

const bend = (angleDeg = 90, R = 3, K = 0.43): BendParams => ({ angleDeg, R, K, kSource: "manual", kRuleId: null });

/**
 * Registro de perfis. Novos perfis (Z, C, cartola, ômega...) entram aqui:
 * basta declarar abas, dobras e sentidos — o motor genérico resolve qualquer sequência
 * de abas e dobras, inclusive com sentidos alternados (ex.: Z = left, right).
 */
export const PROFILE_DEFS: Record<ProfileKind, ProfileDef> = {
  L: {
    kind: "L",
    name: "Perfil L (cantoneira)",
    description: "Uma dobra. Aba vertical + aba horizontal.",
    flangeLabels: ["Aba vertical", "Aba horizontal"],
    bendLabels: ["Dobra 1"],
    baseIndex: 1,
    dirs: ["left"],
    defaults: () => ({
      kind: "L",
      T: 3,
      partLength: 1000,
      dims: [
        { value: 80, ref: "externa" },
        { value: 100, ref: "externa" },
      ],
      bends: [bend(90, 3, 0.4)],
    }),
  },
  U: {
    kind: "U",
    name: "Perfil U",
    description: "Duas dobras. Abas podem ter alturas, raios e ângulos diferentes.",
    flangeLabels: ["Aba 1 (altura)", "Base (largura)", "Aba 2 (altura)"],
    bendLabels: ["Dobra 1", "Dobra 2"],
    baseIndex: 1,
    dirs: ["left", "left"],
    defaults: () => ({
      kind: "U",
      T: 3,
      partLength: 1000,
      dims: [
        { value: 50, ref: "externa" },
        { value: 100, ref: "externa" },
        { value: 50, ref: "externa" },
      ],
      bends: [bend(), bend()],
    }),
  },
  U_ENRIJECIDO: {
    kind: "U_ENRIJECIDO",
    name: "Perfil U enrijecido",
    description: "Quatro dobras. U com abas de retorno (enrijecedores) nas extremidades.",
    flangeLabels: ["Enrijecedor 1", "Aba 1 (altura)", "Base (largura)", "Aba 2 (altura)", "Enrijecedor 2"],
    bendLabels: ["Dobra 1 (enrijecedor)", "Dobra 2", "Dobra 3", "Dobra 4 (enrijecedor)"],
    baseIndex: 2,
    dirs: ["left", "left", "left", "left"],
    defaults: () => ({
      kind: "U_ENRIJECIDO",
      T: 2,
      partLength: 1000,
      dims: [
        { value: 15, ref: "externa" },
        { value: 50, ref: "externa" },
        { value: 100, ref: "externa" },
        { value: 50, ref: "externa" },
        { value: 15, ref: "externa" },
      ],
      bends: [bend(90, 2), bend(90, 2), bend(90, 2), bend(90, 2)],
    }),
  },
};

/**
 * Converte a referência do usuário em face do modelo.
 * Nos perfis abertos (todas as dobras no mesmo sentido "left"), a face interna é a face A
 * e a externa é a face B. Para perfis com sentidos alternados, a definição do perfil deve
 * mapear cada dimensão explicitamente.
 */
export function refToFace(ref: DimRef, dirs: BendDir[]): Face {
  const allLeft = dirs.every((d) => d === "left");
  const allRight = dirs.every((d) => d === "right");
  if (allLeft) return ref === "interna" ? "A" : "B";
  if (allRight) return ref === "interna" ? "B" : "A";
  throw new Error("Perfil com dobras em sentidos alternados requer mapeamento explícito de faces.");
}

/** Monta a entrada do motor a partir dos parâmetros do configurador. */
export function buildProfileInput(p: ProfileParams): ProfileInput {
  const def = PROFILE_DEFS[p.kind];
  if (p.dims.length !== def.flangeLabels.length || p.bends.length !== def.bendLabels.length)
    throw new Error(`Parâmetros incompatíveis com ${def.name}.`);
  const flanges: FlangeInput[] = p.dims.map((d, i) => ({
    label: def.flangeLabels[i],
    length: d.value,
    face: refToFace(d.ref, def.dirs),
  }));
  const bends: BendInput[] = p.bends.map((b, j) => ({
    label: def.bendLabels[j],
    angleDeg: b.angleDeg,
    R: b.R,
    K: b.K,
    dir: def.dirs[j],
  }));
  // direção inicial: faz a aba "base" ficar horizontal (+X)
  let start = 0;
  for (let j = 0; j < def.baseIndex; j++) start -= (def.dirs[j] === "left" ? 1 : -1) * deg(p.bends[j].angleDeg || 0);
  return { T: p.T, flanges, bends, startAngle: start, partLength: p.partLength };
}
