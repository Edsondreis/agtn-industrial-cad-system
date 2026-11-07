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

export type ProfileKind = "L" | "U" | "U_ENRIJECIDO" | "Z" | "Z_ENRIJECIDO" | "CARTOLA" | "OMEGA";

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
  /** rótulo curto do botão */
  short: string;
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
 * Registro de perfis. Basta declarar abas, dobras e sentidos — o motor genérico resolve qualquer
 * sequência de abas e dobras, inclusive com sentidos alternados (Z, cartola, ômega).
 */
export const PROFILE_DEFS: Record<ProfileKind, ProfileDef> = {
  L: {
    kind: "L",
    name: "Perfil L (cantoneira)",
    short: "Perfil L",
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
    short: "Perfil U",
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
    name: "Perfil C (U enrijecido, Ue)",
    short: "C / U enrij.",
    description: "Quatro dobras. U com abas de retorno (enrijecedores) nas extremidades — o \"perfil C\" de terças e travessas.",
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
  Z: {
    kind: "Z",
    name: "Perfil Z",
    short: "Perfil Z",
    description: "Duas dobras em sentidos opostos. Abas paralelas, uma para cada lado da alma.",
    flangeLabels: ["Aba 1", "Alma (altura)", "Aba 2"],
    bendLabels: ["Dobra 1", "Dobra 2"],
    baseIndex: 0,
    dirs: ["left", "right"],
    defaults: () => ({
      kind: "Z",
      T: 2,
      partLength: 1000,
      dims: [
        { value: 50, ref: "externa" },
        { value: 150, ref: "externa" },
        { value: 50, ref: "externa" },
      ],
      bends: [bend(90, 2), bend(90, 2)],
    }),
  },
  Z_ENRIJECIDO: {
    kind: "Z_ENRIJECIDO",
    name: "Perfil Z enrijecido (Ze)",
    short: "Z enrij.",
    description: "Quatro dobras. Z com enrijecedores nas abas — usado em terças de cobertura.",
    flangeLabels: ["Enrijecedor 1", "Aba 1", "Alma (altura)", "Aba 2", "Enrijecedor 2"],
    bendLabels: ["Dobra 1 (enrijecedor)", "Dobra 2", "Dobra 3", "Dobra 4 (enrijecedor)"],
    baseIndex: 1,
    dirs: ["left", "left", "right", "right"],
    defaults: () => ({
      kind: "Z_ENRIJECIDO",
      T: 2,
      partLength: 1000,
      dims: [
        { value: 17, ref: "externa" },
        { value: 60, ref: "externa" },
        { value: 200, ref: "externa" },
        { value: 60, ref: "externa" },
        { value: 17, ref: "externa" },
      ],
      bends: [bend(90, 2), bend(90, 2), bend(90, 2), bend(90, 2)],
    }),
  },
  CARTOLA: {
    kind: "CARTOLA",
    name: "Perfil cartola",
    short: "Cartola",
    description: "Quatro dobras a 90°. Topo, duas laterais e abas para fora (chapéu).",
    flangeLabels: ["Aba 1", "Lateral 1 (altura)", "Topo (largura)", "Lateral 2 (altura)", "Aba 2"],
    bendLabels: ["Dobra 1", "Dobra 2", "Dobra 3", "Dobra 4"],
    baseIndex: 0,
    dirs: ["left", "right", "right", "left"],
    defaults: () => ({
      kind: "CARTOLA",
      T: 2,
      partLength: 1000,
      dims: [
        { value: 25, ref: "externa" },
        { value: 50, ref: "externa" },
        { value: 50, ref: "externa" },
        { value: 50, ref: "externa" },
        { value: 25, ref: "externa" },
      ],
      bends: [bend(90, 2), bend(90, 2), bend(90, 2), bend(90, 2)],
    }),
  },
  OMEGA: {
    kind: "OMEGA",
    name: "Perfil ômega",
    short: "Ômega",
    description: "Cartola com laterais inclinadas (trapézio). Ângulo das dobras ajustável (padrão 60°).",
    flangeLabels: ["Aba 1", "Lateral 1 (inclinada)", "Topo (largura)", "Lateral 2 (inclinada)", "Aba 2"],
    bendLabels: ["Dobra 1", "Dobra 2", "Dobra 3", "Dobra 4"],
    baseIndex: 0,
    dirs: ["left", "right", "right", "left"],
    defaults: () => ({
      kind: "OMEGA",
      T: 2,
      partLength: 1000,
      dims: [
        { value: 25, ref: "externa" },
        { value: 60, ref: "externa" },
        { value: 50, ref: "externa" },
        { value: 60, ref: "externa" },
        { value: 25, ref: "externa" },
      ],
      bends: [bend(60, 2), bend(60, 2), bend(60, 2), bend(60, 2)],
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

/**
 * Faces medidas em cada ponta de uma aba. "Externa" = face de fora da dobra vizinha:
 * dobra "left" → face B por fora; "right" → face A por fora. Ponta livre usa a face da outra ponta.
 * Nos perfis com todas as dobras no mesmo sentido o resultado é igual ao de `refToFace`.
 */
export function flangeFaces(ref: DimRef, i: number, dirs: BendDir[]): [Face, Face] {
  const at = (d: BendDir): Face => {
    const outer: Face = d === "left" ? "B" : "A";
    return ref === "externa" ? outer : outer === "A" ? "B" : "A";
  };
  const before = i > 0 ? at(dirs[i - 1]) : null;
  const after = i < dirs.length ? at(dirs[i]) : null;
  return [before ?? after!, after ?? before!];
}

/** Monta a entrada do motor a partir dos parâmetros do configurador. */
export function buildProfileInput(p: ProfileParams): ProfileInput {
  const def = PROFILE_DEFS[p.kind];
  if (p.dims.length !== def.flangeLabels.length || p.bends.length !== def.bendLabels.length)
    throw new Error(`Parâmetros incompatíveis com ${def.name}.`);
  const flanges: FlangeInput[] = p.dims.map((d, i) => {
    const [face, faceEnd] = flangeFaces(d.ref, i, def.dirs);
    return { label: def.flangeLabels[i], length: d.value, face, faceEnd };
  });
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
