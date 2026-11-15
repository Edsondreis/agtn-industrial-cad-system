/**
 * Leitura leve do cabeçalho e das unidades de um arquivo STEP (ISO 10303-21), sem motor geométrico.
 *
 * FASE 5: a geometria é lida pelo OCCT (importStepTree, já homologado). Este módulo só responde o que o
 * OCCT não expõe ao app: qual unidade de comprimento o ARQUIVO declara (o leitor do OCCT converte tudo
 * para mm), o esquema (AP203/AP214/AP242), o sistema de origem e se o arquivo está íntegro (seções e
 * terminador). A lógica de unidades é a do `StepReader.readUnits/unitFactor` do agtn-cad-tank-viewer
 * (Kotlin, 9b4a917), portada para TypeScript: GLOBAL_UNIT_ASSIGNED_CONTEXT → LENGTH_UNIT → SI_UNIT
 * (prefixo + METRE) ou CONVERSION_BASED_UNIT (INCH, FOOT… com o fator de MEASURE_WITH_UNIT).
 *
 * O texto vem de arquivo externo: entrada não confiável. Nada aqui executa ou avalia conteúdo; limites de
 * tamanho/profundidade evitam travar com arquivo malformado.
 */

export interface StepUnit {
  /** símbolo: mm, cm, m, in, ft… (ou o nome declarado) */
  readonly name: string;
  /** quantos mm vale 1 unidade do arquivo */
  readonly toMm: number;
  /** como foi declarada */
  readonly source: "SI_UNIT" | "CONVERSION_BASED_UNIT";
}

export interface StepScan {
  /** começa com ISO-10303-21; */
  readonly valid: boolean;
  /** tem END-ISO-10303-21; (arquivo não truncado) */
  readonly complete: boolean;
  readonly schema: string | null;
  /** AP203 / AP214 / AP242 / outro, deduzido do esquema */
  readonly protocol: string | null;
  readonly fileName: string | null;
  readonly timestamp: string | null;
  readonly preprocessor: string | null;
  readonly originatingSystem: string | null;
  readonly entities: number;
  /** unidade de comprimento declarada pelo arquivo; null = não encontrada/não reconhecida */
  readonly length: StepUnit | null;
  /** fator ângulo → rad declarado (null = não encontrado) */
  readonly angleToRad: number | null;
  readonly warnings: readonly string[];
}

const SI_PREFIX: Record<string, number> = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1,
  DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12, FEMTO: 1e-15, ATTO: 1e-18,
};
const SI_SYMBOL: Record<string, string> = {
  EXA: "E", PETA: "P", TERA: "T", GIGA: "G", MEGA: "M", KILO: "k", HECTO: "h", DECA: "da",
  DECI: "d", CENTI: "c", MILLI: "m", MICRO: "µ", NANO: "n", PICO: "p", FEMTO: "f", ATTO: "a",
};

/** Valor de parâmetro Part 21 já tokenizado. */
type Arg = { t: "ref"; v: number } | { t: "str"; v: string } | { t: "enum"; v: string } | { t: "num"; v: number } | { t: "list"; v: Arg[] } | { t: "typed"; type: string; v: Arg[] } | { t: "null" };
interface Part {
  readonly type: string;
  readonly args: Arg[];
}

