/**
 * AGTN AI ASSISTANT — ferramentas contra o CAD REAL (CadController + CadDocument + motor SHEET METAL + OCCT).
 * O modelo é simulado (roteiro), as ferramentas e o documento são os do aplicativo. Nada aqui imita sucesso: cada
 * verificação lê o documento depois da operação.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Assistant, type AiProvider, type ModelReply, type ProviderRequest, type ToolDef, SYSTEM_PROMPT } from "@agtn/ai";
import type { Change } from "@agtn/document";
import { type Entity, makeEntity, polylineSignedArea } from "@agtn/geometry";
import { BodyCache, addBody, commitModel, emptyModel, getModel, insertStepTree } from "@agtn/model3d";
import { OcctSolidKernel } from "@agtn/solid";
import { SM_LAYERS } from "@agtn/sheetmetal";
import { CadController } from "../cad/controller";
import { type AiHost, AiSession, type BodyFacts3D, cadContext, createCadTools } from "./tools";

const STEP = fileURLToPath(new URL("../../../../tests/step/", import.meta.url));

class Scripted implements AiProvider {
  readonly id = "teste";
  readonly model = "roteiro";
  readonly seen: ProviderRequest[] = [];
  constructor(private readonly script: ((req: ProviderRequest) => ModelReply)[]) {}
  async generate(req: ProviderRequest) {
    this.seen.push({ ...req, history: [...req.history] });
    const f = this.script.shift();
    return f ? f(req) : { text: "(fim)", calls: [] };
  }
}
const call = (name: string, args: Record<string, unknown> = {}): ModelReply => ({ text: "", calls: [{ name, args }] });
const say = (text: string): ModelReply => ({ text, calls: [] });
/** último resultado de ferramenta que o modelo recebeu */
const lastResult = (p: Scripted, i = -1) => {
  const t = p.seen.at(i)!.history.at(-1)!;
  if (t.role !== "tool") throw new Error("último turno não é de ferramenta");
  return t.results.at(-1)!.result as { status: string; data?: Record<string, unknown>; mensagem?: string; pergunta?: string };
};
const sig = () => new AbortController().signal;

function setup(facts: (ids: string[]) => Promise<Record<string, BodyFacts3D> | null> = async () => null) {
  const ctl = new CadController();
  const log: string[] = [];
  const host: AiHost = {
    ctl,
    workspace: () => "desenho",
    showDrawing: () => log.push("desenho"),
    fabLayerChanges: (): Change[] => {
      const out: Change[] = [];
      let n = ctl.doc.layers.length;
      for (const l of SM_LAYERS) if (!ctl.doc.layer(l.name)) out.push({ kind: "layer-add", layer: { name: l.name, color: l.color, lineweight: l.lineweight, linetype: l.linetype, visible: true, locked: false }, index: n++ });
      return out;
    },
    exportDxf: async () => (log.push("exportar"), { ok: true, path: "C:\\AGTN\\saida.dxf", version: "R2000" }),
    openPlot: () => log.push("plot"),
    bodyFacts: facts,
  };
  const session = new AiSession();
  const tools = createCadTools(host, session);
  return { ctl, host, session, tools, log };
}

