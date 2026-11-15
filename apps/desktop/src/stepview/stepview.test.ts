/**
 * FASE 5 — STEP abre como documento próprio: roteamento (nunca vira desenho, nunca descarta o desenho
 * atual), filtros de arquivo, recentes e regras de segurança do visualizador.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CadController } from "../cad/controller";
import { FileActions, isStepName, unitNote } from "../app/files";
import { RecentStore } from "../app/recents";
import { isOpenablePath } from "../platform/platform";

const SRC = fileURLToPath(new URL("./", import.meta.url));
const read = (f: string) => readFileSync(SRC + f, "utf8");

describe("STEP — roteamento de abertura", () => {
  it(".step/.stp (qualquer caixa) são abríveis e reconhecidos como STEP", () => {
    for (const p of ["C:\\a\\peça.step", "/x/y.STP", "conj.Step"]) {
      expect(isOpenablePath(p)).toBe(true);
      expect(isStepName(p)).toBe(true);
    }
    expect(isStepName("a.agtncad")).toBe(false);
    expect(isStepName("a.dxf")).toBe(false);
    expect(isOpenablePath("a.stl")).toBe(false);
  });

  it("soltar um STEP vai para o visualizador e NÃO toca no desenho (nem pergunta descarte)", async () => {
    const doc = { dirty: true, reset: vi.fn(), load: vi.fn() };
    const ctl = { doc, cancel: vi.fn(), sel: { clear: vi.fn() }, message: vi.fn(), zoomExtents: vi.fn(), actions: new Map() } as unknown as CadController;
    const fa = new FileActions(ctl);
    const got: { name: string; bytes: Uint8Array; path: string | null }[] = [];
    fa.onStep = (f) => got.push(f);
    const file = new File([new TextEncoder().encode("ISO-10303-21;\n")], "modelo.stp");
    expect(await fa.openDropped(file)).toBe(true);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ name: "modelo.stp", path: null });
    expect(doc.load).not.toHaveBeenCalled();
    expect(doc.reset).not.toHaveBeenCalled();
    expect(fa.file.path).toBeNull();
  });

  it("recentes marcam STEP como 'step'", () => {
    const m = new Map<string, string>();
    const r = new RecentStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) });
    r.touch("D:\\modelos\\Flange 607.STEP");
    expect(r.list()[0]).toMatchObject({ name: "Flange 607", kind: "step" });
  });
});

describe("DXF — unidade explícita na mensagem", () => {
  const base = { version: "AC1015", encoding: "utf-8", counts: {}, unsupported: {}, warnings: [] };
  it("declarada mm, convertida, ou ausente (sem escala)", () => {
    expect(unitNote({ ...base, unitFactor: 1, unitSource: "INSUNITS" })).toMatch(/mm/);
    expect(unitNote({ ...base, unitFactor: 10, unitSource: "INSUNITS" })).toMatch(/×10/);
    expect(unitNote({ ...base, unitFactor: 1, unitSource: "assumido" })).toMatch(/não declarada.*sem escala/);
  });
});

describe("visualizador STEP — segurança e não-regressão", () => {
  const viewer = read("StepViewer.tsx");
  it("sem geração dinâmica de código", () => {
    expect(viewer).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*["'`]/);
  });
  it("motor próprio por documento, liberado ao fechar (dispose do worker e do viewport)", () => {
    expect(viewer).toMatch(/new Engine\(\)/);
    expect(viewer).toMatch(/e\.dispose\(\)/);
    expect(viewer).toMatch(/v\.dispose\(\)/);
  });
  it("não usa o motor/documento do projeto (.agtncad intocado)", () => {
    expect(viewer).not.toMatch(/engine\(\)/);
    expect(viewer).not.toMatch(/doc\.commit|setModel\(doc|extras\.agtn3d/);
  });
  it("os cinco estados pedidos existem com o texto exato", () => {
    const sd = readFileSync(fileURLToPath(new URL("../../../../core/model3d/src/stepdoc.ts", import.meta.url)), "utf8");
    for (const s of ["Carregando arquivo", "Interpretando geometria", "Gerando visualização", "Arquivo pronto", "Falha na leitura"]) expect(sd).toContain(`"${s}"`);
  });
});