/** Índice id → trecho do corpo da entidade na seção DATA (não interpreta nada além de strings/comentários). */
function indexEntities(text: string, from: number): Map<number, [number, number]> {
  const idx = new Map<number, [number, number]>();
  const n = text.length;
  let i = from;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 35 /* # */) {
      let j = i + 1;
      let id = 0;
      while (j < n && text.charCodeAt(j) >= 48 && text.charCodeAt(j) <= 57) id = id * 10 + (text.charCodeAt(j++) - 48);
      while (j < n && /\s/.test(text[j])) j++;
      if (j < n && text[j] === "=" && j > i + 1) {
        const start = j + 1;
        let k = start;
        while (k < n) {
          const ch = text.charCodeAt(k);
          if (ch === 39 /* ' */) {
            k++;
            while (k < n) {
              if (text.charCodeAt(k) === 39) {
                if (text.charCodeAt(k + 1) === 39) k += 2;
                else break;
              } else k++;
            }
          } else if (ch === 47 /* / */ && text.charCodeAt(k + 1) === 42 /* * */) {
            const e = text.indexOf("*/", k + 2);
            k = e < 0 ? n : e + 1;
          } else if (ch === 59 /* ; */) break;
          k++;
        }
        idx.set(id, [start, k]);
        i = k + 1;
        continue;
      }
      i = j;
      continue;
    }
    if (c === 69 /* E */ && text.startsWith("ENDSEC", i)) break;
    if (c === 47 && text.charCodeAt(i + 1) === 42) {
      const e = text.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    i++;
  }
  return idx;
}

/** Tokeniza e interpreta o corpo de UMA entidade (simples ou complexa). Limite de profundidade 32. */
function parseBody(src: string): Part[] {
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src.startsWith("/*", i)) {
        const e = src.indexOf("*/", i + 2);
        i = e < 0 ? src.length : e + 2;
      } else return;
    }
  };
  const kw = () => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 128));
    if (!m) return null;
    i += m[0].length;
    return m[0].toUpperCase();
  };
  const list = (depth: number): Arg[] => {
    if (depth > 32) throw new Error("aninhamento excessivo");
    ws();
    if (src[i] !== "(") throw new Error("esperado (");
    i++;
    const out: Arg[] = [];
    ws();
    if (src[i] === ")") {
      i++;
      return out;
    }
    for (;;) {
      out.push(arg(depth));
      ws();
      if (src[i] === ",") {
        i++;
        continue;
      }
      if (src[i] === ")") {
        i++;
        return out;
      }
      throw new Error("esperado , ou )");
    }
  };
  const arg = (depth: number): Arg => {
    ws();
    const c = src[i];
    if (c === "#") {
      const m = /^#(\d+)/.exec(src.slice(i, i + 24));
      if (!m) throw new Error("referência inválida");
      i += m[0].length;
      return { t: "ref", v: Number(m[1]) };
    }
    if (c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'";
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      i = j + 1;
      return { t: "str", v: s };
    }
    if (c === ".") {
      const e = src.indexOf(".", i + 1);
      if (e < 0) throw new Error("enumeração sem fim");
      const v = src.slice(i + 1, e).toUpperCase();
      i = e + 1;
      return { t: "enum", v };
    }
    if (c === "$" || c === "*") {
      i++;
      return { t: "null" };
    }
    if (c === "(") return { t: "list", v: list(depth + 1) };
    const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i, i + 48));
    if (m) {
      i += m[0].length;
      return { t: "num", v: Number(m[0]) };
    }
    const k = kw();
    if (k) return { t: "typed", type: k, v: list(depth + 1) };
    throw new Error(`caractere inesperado "${c ?? "fim"}"`);
  };
  ws();
  const parts: Part[] = [];
  if (src[i] === "(") {
    // entidade complexa: ( A(...) B(...) ... )
    i++;
    for (;;) {
      ws();
      if (src[i] === ")") break;
      const t = kw();
      if (!t) throw new Error("entidade complexa malformada");
      parts.push({ type: t, args: list(1) });
    }
  } else {
    const t = kw();
    if (!t) throw new Error("entidade sem tipo");
    parts.push({ type: t, args: list(1) });
  }
  return parts;
}

const firstString = (text: string, key: string, limit = 4096): Arg[] | null => {
  const at = text.indexOf(key);
  if (at < 0) return null;
  const end = text.indexOf(";", at);
  try {
    return parseBody(text.slice(at, end < 0 ? Math.min(text.length, at + limit) : end))[0]?.args ?? null;
  } catch {
    return null;
  }
};
const str = (a: Arg | undefined) => (a && a.t === "str" ? a.v : null);
const strs = (a: Arg | undefined) => (a && a.t === "list" ? a.v.map(str).filter((s): s is string => s !== null) : []);

