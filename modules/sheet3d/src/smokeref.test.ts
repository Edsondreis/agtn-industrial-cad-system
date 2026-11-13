import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CadDocument, deserializeInto } from "@agtn/document";
import { BodyCache, getModel } from "@agtn/model3d";
import { flatPattern, flatToDxf, validateFlatDxf } from "@agtn/sheetgraph";
import { OcctSolidKernel, PartEvaluator } from "@agtn/solid";
import { type SheetState, createSheetBackend } from "./backend";
import { perfModel } from "./perfmodel";

/**
 * FASE 4 · ETAPA 4 — valores de referência do TESTE DE FUMAÇA do WebView2 (`scripts/windows/smoke/`).
 * Calculados aqui (Node + o MESMO occt-wasm) a partir dos arquivos `.agtncad` gravados pelo app de cada fase.
 * No PC Windows, o app instalado abre os mesmos arquivos e o teste compara: volumes (1e-9), área da planificação,
 * blank, comprimento de corte e o SHA-256 do DXF R2000/R12 (mesmo caminho do botão "DXF chapa": flatToDxf + validação).
 * Este teste FALHA se o arquivo de referência não bater com o código atual (regenerar: SMOKE_REF_UPDATE=1).
 */
const OUT = new URL("../../../scripts/windows/smoke/referencias.json", import.meta.url);
const FILES = ["fase2_projeto_3d.agtncad", "fase3_peca_parametrica.agtncad", "etapa1_chapa.agtncad", "etapa2_completo.agtncad", "grande_120furos.agtncad"];
const GRANDE = new URL("./fixtures/grande_120furos.agtncad", import.meta.url);

/** Projeto GRANDE para desempenho (P2): SINTÉTICO — esqueleto do arquivo da ETAPA 1 com a peça 2000×1000, 4 abas,
 *  120 furos e 8 recortes planos do perfModel. Não foi gravado pelo app; o teste confere que o app o abre igual. */
function grandeText(): string {
  const d = JSON.parse(readFileSync(new URL("./fixtures/etapa1_chapa.agtncad", import.meta.url), "utf8"));
  d.generator = "AGTN homologação ETAPA 4 (sintético, perfModel grande)";
  d.savedAt = "2026-11-13T00:00:00.000Z";
  const node = d.extras.agtn3d.nodes[d.extras.agtn3d.roots[0]];
  node.name = "Chapa grande 120 furos";
  node.source.features = JSON.parse(JSON.stringify(perfModel("grande", 50)));
  return `${JSON.stringify(d, null, 1)}\n`;
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
let K: OcctSolidKernel;
beforeAll(async () => {
  K = await OcctSolidKernel.create();
});
afterAll(() => K.dispose());

it("referências do teste de fumaça do WebView2 = código atual", { timeout: 300_000 }, () => {
  if (process.env.SMOKE_REF_UPDATE === "1" || !existsSync(GRANDE)) writeFileSync(GRANDE, grandeText());
  expect(readFileSync(GRANDE, "utf8")).toBe(grandeText());
  const ref: Record<string, unknown> = {
    _origem: "modules/sheet3d/src/smokeref.test.ts (Node + occt-wasm 5.17.1); arquivos em modules/sheet3d/src/fixtures/",
    _tolerancia: { volumeRelativo: 1e-9, areaRelativa: 1e-9, comprimentoRelativo: 1e-9, dxf: "SHA-256 idêntico (mesmo .wasm, mesmo JS)" },
  };
  for (const f of FILES) {
    const doc = new CadDocument();
    const text = readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
    deserializeInto(doc, text);
    const c = new BodyCache(K, new PartEvaluator(K, createSheetBackend()));
    const m = getModel(doc);
    const r = c.sync(m);
    expect(r.errors).toEqual({});
    const bodies: Record<string, unknown> = {};
    for (const n of Object.values(m.nodes)) {
      if (n.kind !== "body") continue;
      const p = K.props(c.get(n.id)!);
      const e: Record<string, unknown> = { volume: p.volume, area: p.area };
      const sh = r.sheets[n.id] as { state: SheetState } | undefined;
      if (sh) {
        const fp = flatPattern(sh.state.solved, []);
        const w = fp.box.maxX - fp.box.minX;
        const h = fp.box.maxY - fp.box.minY;
        const dxf: Record<string, string> = {};
        for (const v of ["R2000", "R12"] as const) {
          const t = flatToDxf(fp, { version: v });
          expect(validateFlatDxf(t, fp, { version: v }).ok).toBe(true);
          dxf[v] = sha(t);
        }
        e.chapa = { flatArea: sh.state.solved.flatArea, estado: fp.state, blank: [w, h], corte: fp.cutLength, dobras: fp.bends.length, dxfSha256: dxf };
      }
      bodies[n.name] = e;
    }
    ref[f] = { sha256Arquivo: sha(text), corpos: bodies };
    c.clear();
  }
  const txt = `${JSON.stringify(ref, null, 1)}\n`;
  if (process.env.SMOKE_REF_UPDATE === "1" || !existsSync(OUT)) writeFileSync(OUT, txt);
  expect(readFileSync(OUT, "utf8")).toBe(txt);
});
