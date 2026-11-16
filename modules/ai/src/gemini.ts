/**
 * Provedor Google Gemini — SOMENTE nível gratuito (decisão do Edson, 12/11/2026).
 *
 * - Endpoint `POST /v1beta/models/{modelo}:generateContent` (documentado e sem aviso de obsolescência em 16/11/2026).
 * - Só modelos de texto marcados "Free of charge" na página de preços do Google AI Studio (lida em 16/11/2026). O
 *   provedor RECUSA qualquer outro nome de modelo — nunca troca sozinho para um modelo pago.
 * - Nenhum recurso pago é declarado: sem busca/grounding, sem cache de contexto, sem Batch, sem imagem/vídeo.
 * - A chamada HTTP não acontece aqui: o transporte é injetado (no app, um comando Rust que lê a chave do
 *   Gerenciador de Credenciais do Windows; a chave nunca passa pelo JavaScript).
 * - As partes devolvidas pelo modelo (incluindo `thoughtSignature`) são guardadas e reenviadas sem alteração, como o
 *   Gemini 3 exige.
 */
import { toGeminiSchema } from "./schema";
import { type AiProvider, type ModelReply, ProviderError, type ProviderRequest, type ToolCallReq, type Turn } from "./types";

export const GEMINI_FREE_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (padrão)" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite (mais leve)" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
] as const;
export type GeminiFreeModel = (typeof GEMINI_FREE_MODELS)[number]["id"];
export const GEMINI_DEFAULT_MODEL: GeminiFreeModel = "gemini-3.8-flash";
/** de onde veio a lista (revisar quando o Google mudar os modelos) */
export const GEMINI_FREE_LIST_SOURCE = "página de preços do Google AI Studio, coluna Free Tier = \"Free of charge\", lida em 16/11/2026";

export const isFreeModel = (m: string): m is GeminiFreeModel => GEMINI_FREE_MODELS.some((x) => x.id === m);

/** Resposta crua do transporte. status 0 = rede; -1 = tempo esgotado; -2 = sem chave configurada. */
export interface TransportResponse {
  readonly status: number;
  readonly body: string;
}
export type GeminiTransport = (model: GeminiFreeModel, body: string, signal: AbortSignal) => Promise<TransportResponse>;

export interface GeminiOptions {
  readonly model?: string;
  readonly transport: GeminiTransport;
  readonly maxOutputTokens?: number;
  /** relógio (testes) */
  readonly now?: () => number;
}

export class GeminiProvider implements AiProvider {
  readonly id = "gemini";
  readonly model: GeminiFreeModel;
  constructor(private readonly o: GeminiOptions) {
    const m = o.model ?? GEMINI_DEFAULT_MODEL;
    if (!isFreeModel(m)) throw new ProviderError("indisponivel", `Modelo "${m}" não está na lista do nível gratuito do Gemini. O AGTN só usa modelos sem cobrança.`);
    this.model = m;
  }

  /** Corpo JSON exatamente como enviado ao Gemini (exposto para teste e para mostrar o que sai do computador). */
  buildBody(req: Omit<ProviderRequest, "signal">): string {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.history.map(toContent),
      tools: req.tools.length ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) })) }] : undefined,
      toolConfig: req.tools.length ? { functionCallingConfig: { mode: "AUTO" } } : undefined,
      generationConfig: { maxOutputTokens: this.o.maxOutputTokens ?? 2048 },
    };
    return JSON.stringify(body);
  }

  async generate(req: ProviderRequest): Promise<ModelReply> {
    if (req.signal.aborted) throw new ProviderError("cancelado", "Pedido cancelado.");
    const body = this.buildBody(req);
    let res: TransportResponse;
    try {
      res = await this.o.transport(this.model, body, req.signal);
    } catch (e) {
      if (req.signal.aborted) throw new ProviderError("cancelado", "Pedido cancelado.");
      throw new ProviderError("rede", `Sem conexão com o serviço do Gemini (${String((e as Error)?.message ?? e).slice(0, 160)}). O CAD continua funcionando normalmente.`);
    }
    if (req.signal.aborted) throw new ProviderError("cancelado", "Pedido cancelado.");
    return parseResponse(res, this.o.now ?? Date.now);
  }
}

function toContent(t: Turn): unknown {
  if (t.role === "user") return { role: "user", parts: [{ text: t.text }] };
  if (t.role === "model") {
    if (t.raw && typeof t.raw === "object") return t.raw; // devolvido exatamente como veio (thoughtSignature etc.)
    const parts: unknown[] = [];
    if (t.text) parts.push({ text: t.text });
    for (const c of t.calls) parts.push({ functionCall: { name: c.name, args: c.args, ...(c.id ? { id: c.id } : {}) } });
    return { role: "model", parts };
  }
  return {
    role: "user",
    parts: t.results.map((r) => ({ functionResponse: { name: r.call.name, ...(r.call.id ? { id: r.call.id } : {}), response: { result: r.result } } })),
  };
}

