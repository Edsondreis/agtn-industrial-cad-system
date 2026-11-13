import type { SheetIssue, SheetSolved } from "./model";

/**
 * Avisos de fabricação sobre o grafo resolvido (não impedem a peça; aparecem na árvore e no painel).
 * Os ERROS de geometria ficam em `solveSheet` (topologia/recuos/recortes), em `flatPattern` (sobreposição na
 * planificação) e no motor OCCT (interferência 3D, volume, validade).
 */
export function sheetWarnings(s: SheetSolved): SheetIssue[] {
  const out: SheetIssue[] = [];
  if (!s.ok) return out;
  for (const b of s.bends) {
    if (b.R / s.T < 0.5)
      out.push({
        level: "warning",
        code: "R_SMALL",
        message: `${b.label}: raio interno ${b.R.toFixed(2).replace(".", ",")} mm pequeno para a espessura (R/T = ${(b.R / s.T).toFixed(2).replace(".", ",")}) — risco de trinca.`,
        op: b.op,
        bends: [b.id],
      });
    if (b.kSource === "estimado")
      out.push({ level: "warning", code: "K_ESTIMATED", message: `${b.label}: fator K ${b.K} estimado — calibre com ensaio de dobra para peças de medida crítica.`, op: b.op, bends: [b.id] });
  }
  return out;
}

/** Motivo de planificação inválida quando há operações sólidas genéricas depois da chapa. */
export function genericOpReason(names: readonly string[]): string | null {
  if (!names.length) return null;
  return `${names.join(", ")} ${names.length > 1 ? "não são operações" : "não é operação"} de chapa — a planificação não representa mais o sólido.`;
}
