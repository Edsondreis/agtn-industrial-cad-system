import { type Sketch, addCircle, addRectangle, emptySketch } from "@agtn/sketch";
import type { Feature, FeatureDraft } from "@agtn/solid";

/**
 * Modelos de chapa para desempenho (ETAPA 3 P1 e ETAPA 4 P2): pequeno 200×120 (4 abas), médio 600×400 (24 furos,
 * 2 recortes planos), grande 2000×1000 (120 furos, 8 recortes planos). Ids fixos: o resultado é determinístico.
 * Auxiliar de TESTE (não é código do app).
 */
let seq = 0;
const F = (name: string, d: FeatureDraft, id = `f${++seq}`): Feature => ({ ...(d as object), id, name }) as Feature;
const sk = (s: Sketch, id: string, offset = 0) => F("Esboço", { t: "sketch", plane: { t: "std", plane: "XY", offset }, sketch: s }, id);
export function perfModel(size: "pequeno" | "medio" | "grande", H: number, rh = 4): Feature[] {
  const [A, B, nh, nc] = size === "pequeno" ? [200, 120, 0, 0] : size === "medio" ? [600, 400, 24, 2] : [2000, 1000, 120, 8];
  const r0 = addRectangle(emptySketch(), { x: 0, y: 0 }, { x: A, y: B });
  const f: Feature[] = [sk(r0.s, "S0"), F("Chapa_1", { t: "sheetBase", sketch: "S0", T: 2, R: 2, K: 0.43, material: "aco_carbono", process: "ar", ref: "externa", side: "cima" }, "CH")];
  f.push(F("Aba_1", { t: "sheetFlange", edges: r0.lines.map((l) => ({ flange: "CH", edge: l })), length: H, deflectionDeg: 90, R: null, K: null, side: "cima", ref: "externa" }, "AB"));
  if (nh) {
    let s = emptySketch();
    const cols = Math.ceil(Math.sqrt((nh * A) / B));
    for (let i = 0; i < nh; i++) s = addCircle(s, { x: 60 + ((i % cols) * (A - 120)) / Math.max(1, cols - 1), y: 60 + (Math.floor(i / cols) * (B - 120)) / Math.max(1, Math.ceil(nh / cols) - 1) }, rh).s;
    f.push(sk(s, "SH", 2), F("Furos", { t: "sheetCut", sketch: "SH", flange: "CH" }, "FU"));
  }
  if (nc) {
    let s = emptySketch();
    for (let i = 0; i < nc; i++) s = addRectangle(s, { x: 100 + i * ((A - 240) / Math.max(1, nc - 1)), y: -10 }, { x: 120 + i * ((A - 240) / Math.max(1, nc - 1)), y: 15 }).s;
    f.push(sk(s, "SC"), F("RecortePlano_1", { t: "sheetFlatCut", sketch: "SC" }, "RP"));
  }
  return f;
}