/** Converte "37s" / "1.5s" em ms. */
function durationMs(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(s.trim());
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

/** Próxima meia-noite do Pacífico (renovação da cota diária do Gemini). */
export function nextPacificMidnight(now: number): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const parts = Object.fromEntries(f.formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const h = Number(parts.hour) % 24, m = Number(parts.minute), s = Number(parts.second);
  const elapsed = ((h * 60 + m) * 60 + s) * 1000 + (now % 1000);
  return now - elapsed + 24 * 3600 * 1000;
}

export function parseResponse(res: TransportResponse, now: () => number): ModelReply {
  if (res.status === -2) throw new ProviderError("sem_chave", "Chave da API do Gemini não configurada. Abra a configuração do assistente e informe a chave (de um projeto SEM faturamento).");
  if (res.status === -1) throw new ProviderError("tempo_esgotado", "O Gemini não respondeu a tempo. Tente de novo; o CAD continua funcionando.");
  if (res.status === 0) throw new ProviderError("rede", "Sem conexão com o serviço do Gemini. O CAD continua funcionando normalmente.");
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(res.body) as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (res.status !== 200) {
    const err = (json?.error ?? {}) as { message?: string; status?: string; details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[] };
    const msg = String(err.message ?? "").slice(0, 300);
    if (res.status === 429) {
      const retry = err.details?.find((d) => d["@type"]?.endsWith("RetryInfo"));
      const daily = err.details?.some((d) => d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? "")));
      const wait = durationMs(retry?.retryDelay);
      const at = daily ? nextPacificMidnight(now()) : wait !== null ? now() + wait : undefined;
      const when = at ? new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
      throw new ProviderError("cota", `Cota gratuita do Gemini esgotada${daily ? " (limite diário)" : ""} — aguardando renovação${when ? ` (${when})` : ""}. Nada é cobrado; o CAD segue funcionando.`, at);
    }
    if (res.status === 400 && /api key/i.test(msg)) throw new ProviderError("chave_invalida", "A chave da API do Gemini foi recusada. Confira a chave na configuração do assistente.");
    if (res.status === 401 || res.status === 403) throw new ProviderError("chave_invalida", `Acesso negado pelo Gemini (${res.status}). Confira a chave e se a API está ativa no projeto.`);
    if (res.status === 404) throw new ProviderError("indisponivel", "O modelo escolhido não está disponível para esta chave. Escolha outro modelo gratuito na configuração.");
    if (res.status >= 500) throw new ProviderError("servico", `Serviço do Gemini indisponível no momento (${res.status}). Tente de novo mais tarde.`);
    throw new ProviderError("servico", `O Gemini recusou o pedido (${res.status}${msg ? `: ${msg}` : ""}).`);
  }
  if (!json) throw new ProviderError("resposta_invalida", "Resposta do Gemini ilegível (não é JSON).");
  const fb = json.promptFeedback as { blockReason?: string } | undefined;
  if (fb?.blockReason) throw new ProviderError("bloqueado", `O Gemini bloqueou o pedido (${fb.blockReason}).`);
  const cand = (json.candidates as { content?: { role?: string; parts?: unknown[] }; finishReason?: string }[] | undefined)?.[0];
  if (!cand) throw new ProviderError("resposta_invalida", "O Gemini não devolveu resposta.");
  const parts = Array.isArray(cand.content?.parts) ? cand.content!.parts! : [];
  let text = "";
  const calls: ToolCallReq[] = [];
  for (const p of parts) {
    if (typeof p !== "object" || p === null) continue;
    const q = p as { text?: unknown; thought?: unknown; functionCall?: { name?: unknown; args?: unknown; id?: unknown } };
    if (typeof q.text === "string" && q.thought !== true) text += q.text;
    if (q.functionCall) {
      const name = q.functionCall.name;
      const args = q.functionCall.args;
      if (typeof name !== "string" || !name) throw new ProviderError("resposta_invalida", "O Gemini pediu uma ferramenta sem nome.");
      calls.push({
        name,
        args: typeof args === "object" && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
        ...(typeof q.functionCall.id === "string" ? { id: q.functionCall.id } : {}),
      });
    }
  }
  const u = json.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined;
  if (!text && !calls.length && cand.finishReason && cand.finishReason !== "STOP")
    throw new ProviderError(cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT" ? "bloqueado" : "resposta_invalida", `O Gemini parou sem resposta (${cand.finishReason}).`);
  return {
    text: text.trim(),
    calls,
    raw: { role: "model", parts },
    usage: u ? { input: u.promptTokenCount, output: u.candidatesTokenCount, total: u.totalTokenCount } : undefined,
    finish: cand.finishReason,
  };
}
