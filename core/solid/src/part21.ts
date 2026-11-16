/**
 * Leitor mínimo de ISO 10303-21 (STEP "Part 21"): índice id → corpo da entidade e tokenizador de UMA entidade.
 *
 * Usado pelo cabeçalho/unidades (`@agtn/model3d` stepinfo) e pela normalização de laços com polo antes do
 * leitor do OCCT (`step-pole.ts`). O texto vem de arquivo externo: entrada não confiável. Nada aqui executa ou
 * avalia conteúdo; limites de tamanho/profundidade evitam travar com arquivo malformado.
 * (Movido de core/model3d/src/stepinfo.ts sem alteração de lógica.)
 */

/** Valor de parâmetro Part 21 já tokenizado. */
export type Arg = { t: "ref"; v: number } | { t: "str"; v: string } | { t: "enum"; v: string } | { t: "num"; v: number } | { t: "list"; v: Arg[] } | { t: "typed"; type: string; v: Arg[] } | { t: "null" };
export interface Part {
  readonly type: string;
  readonly args: Arg[];
}

/** Índice id → trecho do corpo da entidade na seção DATA (não interpreta nada além de strings/comentários). */
export function indexEntities(text: string, from: number): Map<number, [number, number]> {
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
export function parseBody(src: string): Part[] {
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