describe("IA × CAD — diálogo do exemplo, de ponta a ponta", () => {
  it("perfil U 200×75 #6: prévia real → confirmar → seção no desenho → planificação pede K → K do projeto → blank; desfazer restaura", async () => {
    const { ctl, host, session, tools } = setup();
    const p = new Scripted([
      () => call("criar_perfil_chapa", { tipo: "U", espessura: 6, medidas: [75, 200, 75], raio_interno: 6 }),
      () => say("Perfil U criado. Deseja gerar a planificação?"),
      () => call("gerar_planificacao", {}),
      () => say("Antes de gerar, preciso confirmar o fator K ou utilizar o valor configurado no projeto."),
      () => call("gerar_planificacao", { usar_k_do_projeto: true, comprimento: 1000 }),
      () => say("Planificação gerada."),
    ]);
    const a = new Assistant({ provider: p, tools, system: SYSTEM_PROMPT, context: () => cadContext(host, session) });

    // 1) criar → prévia; documento intacto
    const r1 = await a.send("Crie um perfil U de 200 mm de alma, abas de 75 mm e espessura de 6 mm.", sig());
    expect(r1.kind).toBe("aguardando_confirmacao");
    expect(ctl.doc.size).toBe(0);
    const pv = a.pending!.preview;
    expect(pv.title).toMatch(/Perfil U/);
    expect(pv.details.join("\n")).toMatch(/Base \(largura\): 200 mm/);
    expect((pv.visual as { entities: Entity[] }).entities.length).toBeGreaterThan(0);

    // 2) "Pode criar." → aplica de verdade
    const r2 = await a.resolve(true, sig());
    expect(r2).toMatchObject({ kind: "resposta", text: "Perfil U criado. Deseja gerar a planificação?" });
    expect(lastResult(p)).toMatchObject({ status: "ok", data: { aplicado: true, transacao: "IA: Seção Perfil U" } });
    const secIds = session.profile!.sectionIds;
    expect(secIds.length).toBeGreaterThan(0);
    expect(secIds.every((id) => ctl.doc.has(id))).toBe(true);
    expect(ctl.doc.undoLabel).toBe("IA: Seção Perfil U");
    // seção conferida: contorno fechado com área = T × comprimento médio da fibra (exato pelo motor)
    const contour = secIds.map((id) => ctl.doc.get(id)!).find((e) => e.type === "polyline" && e.closed) as Extract<Entity, { type: "polyline" }>;
    expect(contour).toBeTruthy();
    expect(Math.abs(polylineSignedArea(contour.pts, contour.bulges))).toBeGreaterThan(6 * (75 + 200 + 75 - 4 * 6) * 0.9);

    // 3) "Sim." → planificação sem K → a ferramenta PERGUNTA (não inventa)
    const r3 = await a.send("Sim.", sig());
    expect(r3.kind).toBe("resposta");
    expect(lastResult(p)).toMatchObject({ status: "precisa_informacao" });
    expect(lastResult(p).pergunta).toMatch(/fator K/);
    expect(session.profile!.flatIds).toEqual([]);

    // 4) "use o do projeto" → prévia com K da tabela → confirmar → blank no desenho
    const r4 = await a.send("Use o do projeto, comprimento 1000.", sig());
    expect(r4.kind).toBe("aguardando_confirmacao");
    const det = a.pending!.preview.details.join("\n");
    expect(det).toMatch(/Fator K = 0\.\d+ \(tabela do projeto/);
    expect(det).toMatch(/× 1\.000 mm/);
    await a.resolve(true, sig());
    expect(lastResult(p)).toMatchObject({ status: "ok", data: { transacao: "IA: Planificação Perfil U" } });
    expect(session.profile!.flatIds.every((id) => ctl.doc.has(id))).toBe(true);
    expect(session.profile!.k?.source).toMatch(/tabela do projeto/);
    expect(ctl.doc.layer("LINHAS_DOBRA")).toBeTruthy();

    // 5) desfazer (Ctrl+Z do CAD) remove a planificação inteira
    const n = ctl.doc.size;
    ctl.undo();
    expect(ctl.doc.size).toBeLessThan(n);
    expect(session.profile!.flatIds.some((id) => ctl.doc.has(id))).toBe(false);
  });

  it("'Aumente a espessura para 6 mm' com perfil já no desenho: prévia destrutiva de substituição, depois troca os objetos", async () => {
    const { ctl, session, tools } = setup();
    const p = new Scripted([
      () => call("criar_perfil_chapa", { tipo: "L", espessura: 3, medidas: [80, 100], raio_interno: 3 }),
      () => say("ok"),
      () => call("editar_perfil_chapa", { espessura: 6, raio_interno: 6 }),
      () => say("ok"),
    ]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    await a.send("cantoneira 80x100 #3 R3", sig());
    await a.resolve(true, sig());
    const before = [...session.profile!.sectionIds];
    const r = await a.send("aumente a espessura para 6 mm", sig());
    expect(r.kind).toBe("aguardando_confirmacao");
    expect(a.pending!.preview.destructive).toBe(true);
    expect(a.pending!.preview.details.join(" ")).toMatch(/espessura 3 → 6 mm/);
    expect(before.every((id) => ctl.doc.has(id))).toBe(true); // ainda não trocou
    await a.resolve(true, sig());
    expect(before.some((id) => ctl.doc.has(id))).toBe(false);
    expect(session.profile!.params.T).toBe(6);
    expect(session.profile!.sectionIds.every((id) => ctl.doc.has(id))).toBe(true);
  });

  it("faltou o raio: a ferramenta pergunta em vez de assumir", async () => {
    const { tools } = setup();
    const t = tools.find((x) => x.name === "criar_perfil_chapa")!;
    const o = await t.run({ tipo: "U", espessura: 6, medidas: [75, 200, 75] }, { signal: sig() });
    expect(o).toMatchObject({ status: "precisa_informacao" });
    const o2 = await t.run({ tipo: "U", espessura: 6, medidas: [75, 200], raio_interno: 6 }, { signal: sig() });
    expect(o2.status === "precisa_informacao" && o2.question).toMatch(/3 medidas/);
  });
});

describe("IA × CAD — medições e desenho 2D", () => {
  const tool = (tools: ToolDef[], n: string) => tools.find((t) => t.name === n)!;
  it("chapa 500 × 300: prévia com área exata; aplica; ler_selecao/calcular_area conferem; mover/apagar pedem confirmação", async () => {
    const { ctl, tools } = setup();
    const o = await tool(tools, "criar_chapa_retangular").run({ largura: 500, altura: 300, raio_canto: 20, x: 0, y: 0 }, { signal: sig() });
    expect(o.status).toBe("previa");
    if (o.status !== "previa") return;
    const exact = 500 * 300 - (4 - Math.PI) * 20 * 20;
    expect((o.data as { area_mm2: number }).area_mm2).toBeCloseTo(exact, 3);
    expect(ctl.doc.size).toBe(0);
    const ap = await o.preview.apply();
    expect(ap).toMatchObject({ status: "ok", data: { transacao: "IA: Chapa 500×300", posicao: [0, 0] } });
    const plate = ctl.doc.all()[0];
    ctl.sel.set([plate.id]);
    const sel = await tool(tools, "ler_selecao").run({}, { signal: sig() });
    expect(sel.status === "ok" && (sel.data as { objetos: { area: number }[] }).objetos[0].area).toBeCloseTo(exact, 3);
    const area = await tool(tools, "calcular_area").run({}, { signal: sig() });
    expect(area.status === "ok" && (area.data as { area_total: number }).area_total).toBeCloseTo(exact, 3);

    const mv = await tool(tools, "mover_selecao").run({ dx: 100, dy: -50 }, { signal: sig() });
    expect(mv.status === "previa" && mv.preview.destructive).toBe(true);
    expect((ctl.doc.get(plate.id) as Extract<Entity, { type: "polyline" }>).pts[0]).toEqual({ x: 20, y: 0 }); // não moveu ainda
    if (mv.status === "previa") await mv.preview.apply();
    expect((ctl.doc.get(plate.id) as Extract<Entity, { type: "polyline" }>).pts[0]).toEqual({ x: 120, y: -50 });

    const del = await tool(tools, "apagar_selecao").run({}, { signal: sig() });
    expect(del.status === "previa" && del.preview.destructive).toBe(true);
    expect(ctl.doc.has(plate.id)).toBe(true);
    if (del.status === "previa") await del.preview.apply();
    expect(ctl.doc.has(plate.id)).toBe(false);
    ctl.undo();
    expect(ctl.doc.has(plate.id)).toBe(true); // apagar pela IA é desfazível
  });

  it("prévia velha: se o desenho mudou entre a prévia e a confirmação, NÃO aplica", async () => {
    const { ctl, tools } = setup();
    const line = makeEntity({ type: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, "0");
    ctl.doc.commit("linha", ctl.doc.addChanges([line]));
    ctl.sel.set([line.id]);
    const del = await tool(tools, "apagar_selecao").run({}, { signal: sig() });
    // usuário edita algo antes de confirmar
    ctl.doc.commit("outra", ctl.doc.addChanges([makeEntity({ type: "circle", c: { x: 5, y: 5 }, r: 2 }, "0")]));
    const r = del.status === "previa" ? await del.preview.apply() : null;
    expect(r).toMatchObject({ status: "erro" });
    expect(r?.status === "erro" && r.message).toMatch(/mudou depois da prévia/);
    expect(ctl.doc.has(line.id)).toBe(true);
  });

  it("distância: entre pontos informados (exata) e entre dois objetos selecionados; pede o que falta", async () => {
    const { ctl, tools } = setup();
    const t = tool(tools, "medir_distancia");
    expect(await t.run({ x1: 0, y1: 0, x2: 300, y2: 400 }, { signal: sig() })).toMatchObject({ status: "ok", data: { distancia: 500, grau: "exato" } });
    expect((await t.run({ x1: 0 }, { signal: sig() })).status).toBe("precisa_informacao");
    const c1 = makeEntity({ type: "circle", c: { x: 0, y: 0 }, r: 10 }, "0");
    const l1 = makeEntity({ type: "line", a: { x: 50, y: -100 }, b: { x: 50, y: 100 } }, "0");
    ctl.doc.commit("x", ctl.doc.addChanges([c1, l1]));
    ctl.sel.set([c1.id, l1.id]);
    const d = await t.run({}, { signal: sig() });
    expect(d.status === "ok" && (d.data as { distancia: number }).distancia).toBeCloseTo(40, 6);
  });

  it("folha A4 1:5 e exportações: prévia; exportar só diz 'exportado' com o caminho real; PDF abre a janela", async () => {
    const { ctl, tools, log } = setup();
    const a4 = await tool(tools, "criar_folha_a4").run({ escala: 5, titulo: "suporte" }, { signal: sig() });
    expect(a4.status === "previa" && a4.preview.details[0]).toMatch(/1\.485 mm × 1\.050 mm/);
    if (a4.status === "previa") await a4.preview.apply();
    expect(ctl.doc.layer("FORMATO")).toBeTruthy();
    expect(ctl.doc.all().some((e) => e.type === "text" && e.value === "SUPORTE")).toBe(true);
    const ex = await tool(tools, "exportar_dxf").run({}, { signal: sig() });
    expect(log).not.toContain("exportar"); // só depois de confirmar
    const r = ex.status === "previa" ? await ex.preview.apply() : null;
    expect(r).toMatchObject({ status: "ok", data: { exportado: true, arquivo: "saida.dxf" } });
    const pdf = await tool(tools, "exportar_pdf").run({}, { signal: sig() });
    if (pdf.status === "previa") await pdf.preview.apply();
    expect(log).toContain("plot");
  });

  it("exportação cancelada na janela de salvar: resultado real é 'cancelada', nunca 'exportado'", async () => {
    const s = setup();
    s.host.exportDxf = async () => ({ ok: false, error: null });
    const tools = createCadTools(s.host, s.session);
    s.ctl.doc.commit("x", s.ctl.doc.addChanges([makeEntity({ type: "point", p: { x: 0, y: 0 } }, "0")]));
    const ex = await tools.find((t) => t.name === "exportar_dxf")!.run({}, { signal: sig() });
    const r = ex.status === "previa" ? await ex.preview.apply() : null;
    expect(r).toMatchObject({ status: "erro" });
    expect(r?.status === "erro" && r.message).toMatch(/nenhum arquivo foi gravado/);
  });

  it("desfazer pela IA = Ctrl+Z do CAD; contexto enviado ao modelo é mínimo (sem nome de arquivo/pasta)", async () => {
    const { ctl, host, session, tools } = setup();
    ctl.doc.commit("Linha de teste", ctl.doc.addChanges([makeEntity({ type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }, "0")]));
    const u = await tools.find((t) => t.name === "desfazer_ultima_operacao")!.run({}, { signal: sig() });
    expect(u).toMatchObject({ status: "ok", data: { desfeito: "Linha de teste", pode_refazer: true } });
    expect(ctl.doc.size).toBe(0);
    const ctx = JSON.stringify(cadContext(host, session));
    expect(ctx).not.toMatch(/\\|\/|\.agtncad|\.dxf/);
    expect(ctx).toContain('"total_entidades":0');
  });
});

describe("IA × 3D — volume só como resultado de engenharia quando exato", () => {
  let k: OcctSolidKernel;
  beforeAll(async () => {
    k = await OcctSolidKernel.create();
  });
  afterAll(() => k.dispose());

  it("caixa 100×50×20: volume exato 100 000 mm³; vaso incoerente: 'invalido', sem valores, com motivo e face", async () => {
    const s = setup();
    let m = emptyModel();
    const box = addBody(m, { name: "CAIXA", source: { type: "primitive", spec: { kind: "box", w: 100, d: 50, h: 20 } } });
    m = box.model;
    const nodes = k.importStepTree(readFileSync(STEP + "p-f5-01/vessel_inconsistente.step", "latin1"));
    m = insertStepTree(m, nodes, "VASO").model;
    commitModel(s.ctl.doc, "modelo", m);
    const cache = new BodyCache(k);
    cache.sync(getModel(s.ctl.doc));
    s.host.bodyFacts = async (ids) => {
      const out: Record<string, BodyFacts3D> = {};
      for (const id of ids) {
        const r = cache.get(id);
        if (r !== undefined) out[id] = { props: k.props(r), topo: k.topology(r), check: k.checkGeometry(r) };
      }
      return out;
    };
    const tools = createCadTools(s.host, s.session);
    const o = await tools.find((t) => t.name === "info_solidos_3d")!.run({}, { signal: sig() });
    expect(o.status).toBe("ok");
    const corpos = (o.status === "ok" ? (o.data as { corpos: Record<string, unknown>[] }).corpos : []) as { nome: string; grau: string; volume_mm3?: number; motivo?: string[]; valores?: string }[];
    const cx = corpos.find((c) => c.nome === "CAIXA")!;
    expect(cx.grau).toBe("exato");
    expect(cx.volume_mm3).toBeCloseTo(100000, 6);
    const vs = corpos.find((c) => c.grau !== "exato")!;
    expect(vs.grau).toBe("invalido");
    expect(vs.volume_mm3).toBeUndefined();
    expect(vs.valores).toMatch(/não apresentados/);
    expect(vs.motivo!.join(" ")).toMatch(/revolution.*desvio 60/);
    cache.clear();
  });

  it("motor 3D não carregado: diz para abrir a aba 3D (não inventa)", async () => {
    const s = setup(async () => null);
    let m = emptyModel();
    m = addBody(m, { source: { type: "primitive", spec: { kind: "box", w: 1, d: 1, h: 1 } } }).model;
    commitModel(s.ctl.doc, "m", m);
    const o = await createCadTools(s.host, s.session).find((t) => t.name === "info_solidos_3d")!.run({}, { signal: sig() });
    expect(o.status === "erro" && o.message).toMatch(/Abra a aba 3D/);
  });
});
