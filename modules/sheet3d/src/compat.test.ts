import { readFileSync } from "node:fs";
import { parseModel3D } from "@agtn/model3d";
import { type Feature, OcctSolidKernel, PartEvaluator } from "@agtn/solid";
import type { ShapeHandle } from "occt-wasm";
import { type SheetState, createSheetBackend } from "./backend";

const RAW = JSON.parse(readFileSync(new URL("../../../core/model3d/src/fixtures/fase4_desconhecido.json", import.meta.url), "utf8"));
let K: OcctSolidKernel;
beforeAll(async () => {
  K = await OcctSolidKernel.create();
});
afterAll(() => K.dispose());

const featuresOf = (raw: unknown) => {
  const { model } = parseModel3D(raw);
  const n = model.nodes.b1;
  if (n.kind !== "body" || n.source.type !== "part") throw new Error("fixture");
  return { model, features: n.source.features as readonly Feature[] };
};

describe("persistência da chapa", () => {
  it("arquivo FASE 4 com operação desconhecida: chapa regenera; desconhecida → erro claro; nada se perde", () => {
    const ev = new PartEvaluator(K, createSheetBackend());
    const { model, features } = featuresOf(JSON.parse(JSON.stringify(RAW)));
    const r = ev.evaluate("b1", features);
    expect(r.status.map((s) => s.state)).toEqual(["ok", "ok", "ok", "error"]);
    expect(r.status[3].error).toContain("versão mais nova");
    expect(JSON.parse(JSON.stringify(model))).toEqual(RAW);
    ev.releaseAll();
  });
  it("salvar/reabrir (JSON) → mesmo sólido, mesma proveniência, mesma planificação (bit a bit)", () => {
    const raw = JSON.parse(JSON.stringify(RAW));
    raw.nodes.b1.source.features = raw.nodes.b1.source.features.slice(0, 3);
    const e1 = new PartEvaluator(K, createSheetBackend());
    const e2 = new PartEvaluator(K, createSheetBackend());
    const a = e1.evaluate("b1", featuresOf(raw).features);
    const reopened = JSON.parse(JSON.stringify(featuresOf(raw).model));
    const b = e2.evaluate("b1", featuresOf(reopened).features);
    const sa = a.sheet!.state as SheetState;
    const sb = b.sheet!.state as SheetState;
    expect(JSON.stringify(sb.solved)).toBe(JSON.stringify(sa.solved));
    expect(JSON.stringify(sb.faceLabels)).toBe(JSON.stringify(sa.faceLabels));
    expect(K.raw.getVolume(b.shape!)).toBe(K.raw.getVolume(a.shape!));
    e1.releaseAll();
    e2.releaseAll();
  });
  it("transformar o sólido (posição do corpo) preserva a ordem das faces → proveniência vale no corpo exibido", () => {
    const ev = new PartEvaluator(K, createSheetBackend());
    const raw = JSON.parse(JSON.stringify(RAW));
    raw.nodes.b1.source.features = raw.nodes.b1.source.features.slice(0, 3);
    const r = ev.evaluate("b1", featuresOf(raw).features);
    const k = K.raw;
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    const m = [c, -s, 0, 10, s, c, 0, -5, 0, 0, 1, 3];
    const w = k.transform(r.shape!, m);
    const fa = k.getSubShapes(r.shape!, "face");
    const fb = k.getSubShapes(w, "face");
    expect(fb.length).toBe(fa.length);
    fa.forEach((f, i) => {
      const p = k.getSurfaceCenterOfMass(f);
      const q = k.getSurfaceCenterOfMass(fb[i]);
      expect(q.x).toBeCloseTo(c * p.x - s * p.y + 10, 9);
      expect(q.y).toBeCloseTo(s * p.x + c * p.y - 5, 9);
      expect(q.z).toBeCloseTo(p.z + 3, 9);
    });
    for (const h of [w, ...fa, ...fb] as ShapeHandle[]) k.release(h);
    ev.releaseAll();
  });
});
