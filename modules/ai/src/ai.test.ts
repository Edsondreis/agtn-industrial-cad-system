/**
 * AGTN AI ASSISTANT — núcleo: validação, permissões, prévia/confirmação, cancelamento, cota, erros do provedor,
 * respostas inválidas do modelo e formato real do Gemini (transporte simulado — nenhuma chamada de rede).
 */
import { Assistant, type AssistantEvent } from "./agent";
import { GEMINI_FREE_MODELS, GeminiProvider, nextPacificMidnight, parseResponse } from "./gemini";
import { LocalQuota } from "./quota";
import { toGeminiSchema, validateArgs } from "./schema";
import { type AiProvider, type ModelReply, ProviderError, type ProviderRequest, type ToolDef, type ToolOutcome } from "./types";

/* ------------------------------ provedor roteirizado ------------------------------ */
class Scripted implements AiProvider {
  readonly id = "teste";
  readonly model = "roteiro";
  readonly seen: ProviderRequest[] = [];
  constructor(private readonly script: ((req: ProviderRequest) => ModelReply | Error)[]) {}
  async generate(req: ProviderRequest): Promise<ModelReply> {
    this.seen.push({ ...req, history: [...req.history] });
    const f = this.script.shift();
    if (!f) return { text: "(fim do roteiro)", calls: [] };
    const r = f(req);
    if (r instanceof Error) throw r;
    return r;
  }
}
const call = (name: string, args: Record<string, unknown> = {}, id?: string): ModelReply => ({ text: "", calls: [{ name, args, ...(id ? { id } : {}) }] });
const say = (text: string): ModelReply => ({ text, calls: [] });
const ac = () => new AbortController();

/** "documento" de brinquedo para as ferramentas */
function world() {
  const doc = { espessura: 3, entidades: [] as string[], desfeitos: 0 };
  const tools: ToolDef[] = [
    {
      name: "ler_documento",
      description: "lê",
      risk: "leitura",
      parameters: { type: "object", properties: {} },
      run: () => ({ status: "ok", data: { espessura: doc.espessura, entidades: doc.entidades.length } }),
    },
    {
      name: "criar_chapa",
      description: "cria chapa",
      risk: "previa",
      parameters: { type: "object", properties: { largura: { type: "number", exclusiveMinimum: 0 }, altura: { type: "number", exclusiveMinimum: 0 } }, required: ["largura", "altura"] },
      run: (a) => ({
        status: "previa",
        preview: {
          title: `Chapa ${a.largura} × ${a.altura}`,
          details: [`área ${(a.largura as number) * (a.altura as number)} mm²`],
          destructive: false,
          apply: () => {
            doc.entidades.push(`chapa ${a.largura}x${a.altura}`);
            return { status: "ok", data: { criadas: 1, total: doc.entidades.length } } as ToolOutcome;
          },
        },
      }),
    },
    {
      name: "mudar_espessura",
      description: "altera",
      risk: "previa",
      parameters: { type: "object", properties: { T: { type: "number", exclusiveMinimum: 0, maximum: 100 } }, required: ["T"] },
      run: (a) => ({
        status: "previa",
        preview: {
          title: `Espessura ${doc.espessura} → ${a.T}`,
          details: [],
          destructive: true,
          apply: () => {
            doc.espessura = a.T as number;
            return { status: "ok", data: { espessura: doc.espessura } };
          },
        },
      }),
    },
    {
      name: "desfazer",
      description: "desfaz",
      risk: "direta_reversivel",
      parameters: { type: "object", properties: {} },
      run: () => {
        doc.desfeitos++;
        doc.entidades.pop();
        return { status: "ok", data: { desfeito: true } };
      },
    },
    {
      name: "trapaceira",
      description: "ferramenta de leitura que tenta devolver prévia (bug simulado)",
      risk: "leitura",
      parameters: { type: "object", properties: {} },
      run: () => ({ status: "previa", preview: { title: "x", details: [], destructive: true, apply: () => ((doc.entidades.length = 0), { status: "ok", data: null }) } }),
    },
  ];
  return { doc, tools };
}

