import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CadDocument, deserializeInto, serializeDocument } from "@agtn/document";
import { DEFAULT_PLOT, layoutPlot, plotToPdf, plotToSvg } from "@agtn/plot";
import { writeDxf } from "./index";

/**
 * FASE 4 · ETAPA 3 — R1: regressão do CAD 2D publicado (v3.1.1).
 * `tests/regressao2d/v311_desenho.agtncad` foi GRAVADO PELO CÓDIGO DA MAIN 23a2540 (worktree), com entidades
 * de todos os tipos, cotas, textos com acento, perfil U (planificação + seção) e duas bandejas (710.0CUH25-01-03
 * e enrijecida com alívio redondo). Os hashes de DXF R12, DXF 2000, SVG e PDF (sem a data de criação) foram
 * medidos no mesmo código. Aqui o arquivo é aberto pelo código ATUAL e tudo precisa sair byte a byte igual.
 */
const DIR = new URL("../../../tests/regressao2d/", import.meta.url);
const text = readFileSync(new URL("v311_desenho.agtncad", DIR), "utf8");
const ref = JSON.parse(readFileSync(new URL("v311_hashes.json", DIR), "utf8"));
const h = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("regressão 2D: arquivo da v3.1.1 aberto pelo código atual", () => {
  const doc = new CadDocument();
  const rep = deserializeInto(doc, text);
  it("abre sem perda: todas as entidades e camadas, sem avisos", () => {
    expect(rep.skipped).toEqual([]);
    expect(rep.warnings).toEqual([]);
    expect(rep.loaded).toBe(ref.entidades);
    expect(doc.layers.length).toBe(ref.camadas);
  });
  it("salvar de novo = arquivo idêntico ao gravado pela v3.1.1", () => {
    const j = JSON.parse(serializeDocument(doc, "golden"));
    j.savedAt = "2026-01-01T00:00:00.000Z";
    expect(h(JSON.stringify(j))).toBe(ref.agtncad);
  });
  it("DXF R12, DXF 2000, SVG e PDF byte a byte iguais aos da v3.1.1", () => {
    expect(h(writeDxf({ layers: doc.layers, entities: doc.all() }, { version: "R12" }))).toBe(ref.dxfR12);
    expect(h(writeDxf({ layers: doc.layers, entities: doc.all() }, { version: "R2000" }))).toBe(ref.dxfR2000);
    const page = layoutPlot({ entities: doc.all(), layers: doc.layers }, { ...DEFAULT_PLOT, paper: "A3" });
    expect(h(plotToSvg(page))).toBe(ref.svg);
    const pdf = new TextDecoder("latin1").decode(plotToPdf(page, { title: "golden", author: "AGTN" })).replace(/CreationDate \(D:\d+Z\)/, "CreationDate (D:00000000000000Z)");
    expect(h(new Uint8Array([...pdf].map((c) => c.charCodeAt(0))))).toBe(ref.pdfSemData);
  });
});
