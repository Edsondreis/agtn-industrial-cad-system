/**
 * FASE 5 — cobertura do leitor DXF (preservado; nada reescrito) com arquivos gerados pelo ezdxf, biblioteca
 * independente (tests/dxf/make_fase5_fixtures.py). Coordenadas, camadas, cores e unidades conferidas com o
 * que o próprio ezdxf relê; entidades não suportadas precisam ser contadas e avisadas, nunca simuladas.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ArcEntity, CircleEntity, Entity, LineEntity, PointEntity, PolylineEntity, TextEntity } from "@agtn/geometry";
import { describe, expect, it } from "vitest";
import { readDxf } from "./index";

const DIR = fileURLToPath(new URL("../../../tests/dxf/fixtures/fase5/", import.meta.url));
const bytes = (f: string) => new Uint8Array(readFileSync(DIR + f));
type Ref = {
  version: string;
  insunits: number;
  counts: Record<string, number>;
  layers: Record<string, number>;
  lines: [number, number, number, number, string][];
  circles: [number, number, number, string][];
  arcs: [number, number, number, number, number][];
  points: [number, number][];
  texts: string[];
  inserts: [string, number, number, number, number][];
};
const REF = JSON.parse(readFileSync(DIR + "referencia_ezdxf.json", "utf8")) as Record<string, Ref>;
const of = <T extends Entity["type"]>(es: readonly Entity[], t: T) => es.filter((e) => e.type === t) as Extract<Entity, { type: T }>[];
const D2R = Math.PI / 180;

/** entidades de bloco expandidas pelo INSERT ficam na camada do INSERT; separa as que vieram do bloco FURO10 */
const fromInsert = (es: readonly Entity[]) => es.filter((e) => (e.type === "circle" && Math.abs(e.r - 10) < 1e-9) || (e.type === "line" && Math.abs(Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) - 28) < 1e-9));

for (const file of ["cobertura_r12.dxf", "cobertura_r2000.dxf"]) {
  const ref = REF[file];
  describe(`DXF ${ref.version} (${file}) contra o ezdxf`, () => {
    const src = bytes(file);
    const copy = src.slice();
    const r = readDxf(src);
    const es = r.entities;

    it("versão e somente leitura: os bytes do arquivo não são alterados", () => {
      expect(r.report.version).toBe(ref.version);
      expect(Buffer.compare(Buffer.from(src), Buffer.from(copy))).toBe(0);
    });

    it("LINE: coordenadas idênticas (inclusive negativas e grandes, 1e7)", () => {
      const lines = of(es, "line").filter((l) => !fromInsert([l]).length) as LineEntity[];
      for (const [x1, y1, x2, y2, layer] of ref.lines) {
        const m = lines.find((l) => l.a.x === x1 && l.a.y === y1 && l.b.x === x2 && l.b.y === y2);
        expect(m, `linha ${x1},${y1} → ${x2},${y2}`).toBeTruthy();
        expect(m!.layer).toBe(layer);
      }
      expect(lines.some((l) => l.a.x === 10_000_000 && l.a.y === -10_000_000)).toBe(true);
    });

    it("CIRCLE e ARC: centro, raio e ângulos", () => {
      const cs = of(es, "circle") as CircleEntity[];
      for (const [x, y, rr, layer] of ref.circles) expect(cs.some((c) => c.c.x === x && c.c.y === y && c.r === rr && c.layer === layer)).toBe(true);
      const as = of(es, "arc") as ArcEntity[];
      for (const [x, y, rr, a0, a1] of ref.arcs) {
        const a = as.find((e) => e.c.x === x && e.c.y === y && e.r === rr);
        expect(a).toBeTruthy();
        expect(a!.a0).toBeCloseTo(a0 * D2R, 12);
        expect(a!.a1).toBeCloseTo(a1 * D2R, 12);
      }
    });

    it("POINT e TEXT", () => {
      const ps = of(es, "point") as PointEntity[];
      for (const [x, y] of ref.points) expect(ps.some((p) => p.p.x === x && p.p.y === y)).toBe(true);
      const ts = of(es, "text") as TextEntity[];
      for (const t of ref.texts) expect(ts.some((e) => e.value === t)).toBe(true);
    });

    it("POLYLINE 2D com bulge preservado (arco de 90°)", () => {
      const pl = (of(es, "polyline") as PolylineEntity[]).find((p) => p.closed && p.pts.length === 4);
      expect(pl).toBeTruthy();
      expect(pl!.pts).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
        { x: 0, y: 50 },
      ]);
      expect(pl!.bulges[1]).toBeCloseTo(0.41421356237309503, 15);
    });

    it("INSERT/BLOCK expandido com posição, rotação 30° e escala 2", () => {
      const [, ix, iy, rot, sc] = ref.inserts[0];
      const blk = fromInsert(es);
      const c = blk.find((e): e is CircleEntity => e.type === "circle")!;
      expect(c.c.x).toBeCloseTo(ix, 9);
      expect(c.c.y).toBeCloseTo(iy, 9);
      expect(c.r).toBeCloseTo(5 * sc, 12);
      const l = blk.find((e): e is LineEntity => e.type === "line")!;
      expect(Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x)).toBeCloseTo(rot * D2R, 9);
      expect(r.report.counts.INSERT).toBe(1);
    });

    it("DIMENSION lida (cota nativa ou geometria do bloco), sem perda silenciosa", () => {
      const n = (r.report.counts.DIMENSION ?? 0) + (r.report.counts["DIMENSION (convertida em geometria)"] ?? 0);
      expect(n).toBe(ref.counts.DIMENSION);
    });

    it("camadas e cores preservadas", () => {
      for (const [name, color] of Object.entries(ref.layers)) {
        const l = r.layers.find((x) => x.name === name);
        expect(l, name).toBeTruthy();
        expect(l!.color).toBe(color);
      }
    });

    it("contagem por tipo bate com o ezdxf para todas as entidades suportadas", () => {
      // o relatório do AGTN conta também o conteúdo dos blocos expandidos: FURO10 = 1 CIRCLE + 1 LINE
      const fromBlock: Record<string, number> = { LINE: 1, CIRCLE: 1 };
      for (const [t, n] of Object.entries(ref.counts)) {
        if (["3DFACE", "RAY", "XLINE"].includes(t)) continue;
        const got = (r.report.counts[t] ?? 0) + (r.report.counts[`${t} (convertida em geometria)`] ?? 0);
        expect(got, t).toBe(n + (fromBlock[t] ?? 0));
      }
    });

    if (ref.version === "AC1009") {
      it("R12 sem $INSUNITS: unidade 'assumido' com aviso explícito, sem escala", () => {
        expect(r.report.unitSource).toBe("assumido");
        expect(r.report.unitFactor).toBe(1);
        expect(r.report.warnings.join(" ")).toMatch(/sem unidade definida/);
      });
    } else {
      it("R2000: $INSUNITS=4 (mm) lido, fator 1", () => {
        expect(r.report.unitSource).toBe("INSUNITS");
        expect(r.report.unitFactor).toBe(1);
      });
      it("LWPOLYLINE, ELLIPSE, SPLINE, MTEXT (2 linhas) e HATCH", () => {
        expect(of(es, "ellipse").length).toBe(1);
        expect(of(es, "spline").length).toBe(1);
        expect(of(es, "hatch").length).toBe(1);
        expect((of(es, "text") as TextEntity[]).some((t) => t.value === "LINHA 1\nLINHA 2")).toBe(true);
        const lw = (of(es, "polyline") as PolylineEntity[]).find((p) => p.pts[0].x === -200);
        expect(lw?.bulges[1]).toBe(-0.5);
      });
      it("não suportadas (3DFACE, RAY, XLINE): contadas e avisadas, nada inventado", () => {
        for (const t of ["3DFACE", "RAY", "XLINE"]) expect(r.report.unsupported[t], t).toBe(1);
        expect(Object.keys(r.report.counts)).not.toContain("3DFACE");
      });
    }
  });
}