describe("validação dos argumentos vindos do modelo", () => {
  const s = { type: "object", properties: { T: { type: "number", exclusiveMinimum: 0, maximum: 50 }, tipo: { type: "string", enum: ["L", "U"] }, abas: { type: "array", items: { type: "number" }, maxItems: 4 } }, required: ["T"] } as const;
  it("aceita o correto e devolve só os campos declarados", () => {
    expect(validateArgs(s, { T: 6, tipo: "U", abas: [75, 200, 75] })).toEqual({ ok: true, errors: [], value: { T: 6, tipo: "U", abas: [75, 200, 75] } });
  });
  it("recusa texto no lugar de número, NaN, fora da faixa, enum inválido, campo extra, obrigatório faltando, lista longa", () => {
    const bad = [
      [{ T: "6" }, /número finito/],
      [{ T: Number.NaN }, /número finito/],
      [{ T: 0 }, /maior que 0/],
      [{ T: 80 }, /máximo 50/],
      [{ T: 3, tipo: "X" }, /não permitido/],
      [{ T: 3, rm: "-rf" }, /não existe/],
      [{}, /obrigatório/],
      [{ T: 3, abas: [1, 2, 3, 4, 5] }, /no máximo 4/],
      ["texto", /esperado objeto/],
    ] as const;
    for (const [v, re] of bad) {
      const r = validateArgs(s, v);
      expect(r.ok, JSON.stringify(v)).toBe(false);
      expect(r.errors.join(" "), JSON.stringify(v)).toMatch(re);
    }
  });
  it("esquema convertido para o formato do Gemini (OpenAPI, tipos em maiúsculas)", () => {
    expect(toGeminiSchema(s)).toEqual({
      type: "OBJECT",
      properties: { T: { type: "NUMBER", maximum: 50 }, tipo: { type: "STRING", enum: ["L", "U"], format: "enum" }, abas: { type: "ARRAY", items: { type: "NUMBER" }, maxItems: "4" } },
      required: ["T"],
    });
  });
});

