/**
 * Validação dos argumentos que o MODELO manda para uma ferramenta. A resposta do modelo é entrada não confiável:
 * tipo errado, campo a mais, número fora da faixa, NaN/Infinity, texto longo demais ou enum inválido são recusados
 * com mensagem clara (devolvida ao modelo para ele corrigir ou perguntar ao usuário). Sem eval, sem regex do modelo.
 */
import type { JsonSchema } from "./types";

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  /** cópia limpa (só campos declarados) */
  readonly value: Record<string, unknown>;
}

const MAX_STRING = 2000;
const MAX_ITEMS = 500;

export function validateArgs(schema: JsonSchema & { type: "object" }, input: unknown): ValidationResult {
  const errors: string[] = [];
  const value = check(schema, input, "", errors, 0);
  return { ok: errors.length === 0, errors, value: (value ?? {}) as Record<string, unknown> };
}

function check(s: JsonSchema, v: unknown, path: string, errors: string[], depth: number): unknown {
  const at = path || "argumentos";
  if (depth > 8) {
    errors.push(`${at}: aninhamento excessivo`);
    return undefined;
  }
  switch (s.type) {
    case "object": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        errors.push(`${at}: esperado objeto`);
        return undefined;
      }
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o)) {
        if (!(k in s.properties)) errors.push(`${path ? path + "." : ""}${k}: campo não existe nesta ferramenta`);
      }
      for (const r of s.required ?? []) if (o[r] === undefined || o[r] === null) errors.push(`${path ? path + "." : ""}${r}: obrigatório`);
      for (const [k, sub] of Object.entries(s.properties)) {
        if (o[k] === undefined || o[k] === null) continue;
        const c = check(sub, o[k], `${path ? path + "." : ""}${k}`, errors, depth + 1);
        if (c !== undefined) out[k] = c;
      }
      return out;
    }
    case "array": {
      if (!Array.isArray(v)) {
        errors.push(`${at}: esperado lista`);
        return undefined;
      }
      if (v.length > Math.min(s.maxItems ?? MAX_ITEMS, MAX_ITEMS)) errors.push(`${at}: no máximo ${Math.min(s.maxItems ?? MAX_ITEMS, MAX_ITEMS)} itens`);
      if (s.minItems !== undefined && v.length < s.minItems) errors.push(`${at}: no mínimo ${s.minItems} itens`);
      return v.slice(0, MAX_ITEMS).map((x, i) => check(s.items, x, `${at}[${i}]`, errors, depth + 1));
    }
    case "number":
    case "integer": {
      // o modelo às vezes manda "6" (texto): aceitamos só número de verdade, nada de conversão silenciosa
      if (typeof v !== "number" || !Number.isFinite(v)) {
        errors.push(`${at}: esperado número finito`);
        return undefined;
      }
      if (s.type === "integer" && !Number.isInteger(v)) errors.push(`${at}: esperado número inteiro`);
      if (s.minimum !== undefined && v < s.minimum) errors.push(`${at}: mínimo ${s.minimum}`);
      if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) errors.push(`${at}: deve ser maior que ${s.exclusiveMinimum}`);
      if (s.maximum !== undefined && v > s.maximum) errors.push(`${at}: máximo ${s.maximum}`);
      return v;
    }
    case "string": {
      if (typeof v !== "string") {
        errors.push(`${at}: esperado texto`);
        return undefined;
      }
      const max = Math.min(s.maxLength ?? MAX_STRING, MAX_STRING);
      if (v.length > max) errors.push(`${at}: texto longo demais (máx. ${max})`);
      if (s.enum && !s.enum.includes(v)) errors.push(`${at}: valor "${v.slice(0, 40)}" não permitido (use: ${s.enum.join(", ")})`);
      return v.slice(0, max);
    }
    case "boolean": {
      if (typeof v !== "boolean") {
        errors.push(`${at}: esperado verdadeiro/falso`);
        return undefined;
      }
      return v;
    }
  }
}

/** Esquema no formato OpenAPI aceito pelo Gemini (`parameters`): tipos em maiúsculas, sem campos desconhecidos. */
export function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const base: Record<string, unknown> = { type: s.type.toUpperCase() };
  if (s.description) base.description = s.description;
  switch (s.type) {
    case "object":
      base.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
      if (s.required?.length) base.required = [...s.required];
      break;
    case "array":
      base.items = toGeminiSchema(s.items);
      if (s.minItems !== undefined) base.minItems = String(s.minItems);
      if (s.maxItems !== undefined) base.maxItems = String(s.maxItems);
      break;
    case "number":
    case "integer":
      if (s.minimum !== undefined) base.minimum = s.minimum;
      if (s.maximum !== undefined) base.maximum = s.maximum;
      break;
    case "string":
      if (s.enum) {
        base.enum = [...s.enum];
        base.format = "enum";
      }
      break;
  }
  return base;
}