/** Limite de leitura do cabeçalho: o cabeçalho STEP fica nos primeiros KB. */
const HEADER_WINDOW = 64 * 1024;

export function scanStep(text: string): StepScan {
  const warnings: string[] = [];
  const head = text.slice(0, HEADER_WINDOW);
  const valid = /^﻿?\s*ISO-10303-21\s*;/.test(head);
  const tail = text.slice(Math.max(0, text.length - 4096));
  const complete = /END-ISO-10303-21\s*;\s*$/.test(tail);
  const empty: StepScan = { valid, complete, schema: null, protocol: null, fileName: null, timestamp: null, preprocessor: null, originatingSystem: null, entities: 0, length: null, angleToRad: null, warnings };
  if (!valid) {
    warnings.push("O arquivo não começa com ISO-10303-21; — não é um STEP (Part 21) válido.");
    return empty;
  }
  if (!complete) warnings.push("O arquivo não termina com END-ISO-10303-21; — pode estar truncado ou corrompido.");
  const hdrEnd = head.indexOf("ENDSEC");
  const header = hdrEnd > 0 ? head.slice(0, hdrEnd) : head;
  const fn = firstString(header, "FILE_NAME");
  const fs = firstString(header, "FILE_SCHEMA");
  const schema = strs(fs?.[0])[0] ?? null;
  const su = schema?.toUpperCase() ?? "";
  const protocol = !schema
    ? null
    : su.includes("AP242") || su.includes("MANAGED_MODEL_BASED_3D_ENGINEERING")
      ? "AP242"
      : su.includes("AUTOMOTIVE_DESIGN") || su.includes("AP214")
        ? "AP214"
        : su.includes("CONFIG_CONTROL_DESIGN") || su.includes("AP203")
          ? "AP203"
          : schema;
  const dataAt = text.search(/\bDATA\s*;/);
  if (dataAt < 0) {
    warnings.push("Seção DATA ausente — o arquivo não contém entidades.");
    return { ...empty, schema, protocol, fileName: str(fn?.[0]), timestamp: str(fn?.[1]), preprocessor: str(fn?.[4]), originatingSystem: str(fn?.[5]) };
  }
  const idx = indexEntities(text, dataAt);
  const cache = new Map<number, Part[] | null>();
  const entity = (id: number): Part[] | null => {
    if (cache.has(id)) return cache.get(id)!;
    const r = idx.get(id);
    let p: Part[] | null = null;
    if (r) {
      try {
        p = parseBody(text.slice(r[0], r[1]));
      } catch {
        p = null;
      }
    }
    cache.set(id, p);
    return p;
  };
  const part = (p: Part[] | null, t: string) => p?.find((x) => x.type === t) ?? null;

  const unitFactor = (p: Part[], kind: "LENGTH" | "ANGLE", depth: number): { f: number; name: string; source: StepUnit["source"] } | null => {
    if (depth > 8) return null;
    const si = part(p, "SI_UNIT");
    if (si) {
      const prefix = si.args[0]?.t === "enum" ? si.args[0].v : null;
      const name = si.args[1]?.t === "enum" ? si.args[1].v : null;
      const base = name === "METRE" ? (kind === "LENGTH" ? 1000 : null) : name === "RADIAN" ? (kind === "ANGLE" ? 1 : null) : name === "DEGREE" ? (kind === "ANGLE" ? Math.PI / 180 : null) : null;
      if (base === null) {
        warnings.push(`Unidade ${kind === "LENGTH" ? "de comprimento" : "de ângulo"} desconhecida (SI_UNIT ${name ?? "?"}): não usada.`);
        return null;
      }
      const pf = prefix === null ? 1 : SI_PREFIX[prefix];
      if (pf === undefined) {
        warnings.push(`Prefixo SI desconhecido "${prefix}" na unidade ${name?.toLowerCase()}: não usado.`);
        return null;
      }
      const sym = prefix ? (SI_SYMBOL[prefix] ?? "") : "";
      return { f: base * pf, name: name === "METRE" ? `${sym}m` : name === "RADIAN" ? `${sym}rad` : (name ?? "").toLowerCase(), source: "SI_UNIT" };
    }
    const cb = part(p, "CONVERSION_BASED_UNIT");
    if (cb) {
      const name = str(cb.args[0]) ?? "";
      const mwu = cb.args[1]?.t === "ref" ? entity(cb.args[1].v) : null;
      const m0 = mwu?.[0];
      let value: number | null = null;
      const v0 = m0?.args[0];
      if (v0?.t === "num") value = v0.v;
      else if (v0?.t === "typed" && v0.v[0]?.t === "num") value = v0.v[0].v; // LENGTH_MEASURE(25.4)
      if (value === null || !Number.isFinite(value) || value <= 0) {
        warnings.push(`Unidade convertida "${name}" sem fator válido: não usada.`);
        return null;
      }
      const baseRef = m0?.args[1];
      let baseF: number;
      if (baseRef?.t === "ref") {
        const bu = entity(baseRef.v);
        const r = bu ? unitFactor(bu, kind, depth + 1) : null;
        if (!r) return null;
        baseF = r.f;
      } else baseF = kind === "LENGTH" ? 1000 : 1;
      const label = ({ INCH: "in", FOOT: "ft", DEGREE: "°" } as Record<string, string>)[name.toUpperCase()] ?? name;
      return { f: value * baseF, name: label, source: "CONVERSION_BASED_UNIT" };
    }
    return null;
  };

  let length: StepUnit | null = null;
  let angleToRad: number | null = null;
  const lengths = new Set<string>();
  for (const [id] of idx) {
    const r = idx.get(id)!;
    // filtro barato antes de interpretar
    if (text.slice(r[0], r[1]).indexOf("GLOBAL_UNIT_ASSIGNED_CONTEXT") < 0) continue;
    const g = part(entity(id), "GLOBAL_UNIT_ASSIGNED_CONTEXT");
    const units = g?.args[0]?.t === "list" ? g.args[0].v : [];
    for (const u of units) {
      if (u.t !== "ref") continue;
      const e = entity(u.v);
      if (!e) continue;
      if (part(e, "LENGTH_UNIT")) {
        const f = unitFactor(e, "LENGTH", 0);
        if (f) {
          lengths.add(`${f.name}:${f.f}`);
          if (!length) length = { name: f.name, toMm: f.f, source: f.source };
        }
      } else if (part(e, "PLANE_ANGLE_UNIT") && angleToRad === null) {
        const f = unitFactor(e, "ANGLE", 0);
        if (f) angleToRad = f.f;
      }
    }
  }
  if (!length) warnings.push("Unidade de comprimento não encontrada ou não reconhecida no arquivo: os valores são exibidos sem conversão (o leitor trata como mm) — confira as medidas.");
  if (lengths.size > 1) warnings.push(`O arquivo declara mais de uma unidade de comprimento (${[...lengths].map((s) => s.split(":")[0]).join(", ")}); cada parte é convertida pela sua — confira as medidas.`);
  return {
    valid,
    complete,
    schema,
    protocol,
    fileName: str(fn?.[0]),
    timestamp: str(fn?.[1]),
    preprocessor: str(fn?.[4]),
    originatingSystem: str(fn?.[5]),
    entities: idx.size,
    length,
    angleToRad,
    warnings,
  };
}

/** Unidades de exibição oferecidas no visualizador (só conversão de exibição; a geometria fica em mm). */
export const DISPLAY_UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 } as const;
export type DisplayUnit = keyof typeof DISPLAY_UNITS;

/** Formata um comprimento (mm) na unidade de exibição; `pow` 2 = área, 3 = volume. */
export function fmtLen(mm: number, u: DisplayUnit, pow: 1 | 2 | 3 = 1, digits = 3): string {
  const v = mm / DISPLAY_UNITS[u] ** pow;
  const s = Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(digits) : v.toFixed(digits);
  return `${s.replace(".", ",")} ${u}${pow === 1 ? "" : pow === 2 ? "²" : "³"}`;
}