describe("assistente — leitura, prévia, confirmação e resultado real", () => {
  it("leitura executa direto e o modelo recebe o valor real", async () => {
    const { tools } = world();
    const p = new Scripted([() => call("ler_documento"), (req) => say(`Espessura ${JSON.stringify(req.history.at(-1))}`)]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    const r = await a.send("qual a espessura?", ac().signal);
    expect(r.kind).toBe("resposta");
    const last = p.seen[1].history.at(-1)!;
    expect(last.role).toBe("tool");
    expect(last.role === "tool" && last.results[0].result).toEqual({ status: "ok", data: { espessura: 3, entidades: 0 } });
  });

  it("criação: para na prévia (documento intacto); confirmar aplica e o modelo recebe o resultado REAL", async () => {
    const { doc, tools } = world();
    const p = new Scripted([() => call("criar_chapa", { largura: 500, altura: 300 }, "c1"), () => say("Chapa criada.")]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    const ev: AssistantEvent[] = [];
    const r = await a.send("crie uma chapa 500 por 300", ac().signal, (e) => ev.push(e));
    expect(r.kind).toBe("aguardando_confirmacao");
    expect(doc.entidades).toEqual([]); // nada aplicado ainda
    expect(a.pending?.preview.title).toBe("Chapa 500 × 300");
    expect(ev.some((e) => e.type === "previa")).toBe(true);
    const r2 = await a.resolve(true, ac().signal, (e) => ev.push(e));
    expect(r2).toEqual({ kind: "resposta", text: "Chapa criada." });
    expect(doc.entidades).toEqual(["chapa 500x300"]);
    const toolTurn = p.seen[1].history.at(-1)!;
    expect(toolTurn.role === "tool" && toolTurn.results[0]).toEqual({ call: { name: "criar_chapa", args: { largura: 500, altura: 300 }, id: "c1" }, result: { status: "ok", data: { criadas: 1, total: 1 } } });
  });

  it("recusar a prévia: nada muda e o modelo é avisado do cancelamento", async () => {
    const { doc, tools } = world();
    const p = new Scripted([() => call("mudar_espessura", { T: 6 }), () => say("Ok, mantive 3 mm.")]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    await a.send("aumente a espessura para 6", ac().signal);
    await a.resolve(false, ac().signal);
    expect(doc.espessura).toBe(3);
    const t = p.seen[1].history.at(-1)!;
    expect(t.role === "tool" && (t.results[0].result as { mensagem: string }).mensagem).toMatch(/Cancelado pelo usuário/);
  });

  it("falha na aplicação vira erro real para o modelo (não sucesso simulado)", async () => {
    const tools: ToolDef[] = [
      { name: "x", description: "", risk: "previa", parameters: { type: "object", properties: {} }, run: () => ({ status: "previa", preview: { title: "x", details: [], destructive: false, apply: () => { throw new Error("motor recusou"); } } }) },
    ];
    const p = new Scripted([() => call("x"), () => say("ok")]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    await a.send("faça", ac().signal);
    await a.resolve(true, ac().signal);
    const t = p.seen[1].history.at(-1)!;
    expect(t.role === "tool" && t.results[0].result).toEqual({ status: "erro", mensagem: "A operação falhou no aplicativo: motor recusou" });
  });

  it("vários pedidos no mesmo turno: os seguintes à prévia não rodam e são informados ao modelo", async () => {
    const { doc, tools } = world();
    const p = new Scripted([() => ({ text: "", calls: [{ name: "ler_documento", args: {} }, { name: "mudar_espessura", args: { T: 6 } }, { name: "criar_chapa", args: { largura: 1, altura: 1 } }] }), () => say("fim")]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    await a.send("x", ac().signal);
    await a.resolve(true, ac().signal);
    expect(doc.espessura).toBe(6);
    expect(doc.entidades).toEqual([]);
    const t = p.seen[1].history.at(-1)!;
    expect(t.role === "tool" && t.results.map((r) => (r.result as { status: string }).status)).toEqual(["ok", "ok", "erro"]);
  });

  it("enquanto há prévia pendente, novo pedido é recusado (não empilha alterações)", async () => {
    const { tools } = world();
    const a = new Assistant({ provider: new Scripted([() => call("criar_chapa", { largura: 1, altura: 2 })]), tools, system: "s" });
    await a.send("x", ac().signal);
    const r = await a.send("outra", ac().signal);
    expect(r.kind === "erro" && r.error.message).toMatch(/aguardando sua confirmação/);
  });
});

describe("assistente — o modelo não contorna as permissões", () => {
  it("ferramenta inexistente (ex.: executar comando) é recusada e devolvida como erro", async () => {
    const { doc, tools } = world();
    const p = new Scripted([() => call("executar_terminal", { cmd: "del C:\\*" }), () => call("ler_arquivo", { path: "C:/Users" }), () => say("Não posso.")]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    const r = await a.send("rode um comando", ac().signal);
    expect(r.kind).toBe("resposta");
    const t1 = p.seen[1].history.at(-1)!;
    expect(t1.role === "tool" && (t1.results[0].result as { mensagem: string }).mensagem).toMatch(/não existe ou não é permitida/);
    expect(doc.entidades).toEqual([]);
  });
  it("argumentos inválidos não chegam na implementação", async () => {
    const { doc, tools } = world();
    const p = new Scripted([() => call("mudar_espessura", { T: -5 }), () => call("mudar_espessura", { T: "6mm" }), () => say("preciso da espessura")]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    const r = await a.send("espessura", ac().signal);
    expect(r.kind).toBe("resposta");
    expect(a.pending).toBeNull();
    expect(doc.espessura).toBe(3);
  });
  it("ferramenta de leitura que tenta devolver prévia é bloqueada (nada aplicado)", async () => {
    const { doc, tools } = world();
    doc.entidades.push("a", "b");
    const p = new Scripted([() => call("trapaceira"), () => say("x")]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    const r = await a.send("x", ac().signal);
    expect(r.kind).toBe("resposta");
    expect(a.pending).toBeNull();
    expect(doc.entidades).toEqual(["a", "b"]);
  });
  it("limite de passos impede laço infinito do modelo", async () => {
    const { tools } = world();
    const p = new Scripted(Array.from({ length: 50 }, () => () => call("ler_documento")));
    const a = new Assistant({ provider: p, tools, system: "s", maxSteps: 4 });
    const r = await a.send("x", ac().signal);
    expect(p.seen.length).toBe(4);
    expect(r.kind === "resposta" && r.text).toMatch(/passos demais/);
  });
});

describe("assistente — contexto atualizado, cancelamento, cota e erros", () => {
  it("o estado do documento é relido a cada passo (sem informação velha depois de alterar)", async () => {
    const { doc, tools } = world();
    const p = new Scripted([() => call("mudar_espessura", { T: 6 }), () => say("feito")]);
    const a = new Assistant({ provider: p, tools, system: "BASE", context: () => ({ espessura: doc.espessura }) });
    await a.send("6 mm", ac().signal);
    await a.resolve(true, ac().signal);
    expect(p.seen[0].system).toContain('{"espessura":3}');
    expect(p.seen[1].system).toContain('{"espessura":6}');
    expect(p.seen[1].system).not.toContain('{"espessura":3}');
  });

  it("cancelar com prévia pendente: nada aplicado, histórico fechado", async () => {
    const { doc, tools } = world();
    const a = new Assistant({ provider: new Scripted([() => call("criar_chapa", { largura: 5, altura: 5 })]), tools, system: "s" });
    await a.send("x", ac().signal);
    expect(a.cancel()).toEqual({ kind: "cancelado" });
    expect(doc.entidades).toEqual([]);
    expect(a.pending).toBeNull();
    expect(a.history.at(-1)!.role).toBe("tool");
  });

  it("cancelar durante a espera do modelo devolve cancelado e não executa ferramentas", async () => {
    const { doc, tools } = world();
    const c = ac();
    const p: AiProvider = {
      id: "lento",
      model: "x",
      generate: async () => {
        c.abort();
        return call("criar_chapa", { largura: 1, altura: 1 });
      },
    };
    const a = new Assistant({ provider: p, tools, system: "s" });
    expect(await a.send("x", c.signal)).toEqual({ kind: "cancelado" });
    expect(a.pending).toBeNull();
    expect(doc.entidades).toEqual([]);
  });

  it("cota local: não envia quando o limite configurado foi atingido", async () => {
    let t = Date.UTC(2026, 10, 16, 12, 0, 0);
    const q = new LocalQuota({ rpm: 2, rpd: 100 }, undefined, () => t);
    const p = new Scripted([() => say("1"), () => say("2"), () => say("3")]);
    const a = new Assistant({ provider: p, tools: [], system: "s", quota: q });
    await a.send("a", ac().signal);
    await a.send("b", ac().signal);
    const r = await a.send("c", ac().signal);
    expect(r.kind === "erro" && r.error.kind).toBe("cota");
    expect(p.seen.length).toBe(2);
    t += 61_000;
    expect((await a.send("d", ac().signal)).kind).toBe("resposta");
  });

  it("429 do provedor bloqueia até o horário informado, sem repetir em loop", async () => {
    let t = Date.UTC(2026, 10, 16, 12, 0, 0);
    const q = new LocalQuota({ rpm: 100, rpd: 100 }, undefined, () => t);
    const p = new Scripted([() => new ProviderError("cota", "esgotada", t + 30_000), () => say("voltou")]);
    const a = new Assistant({ provider: p, tools: [], system: "s", quota: q });
    expect((await a.send("a", ac().signal)).kind).toBe("erro");
    const r = await a.send("b", ac().signal);
    expect(r.kind === "erro" && r.error.message).toMatch(/esgotada segundo o Gemini/);
    expect(p.seen.length).toBe(1);
    t += 31_000;
    expect((await a.send("c", ac().signal)).kind).toBe("resposta");
  });

  it("sem chave / rede: erro claro, nada alterado", async () => {
    const { doc, tools } = world();
    for (const kind of ["sem_chave", "rede", "tempo_esgotado"] as const) {
      const a = new Assistant({ provider: new Scripted([() => new ProviderError(kind, `erro ${kind}`)]), tools, system: "s" });
      const r = await a.send("x", ac().signal);
      expect(r.kind === "erro" && r.error.kind).toBe(kind);
    }
    expect(doc.entidades).toEqual([]);
  });
});

/* ------------------------------ Gemini: formato real ------------------------------ */
describe("Gemini — só nível gratuito, formato da API e erros", () => {
  it("lista só modelos gratuitos e recusa qualquer outro (inclusive pagos)", () => {
    expect(GEMINI_FREE_MODELS.map((m) => m.id)).toEqual(["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    for (const m of ["gemini-4-carbon", "gemini-3.1-pro-preview", "gemini-2.5-pro", "qualquer"]) expect(() => new GeminiProvider({ model: m, transport: async () => ({ status: 200, body: "{}" }) })).toThrow(/nível gratuito/);
  });

  it("corpo enviado: sistema, histórico com functionCall/functionResponse, ferramentas declaradas; nada de busca/cache", () => {
    const { tools } = world();
    const g = new GeminiProvider({ transport: async () => ({ status: 200, body: "{}" }) });
    const raw = { role: "model", parts: [{ functionCall: { name: "ler_documento", args: {}, id: "a1" }, thoughtSignature: "SIG==" }] };
    const body = JSON.parse(
      g.buildBody({
        system: "SYS",
        tools: tools.slice(0, 2),
        history: [
          { role: "user", text: "oi" },
          { role: "model", text: "", calls: [{ name: "ler_documento", args: {}, id: "a1" }], raw },
          { role: "tool", results: [{ call: { name: "ler_documento", args: {}, id: "a1" }, result: { status: "ok", data: 1 } }] },
        ],
      }),
    );
    expect(body.systemInstruction).toEqual({ parts: [{ text: "SYS" }] });
    expect(body.contents[1]).toEqual(raw); // partes do modelo reenviadas intactas (thoughtSignature)
    expect(body.contents[2]).toEqual({ role: "user", parts: [{ functionResponse: { name: "ler_documento", id: "a1", response: { result: { status: "ok", data: 1 } } } }] });
    expect(body.tools[0].functionDeclarations.map((f: { name: string }) => f.name)).toEqual(["ler_documento", "criar_chapa"]);
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: "AUTO" } });
    const s = JSON.stringify(body);
    for (const paid of ["googleSearch", "google_search", "cachedContent", "codeExecution", "urlContext", "retrieval"]) expect(s).not.toContain(paid);
  });

  it("resposta com texto + functionCall (pensamento ignorado no texto, partes cruas guardadas)", () => {
    const body = JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "pensando…", thought: true }, { text: "Vou medir." }, { functionCall: { name: "medir", args: { a: 1 }, id: "f9" }, thoughtSignature: "X" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 },
    });
    const r = parseResponse({ status: 200, body }, Date.now);
    expect(r.text).toBe("Vou medir.");
    expect(r.calls).toEqual([{ name: "medir", args: { a: 1 }, id: "f9" }]);
    expect(r.usage).toEqual({ input: 120, output: 30, total: 150 });
    expect((r.raw as { parts: unknown[] }).parts).toHaveLength(3);
  });

  it("429 com RetryInfo → cota com horário; 429 diário → próxima meia-noite do Pacífico", () => {
    const now = Date.UTC(2026, 10, 16, 15, 0, 0);
    const e1 = (() => {
      try {
        parseResponse({ status: 429, body: JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" }] } }) }, () => now);
      } catch (e) {
        return e as ProviderError;
      }
    })()!;
    expect(e1.kind).toBe("cota");
    expect(e1.retryAt).toBe(now + 37_000);
    const e2 = (() => {
      try {
        parseResponse({ status: 429, body: JSON.stringify({ error: { details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } }) }, () => now);
      } catch (e) {
        return e as ProviderError;
      }
    })()!;
    expect(e2.message).toMatch(/limite diário/);
    expect(e2.retryAt).toBe(nextPacificMidnight(now));
    // 16/11/2026 15:00 UTC = 07:00 PST → renovação às 08:00 UTC do dia 17
    expect(new Date(e2.retryAt!).toISOString()).toBe("2026-11-17T08:00:00.000Z");
  });

  it("erros classificados: sem chave, chave inválida, 403, 404, 500, rede, tempo, bloqueio, JSON ruim, resposta vazia, chamada malformada", () => {
    const cases: [number, string, string][] = [
      [-2, "", "sem_chave"],
      [400, JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), "chave_invalida"],
      [403, "{}", "chave_invalida"],
      [404, "{}", "indisponivel"],
      [503, "{}", "servico"],
      [0, "", "rede"],
      [-1, "", "tempo_esgotado"],
      [200, JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), "bloqueado"],
      [200, "<html>", "resposta_invalida"],
      [200, JSON.stringify({ candidates: [] }), "resposta_invalida"],
      [200, JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "MALFORMED_FUNCTION_CALL" }] }), "resposta_invalida"],
      [200, JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { args: {} } }] } }] }), "resposta_invalida"],
    ];
    for (const [status, body, kind] of cases) {
      let got: ProviderError | null = null;
      try {
        parseResponse({ status, body }, Date.now);
      } catch (e) {
        got = e as ProviderError;
      }
      expect(got?.kind, `${status} ${body.slice(0, 40)}`).toBe(kind);
    }
  });

  it("args do modelo que não são objeto viram {} e são barrados pela validação da ferramenta", async () => {
    const r = parseResponse({ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "criar_chapa", args: "500x300" } }] } }] }) }, Date.now);
    expect(r.calls[0].args).toEqual({});
    const { doc, tools } = world();
    const p = new Scripted([() => r, () => say("Qual a largura e a altura?")]);
    const a = new Assistant({ provider: p, tools, system: "s" });
    expect((await a.send("chapa", ac().signal)).kind).toBe("resposta");
    expect(doc.entidades).toEqual([]);
  });

  it("transporte que falha (sem rede) vira erro de rede claro", async () => {
    const g = new GeminiProvider({ transport: async () => { throw new Error("dns"); } });
    await expect(g.generate({ system: "", history: [], tools: [], signal: ac().signal })).rejects.toMatchObject({ kind: "rede" });
  });
});
