import { readFileSync } from "node:fs";
import { type Feature, OcctSolidKernel, PartEvaluator } from "@agtn/solid";
import { parseModel3D, rename } from "@agtn/model3d";

/**
 * Compatibilidade do `.agtncad` (FASE 4 · 2.4): arquivo de versão MAIS NOVA, com operações de chapa, uma
 * operação desconhecida e campos novos no modelo, no nó, na fonte e dentro de uma operação.
 */
const RAW = JSON.parse(readFileSync(new URL("./fixtures/fase4_desconhecido.json", import.meta.url), "utf8"));
const clone = () => JSON.parse(JSON.stringify(RAW));

describe("compatibilidade .agtncad (FASE 4)", () => {
  it("abrir e salvar sem editar → idêntico (campos desconhecidos preservados em todos os níveis)", () => {
    const rep = parseModel3D(clone());
    expect(rep.warnings).toEqual([]);
    expect(JSON.parse(JSON.stringify(rep.model))).toEqual(RAW);
  });
  it("abrir, EDITAR o 3D (renomear) e salvar → só o nome muda; desconhecidos continuam", () => {
    const { model } = parseModel3D(clone());
    const out = JSON.parse(JSON.stringify(rename(model, "b1", "Chapa_lateral")));
    const want = clone();
    want.nodes.b1.name = "Chapa_lateral";
    expect(out).toEqual(want);
    expect(out.futuroModelo).toEqual({ montagem: "M-01" });
    expect(out.nodes.b1.futuroNo).toEqual({ lote: "L-2027-001", prioridade: 2 });
    expect(out.nodes.b1.source.futuroFonte).toEqual(["dobradeira", "laser"]);
    expect(out.nodes.b1.source.features[2].campoNovo).toEqual({ alivio: "oblongo" });
    expect(out.nodes.b1.source.features[3]).toEqual(RAW.nodes.b1.source.features[3]);
  });
  it("regenerar: operação desconhecida → erro claro e preservada; sem motor de chapa → erro explícito", async () => {
    const K = await OcctSolidKernel.create();
    const ev = new PartEvaluator(K);
    const { model } = parseModel3D(clone());
    const node = model.nodes.b1;
    if (node.kind !== "body" || node.source.type !== "part") throw new Error("fixture");
    const r = ev.evaluate("b1", node.source.features as readonly Feature[]);
    expect(r.status.map((s) => s.state)).toEqual(["ok", "error", "dependency_error", "error"]);
    expect(r.status[1].error).toContain("motor de chapa não está carregado");
    expect(r.status[3].error).toContain("versão mais nova do AGTN CAD");
    ev.releaseAll();
    K.dispose();
  });
  it("arquivo sem chapa (FASE 2/3) continua idêntico ao abrir/salvar", () => {
    const old = clone();
    old.nodes.b1.source.features = old.nodes.b1.source.features.slice(0, 1);
    delete old.futuroModelo;
    delete old.nodes.b1.futuroNo;
    delete old.nodes.b1.source.futuroFonte;
    const rep = parseModel3D(JSON.parse(JSON.stringify(old)));
    expect(JSON.parse(JSON.stringify(rep.model))).toEqual(old);
  });
});
