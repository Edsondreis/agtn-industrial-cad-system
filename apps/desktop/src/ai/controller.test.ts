/** Controlador do painel da IA: consentimento, prévia/confirmação, cancelamento, troca de modelo, persistência. */
import type { AiProvider, GeminiTransport, ModelReply } from "@agtn/ai";
import type { Change } from "@agtn/document";
import { CadController } from "../cad/controller";
import { AiController, type AiStorage } from "./controller";
import type { AiHost } from "./tools";

function mk(script: (() => ModelReply | Promise<ModelReply>)[], storage?: AiStorage) {
  const ctl = new CadController();
  const host: AiHost = {
    ctl,
    workspace: () => "desenho",
    showDrawing: () => undefined,
    fabLayerChanges: (): Change[] => [],
    exportDxf: async () => ({ ok: false, error: null }),
    openPlot: () => undefined,
    bodyFacts: async () => null,
  };
  const models: string[] = [];
  const transport: GeminiTransport = async () => ({ status: -2, body: "" });
  const ai = new AiController(host, {
    transport,
    storage,
    provider: (m): AiProvider => (models.push(m), { id: "t", model: m, generate: async () => (script.shift() ?? (() => ({ text: "fim", calls: [] })))() }),
  });
  return { ai, ctl, models };
}
const store = (): AiStorage & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

describe("controlador do painel da IA", () => {
  it("sem consentimento não envia nada", async () => {
    const { ai } = mk([() => ({ text: "não devia", calls: [] })]);
    await ai.send("oi");
    expect(ai.messages.map((m) => m.kind)).toEqual(["erro"]);
    expect(ai.messages[0].kind === "erro" && ai.messages[0].errKind).toBe("consentimento");
  });

  it("fluxo: pedido → prévia → confirmar → aplicado (documento alterado de verdade)", async () => {
    const { ai, ctl } = mk([() => ({ text: "", calls: [{ name: "criar_chapa_retangular", args: { largura: 500, altura: 300, x: 0, y: 0 } }] }), () => ({ text: "Chapa criada.", calls: [] })]);
    ai.setPrefs({ consent: true });
    await ai.send("chapa 500 por 300");
    expect(ai.pending?.preview.title).toMatch(/500 mm × 300 mm/);
    expect(ctl.doc.size).toBe(0);
    await ai.confirm(true);
    expect(ctl.doc.size).toBe(1);
    expect(ai.pending).toBeNull();
    expect(ai.messages.some((m) => m.kind === "aplicado" && m.ok && /IA: Chapa 500×300/.test(m.text))).toBe(true);
    expect(ai.messages.at(-1)).toMatchObject({ kind: "ia", text: "Chapa criada." });
  });

  it("cancelar com prévia pendente: nada aplicado", async () => {
    const { ai, ctl } = mk([() => ({ text: "", calls: [{ name: "criar_chapa_retangular", args: { largura: 10, altura: 10 } }] })]);
    ai.setPrefs({ consent: true });
    await ai.send("chapa");
    ai.cancel();
    expect(ai.pending).toBeNull();
    expect(ctl.doc.size).toBe(0);
  });

  it("cancelar enquanto o modelo pensa", async () => {
    let release: (v: ModelReply) => void = () => undefined;
    const { ai, ctl } = mk([() => new Promise<ModelReply>((r) => (release = r))]);
    ai.setPrefs({ consent: true });
    const p = ai.send("chapa");
    await Promise.resolve();
    expect(ai.busy).toBe(true);
    ai.cancel();
    release({ text: "", calls: [{ name: "criar_chapa_retangular", args: { largura: 10, altura: 10 } }] });
    await p;
    expect(ai.busy).toBe(false);
    expect(ai.pending).toBeNull();
    expect(ctl.doc.size).toBe(0);
    expect(ai.messages.at(-1)).toMatchObject({ kind: "aplicado", ok: false, text: "Pedido cancelado." });
  });

  it("preferências persistem; modelo só da lista gratuita; troca de modelo reinicia a conversa", () => {
    const st = store();
    const { ai, models } = mk([], st);
    ai.setPrefs({ consent: true, model: "gemini-3.5-flash-lite", rpm: 3 });
    expect(JSON.parse(st.m.get("agtn.ai.prefs")!)).toMatchObject({ consent: true, model: "gemini-3.5-flash-lite", rpm: 3 });
    expect(models.at(-1)).toBe("gemini-3.5-flash-lite");
    ai.setPrefs({ model: "gemini-4-carbon" as never });
    expect(ai.prefs.model).toBe("gemini-3.8-flash");
    const again = mk([], st).ai;
    expect(again.prefs).toMatchObject({ consent: true, model: "gemini-3.8-flash", rpm: 3 });
  });

  it("nova conversa limpa histórico, perfil e prévia", async () => {
    const { ai } = mk([() => ({ text: "", calls: [{ name: "criar_chapa_retangular", args: { largura: 10, altura: 10 } }] })]);
    ai.setPrefs({ consent: true });
    await ai.send("chapa");
    ai.newConversation();
    expect(ai.messages).toEqual([]);
    expect(ai.pending).toBeNull();
  });
});
