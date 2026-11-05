import type { Vec2 } from "@agtn/geometry";

/**
 * Interpretação da linha de comando (convenção CAD tradicional):
 *   x,y      coordenada absoluta            ex.: 100,50
 *   @dx,dy   relativa ao último ponto       ex.: @25,0
 *   @d<a     polar relativa (a em graus)    ex.: @80<90
 *   d<a      polar absoluta (a partir de 0,0)
 *   n        valor numérico (distância direta, raio, ângulo, fator...)
 *   palavra  comando ou opção
 * O separador decimal é o PONTO; a vírgula separa coordenadas.
 * Valores de comprimento estão na unidade do desenho e são convertidos para mm por `unitToMM`.
 */
export type ParsedInput =
  | { kind: "point"; p: Vec2; relative: boolean; polar: boolean }
  | { kind: "number"; value: number }
  | { kind: "word"; word: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const RE_XY = new RegExp(`^(@)?\\s*(${NUM})\\s*,\\s*(${NUM})$`);
const RE_POLAR = new RegExp(`^(@)?\\s*(${NUM})\\s*<\\s*(${NUM})$`);
const RE_NUM = new RegExp(`^${NUM}$`);

export function parseInput(raw: string, last: Vec2 | null, unitToMM = 1): ParsedInput {
  const s = raw.trim();
  if (!s) return { kind: "empty" };
  let m = RE_XY.exec(s);
  if (m) {
    const rel = !!m[1];
    const x = Number(m[2]) * unitToMM;
    const y = Number(m[3]) * unitToMM;
    if (rel) {
      if (!last) return { kind: "error", message: "Não há ponto anterior para coordenada relativa." };
      return { kind: "point", p: { x: last.x + x, y: last.y + y }, relative: true, polar: false };
    }
    return { kind: "point", p: { x, y }, relative: false, polar: false };
  }
  m = RE_POLAR.exec(s);
  if (m) {
    const rel = !!m[1];
    const d = Number(m[2]) * unitToMM;
    const a = (Number(m[3]) * Math.PI) / 180;
    const o = rel ? last : { x: 0, y: 0 };
    if (!o) return { kind: "error", message: "Não há ponto anterior para coordenada polar relativa." };
    return { kind: "point", p: { x: o.x + d * Math.cos(a), y: o.y + d * Math.sin(a) }, relative: rel, polar: true };
  }
  if (RE_NUM.test(s)) return { kind: "number", value: Number(s) };
  if (/^[A-Za-zÀ-ú_][\wÀ-ú-]*$/.test(s)) return { kind: "word", word: s.toUpperCase() };
  return { kind: "error", message: `Entrada não reconhecida: "${s}". Use x,y  @dx,dy  @dist<ângulo  ou um número (decimal com ponto).` };
}
