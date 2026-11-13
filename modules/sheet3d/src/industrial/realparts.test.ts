import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parseModel3D } from "@agtn/model3d";
import { readDxf } from "@agtn/dxf";
import { type Entity, entityLength, polylineSignedArea } from "@agtn/geometry";
import { flatPattern } from "@agtn/sheetgraph";
import { type Feature, OcctSolidKernel, PartEvaluator } from "@agtn/solid";
import { type SheetState, createSheetBackend } from "../backend";

/**
 * I2 — comparação com as peças REAIS fornecidas pela AGTN (uma pasta por peça em tests/industrial/pecas_reais/).
 * Sem peça → registra PENDENTE (não aprova nada). Sem tolerância aprovada → AGUARDANDO ENGENHARIA, com as
 * diferenças medidas; o teste não inventa tolerância.
 */
const DIR = new URL("../../../../tests/industrial/pecas_reais/", import.meta.url);
const OUT = "tests/output/pecas_reais";
const folders = existsSync(DIR) ? readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("_")).map((d) => d.name) : [];
type Num = { agtn: number; ref: number; dif: number };
const areaOf = (e: Entity) => (e.type === "circle" ? Math.PI * e.r * e.r : e.type === "polyline" ? Math.abs(polylineSignedArea(e.pts, e.bulges)) : 0);
function measure(ents: readonly Entity[], cutLayers: (l: string) => boolean, bendLayers: (l: string) => boolean) {
  const cuts = ents.filter((e) => cutLayers(e.layer) && (e.type === "polyline" || e.type === "circle" || e.type === "line" || e.type === "arc"));
  const closed = cuts.filter((e) => e.type === "circle" || (e.type === "polyline" && e.closed));
  const outer = closed.reduce<Entity | null>((m, e) => (!m || areaOf(e) > areaOf(m) ? e : m), null);
  const pts = outer?.type === "polyline" ? outer.pts : [];
  const w = pts.length ? Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)) : NaN;
  const h = pts.length ? Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) : NaN;
  const area = outer ? areaOf(outer) - closed.filter((e) => e !== outer).reduce((a, e) => a + areaOf(e), 0) : NaN;
  const corte = cuts.reduce((a, e) => a + entityLength(e), 0);
  const bends = ents.filter((e) => bendLayers(e.layer) && e.type === "line");
  return { w, h, area, corte, internos: closed.length - (outer ? 1 : 0), dobras: bends.length, abertas: cuts.length - closed.length };
}

describe("I2 — peças reais da AGTN", () => {
  if (!folders.length) {
    it("nenhuma peça real fornecida ainda → I2 PENDENTE", () => {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/comparativo.json`, JSON.stringify({ status: "PENDENTE", motivo: "nenhuma peça em tests/industrial/pecas_reais/" }, null, 1));
      expect(folders.length).toBe(0);
    });
    return;
  }
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
  const rows: Record<string, unknown>[] = [];
  afterAll(() => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/comparativo.json`, JSON.stringify(rows, null, 1));
    const md = ["| Peça | Item | AGTN | Referência | Diferença | Status |", "|---|---|---|---|---|---|"];
    for (const r of rows) for (const [k, v] of Object.entries(r.itens as Record<string, Num>)) md.push(`| ${r.id} | ${k} | ${v.agtn.toFixed(4)} | ${v.ref.toFixed(4)} | ${v.dif.toFixed(4)} | ${r.status} |`);
    writeFileSync(`${OUT}/comparativo.md`, md.join("\n") + "\n");
  });
  for (const name of folders)
    it(name, () => {
      const base = new URL(`${name}/`, DIR);
      const ficha = JSON.parse(readFileSync(new URL("ficha.json", base), "utf8"));
      const doc = JSON.parse(readFileSync(new URL("modelo.agtncad", base), "utf8"));
      const { model } = parseModel3D(doc.extras.agtn3d);
      const body = Object.values(model.nodes).find((n) => n.kind === "body" && n.source.type === "part");
      if (!body || body.kind !== "body" || body.source.type !== "part") throw new Error(`${name}: modelo.agtncad sem peça de chapa`);
      const r = ev.evaluate(body.id, body.source.features as readonly Feature[]);
      const bad = r.status.filter((s) => s.state === "error" || s.state === "dependency_error");
      expect(bad).toEqual([]);
      const fp = flatPattern((r.sheet!.state as SheetState).solved);
      expect(fp.state).toBe("valida");
      const ref = readDxf(new Uint8Array(readFileSync(new URL("referencia.dxf", base))));
      // camadas da referência: dobra = linha de dobra (padrão 2D AGTN ou o do DXF da chapa 3D); corte = o resto,
      // menos região de dobra, cotas, textos e referência. Camadas fora do padrão: ajustar aqui e registrar na ficha.
      const isBend = (l: string) => /^(LINHAS?_DOBRA|BEND_UP|BEND_DOWN|DOBRAS?)$/i.test(l);
      const isCut = (l: string) => !isBend(l) && !/REGIAO|REGION|COTA|DIM|TEXT|MARCA|ANOT|REFER|BEND_MARK/i.test(l);
      const mr = measure(ref.entities, isCut, isBend);
      const w = fp.box.maxX - fp.box.minX;
      const h = fp.box.maxY - fp.box.minY;
      const pair = (a: number, b: number): Num => ({ agtn: a, ref: b, dif: a - b });
      // blank: aceita a referência girada 90°
      const rot = Math.abs(w - mr.h) + Math.abs(h - mr.w) < Math.abs(w - mr.w) + Math.abs(h - mr.h);
      const itens: Record<string, Num> = {
        blank_largura: pair(w, rot ? mr.h : mr.w),
        blank_altura: pair(h, rot ? mr.w : mr.h),
        area: pair(fp.area, mr.area),
        corte: pair(fp.cutLength, mr.corte),
        contornos_internos: pair(fp.cut.length - 1 + fp.holes.length, mr.internos),
        linhas_dobra: pair(fp.bends.reduce((a, b) => a + b.lineSegs.length, 0), mr.dobras),
      };
      const tol = ficha.tolerancias as null | Record<string, number>;
      let status = "AGUARDANDO APROVAÇÃO DA ENGENHARIA (sem tolerância definida)";
      if (tol) {
        const fails = [
          Math.abs(itens.blank_largura.dif) > (tol.blank_mm ?? 0) ? "blank_largura" : null,
          Math.abs(itens.blank_altura.dif) > (tol.blank_mm ?? 0) ? "blank_altura" : null,
          Math.abs(itens.area.dif) > (tol.area_mm2 ?? 0) ? "area" : null,
          Math.abs(itens.corte.dif) > (tol.corte_mm ?? 0) ? "corte" : null,
          itens.contornos_internos.dif !== 0 ? "contornos_internos" : null,
          itens.linhas_dobra.dif !== 0 ? "linhas_dobra" : null,
        ].filter(Boolean);
        status = fails.length ? `REPROVADO (${fails.join(", ")})` : "APROVADO (tolerâncias da ficha)";
        expect(fails).toEqual([]);
      }
      rows.push({ id: name, descricao: ficha.descricao, referencia_aberta: mr.abertas === 0, itens, status });
    });
});
