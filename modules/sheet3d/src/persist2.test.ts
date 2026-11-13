import { readFileSync } from "node:fs";
import { parseModel3D } from "@agtn/model3d";
import { flatPattern } from "@agtn/sheetgraph";
import { type Feature, OcctSolidKernel, PartEvaluator } from "@agtn/solid";
import { type SheetState, createSheetBackend } from "./backend";

/**
 * Persistência (ETAPA 2):
 *  - arquivo GRAVADO PELA ETAPA 1 (código da base e463834, pelo e2e_sheet real) abre igual e regenera com o mesmo
 *    volume e a mesma planificação de quando foi gravado;
 *  - arquivo da ETAPA 2 (canto, recorte plano, desdobrar/redobrar; gravado pelo e2e_etapa2) idem.
 */
let K: OcctSolidKernel;
let ev: PartEvaluator;
beforeAll(async () => {
  K = await OcctSolidKernel.create();
  ev = new PartEvaluator(K, createSheetBackend());
});
afterAll(() => {
  ev.releaseAll();
  K.dispose();
});
const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const bodyOf = (doc: { extras: { agtn3d: unknown } }) => {
  const rep = parseModel3D(JSON.parse(JSON.stringify(doc.extras.agtn3d)));
  expect(rep.warnings).toEqual([]);
  expect(JSON.parse(JSON.stringify(rep.model))).toEqual(doc.extras.agtn3d); // abrir e salvar = idêntico
  const b = Object.values(rep.model.nodes).find((n) => n.kind === "body")!;
  if (b.kind !== "body" || b.source.type !== "part") throw new Error("fixture");
  return b;
};

describe("arquivos .agtncad das ETAPAS 1 e 2", () => {
  it("ETAPA 1 (gravado pela base e463834): abre idêntico; volume 26027,433388 e planificação 129,477432 de quando foi gravado", () => {
    const b = bodyOf(load("etapa1_chapa.agtncad"));
    // o arquivo da ETAPA 1 não tem ids de segmento no flange de contorno (2.0) nem recuos/posição (2.1a/2.2)
    const contour = b.source.features.find((f) => f.t === "sheetContour") as unknown as { segments: { id?: string }[] };
    expect(contour.segments.every((s) => s.id === undefined)).toBe(true);
    const r = ev.evaluate(b.id, b.source.features as readonly Feature[]);
    expect(r.status.map((s) => s.state)).toEqual(["ok", "ok", "ok", "ok"]);
    const sv = (r.sheet!.state as SheetState).solved;
    expect(Math.abs(K.raw.getVolume(r.shape!) - 26027.433388230813)).toBeLessThan(1e-9 * 26027);
    const fp = flatPattern(sv);
    expect(Math.abs(fp.box.maxY - fp.box.minY - 129.4774324839002)).toBeLessThan(1e-9);
  });
  it("ETAPA 2 completo: abre idêntico e regenera com o mesmo volume e a mesma área plana", () => {
    const b = bodyOf(load("etapa2_completo.agtncad"));
    expect(b.source.features.map((f) => f.t)).toEqual(["sketch", "sheetBase", "sheetFlange", "sheetCorner", "sketch", "sheetFlatCut", "sheetUnfold", "sheetRefold"]);
    const r = ev.evaluate(b.id, b.source.features as readonly Feature[]);
    expect(r.status.every((s) => s.state === "ok")).toBe(true);
    const sv = (r.sheet!.state as SheetState).solved;
    expect(Math.abs(K.raw.getVolume(r.shape!) - 19837.522264378968)).toBeLessThan(1e-9 * 19837);
    expect(Math.abs(sv.flatArea - 9891.931929277966)).toBeLessThan(1e-9 * 9891);
  });
});
