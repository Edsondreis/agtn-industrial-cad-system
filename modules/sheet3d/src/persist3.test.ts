import { readFileSync } from "node:fs";
import { CadDocument, deserializeInto, serializeDocument } from "@agtn/document";
import { BodyCache, getModel, parseModel3D } from "@agtn/model3d";
import { flatPattern, flatToDxf } from "@agtn/sheetgraph";
import { OcctSolidKernel, PartEvaluator } from "@agtn/solid";
import { type SheetState, createSheetBackend } from "./backend";

/**
 * FASE 4 · ETAPA 3 — C1/C2: arquivos `.agtncad` GRAVADOS PELOS CÓDIGOS DE CADA FASE (worktrees das bases, e2e reais):
 *  FASE 2 (e66702a, e2e3d) · FASE 3 (0f5ea29, e2e_param) · ETAPA 1 (e463834, e2e_sheet) · ETAPA 2 (9ac7193, e2e_etapa2).
 * Abertos pelo código atual: documento inteiro idêntico ao salvar de novo, modelo 3D idêntico, corpos regenerados
 * com os volumes registrados quando foram gravados; DXF da planificação igual antes e depois de reabrir.
 */
let K: OcctSolidKernel;
beforeAll(async () => {
  K = await OcctSolidKernel.create();
});
afterAll(() => K.dispose());
const FIX = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const CASES: [string, string, Record<string, number>][] = [
  ["FASE 2 (e66702a)", "fase2_projeto_3d.agtncad", { CHAPA: 1500000, COLUNA: 782400, TUBO_SUPORTE: 173168.4355168697 }],
  ["FASE 3 (0f5ea29)", "fase3_peca_parametrica.agtncad", { "Peça 1": 233609.51377451912 }],
  ["ETAPA 1 (e463834)", "etapa1_chapa.agtncad", { "Peça 1": 26027.433388230813 }],
  ["ETAPA 2 (9ac7193)", "etapa2_completo.agtncad", { "Peça 1": 19837.522264378968 }],
];
const open = (text: string) => {
  const doc = new CadDocument();
  const rep = deserializeInto(doc, text);
  return { doc, rep };
};

describe("C1 — arquivos de todas as fases abertos pelo código atual", () => {
  for (const [name, file, vols] of CASES)
    it(`${name}: abre e salva idêntico; regenera com os volumes de quando foi gravado`, () => {
      const text = FIX(file);
      const { doc, rep } = open(text);
      expect(rep.skipped).toEqual([]);
      expect(rep.warnings).toEqual([]);
      const orig = JSON.parse(text);
      const again = JSON.parse(serializeDocument(doc, orig.generator));
      again.savedAt = orig.savedAt;
      expect(again).toEqual(orig);
      const pm = parseModel3D(JSON.parse(JSON.stringify(orig.extras.agtn3d)));
      expect(pm.warnings).toEqual([]);
      expect(JSON.parse(JSON.stringify(pm.model))).toEqual(orig.extras.agtn3d);
      const c = new BodyCache(K, new PartEvaluator(K, createSheetBackend()));
      const m = getModel(doc);
      const r = c.sync(m);
      expect(r.errors).toEqual({});
      for (const [bodyName, v] of Object.entries(vols)) {
        const b = Object.values(m.nodes).find((n) => n.kind === "body" && n.name === bodyName)!;
        const got = K.props(c.get(b.id)!).volume;
        expect(Math.abs(got - v)).toBeLessThan(1e-9 * v);
      }
      for (const st of Object.values(r.features)) expect(st.every((s) => s.state === "ok" || s.state === "rolledback" || s.state === "suppressed")).toBe(true);
      c.clear();
    });
});

describe("C2 — DXF da planificação igual antes e depois de salvar e reabrir", () => {
  it("ETAPA 2: DXF R2000 e R12 byte a byte iguais (motor novo na reabertura)", () => {
    const dxfOf = (text: string, version: "R12" | "R2000") => {
      const { doc } = open(text);
      const k2 = K;
      const c = new BodyCache(k2, new PartEvaluator(k2, createSheetBackend()));
      const r = c.sync(getModel(doc));
      const sh = Object.values(r.sheets)[0] as { state: SheetState };
      const txt = flatToDxf(flatPattern(sh.state.solved), { version, regions: true });
      c.clear();
      return { txt, doc };
    };
    for (const v of ["R2000", "R12"] as const) {
      const a = dxfOf(FIX("etapa2_completo.agtncad"), v);
      const saved = serializeDocument(a.doc);
      const b = dxfOf(saved, v);
      expect(b.txt).toBe(a.txt);
    }
  });
});