describe("DXF — unidades", () => {
  it("$INSUNITS=5 (cm): coordenadas convertidas para mm (×10) e origem informada", () => {
    const r = readDxf(bytes("unidade_cm.dxf"));
    expect(r.report.unitSource).toBe("INSUNITS");
    expect(r.report.unitFactor).toBe(10);
    const [x1, y1, x2, y2] = REF["unidade_cm.dxf"].lines[0];
    const l = of(r.entities, "line")[0] as LineEntity;
    expect([l.a.x, l.a.y, l.b.x, l.b.y]).toEqual([x1 * 10, y1 * 10, x2 * 10, y2 * 10]);
    expect((of(r.entities, "circle")[0] as CircleEntity).r).toBe(25);
  });
});

describe("DXF — arquivos malformados não derrubam a leitura", () => {
  const full = new TextDecoder().decode(bytes("cobertura_r2000.dxf"));
  it("truncado no meio da seção ENTITIES: lê o que for válido ou falha com mensagem", () => {
    const cut = full.slice(0, Math.floor(full.length * 0.7));
    let ok = false;
    try {
      const r = readDxf(cut);
      ok = Array.isArray(r.entities) && r.entities.every((e) => JSON.stringify(e).indexOf("NaN") < 0 && JSON.stringify(e).indexOf("null,") >= -1);
    } catch (e) {
      ok = e instanceof Error && e.message.length > 0;
    }
    expect(ok).toBe(true);
  });
  it("lixo / texto que não é DXF", () => {
    let ok = false;
    try {
      const r = readDxf("isto não é um DXF\nnem de longe\n");
      ok = r.entities.length === 0;
    } catch (e) {
      ok = e instanceof Error;
    }
    expect(ok).toBe(true);
  });
  it("valores não numéricos em coordenadas não viram NaN no desenho", () => {
    const bad = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\nabc\n20\n0\n11\n10\n21\n10\n0\nCIRCLE\n8\n0\n10\n0\n20\n0\n40\n-5\n0\nENDSEC\n0\nEOF\n";
    let r: ReturnType<typeof readDxf> | null = null;
    try {
      r = readDxf(bad);
    } catch {
      r = null;
    }
    if (r) for (const e of r.entities) expect(JSON.stringify(e)).not.toMatch(/NaN|Infinity/);
  });
  it("binário refusado com mensagem (DXF binário não suportado)", () => {
    const bin = new Uint8Array([...new TextEncoder().encode("AutoCAD Binary DXF\r\n\u001a\u0000"), 0, 0, 0]);
    expect(() => readDxf(bin)).toThrow();
  });
});
