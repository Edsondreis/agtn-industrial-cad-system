/**
 * Laço do AGTN AI ASSISTANT: pedido do usuário → modelo → ferramentas tipadas (validadas) → resultado REAL → modelo.
 *
 * Garantias (testadas em agent.test.ts):
 *  - o modelo só alcança as ferramentas registradas; nome desconhecido ou argumento inválido volta como erro para ele;
 *  - ferramentas "previa" nunca alteram o documento sozinhas: o laço PARA, entrega a prévia à interface e só chama
 *    `apply` depois de `resolve(true)`; recusar devolve "cancelado pelo usuário" ao modelo;
 *  - o modelo sempre recebe o resultado efetivo (o que o aplicativo devolveu), nunca um sucesso simulado;
 *  - o estado do documento é relido a cada passo (`context()`), substituindo o anterior — sem dado velho;
 *  - cota local conferida ANTES de enviar; 429 bloqueia até a renovação, sem repetir em loop;
 *  - cancelamento interrompe o laço e descarta a prévia pendente (nada é aplicado);
 *  - limite de passos por pedido.
 */
import { validateArgs } from "./schema";
import type { QuotaCheck } from "./quota";
import { type AiProvider, ProviderError, type ToolCallReq, type ToolDef, type ToolOutcome, type Turn, type Preview } from "./types";

export interface QuotaGate {
  check(): QuotaCheck;
  record(tokens?: number): void;
  block(until?: number): void;
}

export interface AssistantOptions {
  readonly provider: AiProvider;
  readonly tools: readonly ToolDef[];
  /** instruções fixas do sistema */
  readonly system: string;
  /** retrato atual e MÍNIMO do documento (relido a cada passo) */
  readonly context?: () => unknown;
  readonly quota?: QuotaGate;
  readonly maxSteps?: number;
  /** guarda até N turnos no histórico enviado (os mais recentes) */
  readonly maxTurns?: number;
}

export type AssistantEvent =
  | { readonly type: "pensando" }
  | { readonly type: "texto"; readonly text: string }
  | { readonly type: "ferramenta"; readonly call: ToolCallReq; readonly outcome: ToolOutcome }
  | { readonly type: "previa"; readonly pending: Pending }
  | { readonly type: "aplicado"; readonly call: ToolCallReq; readonly outcome: ToolOutcome }
  | { readonly type: "recusado"; readonly call: ToolCallReq };

export interface Pending {
  readonly call: ToolCallReq;
  readonly preview: Preview;
}

export type RunResult =
  | { readonly kind: "resposta"; readonly text: string }
  | { readonly kind: "aguardando_confirmacao"; readonly pending: Pending; readonly text: string }
  | { readonly kind: "erro"; readonly error: ProviderError }
  | { readonly kind: "cancelado" };

/** Resultado entregue ao modelo para uma ferramenta (só dados; nunca funções). */
function forModel(o: ToolOutcome): unknown {
  switch (o.status) {
    case "ok":
      return { status: "ok", data: o.data };
    case "precisa_informacao":
      return { status: "precisa_informacao", pergunta: o.question, data: o.data };
    case "erro":
      return { status: "erro", mensagem: o.message, data: o.data };
    case "previa":
      return { status: "previa_aguardando_confirmacao", titulo: o.preview.title, detalhes: o.preview.details, data: o.data };
  }
}

interface Held {
  readonly calls: readonly ToolCallReq[];
  readonly done: { call: ToolCallReq; result: unknown }[];
  readonly index: number;
  readonly pending: Pending;
}

export class Assistant {
  readonly history: Turn[] = [];
  private held: Held | null = null;
  private readonly byName: Map<string, ToolDef>;
  constructor(private readonly o: AssistantOptions) {
    this.byName = new Map(o.tools.map((t) => [t.name, t]));
  }

  get pending(): Pending | null {
    return this.held?.pending ?? null;
  }

  /** Limpa a conversa (nova sessão). Prévia pendente é descartada sem aplicar. */
  reset() {
    this.history.length = 0;
    this.held = null;
  }

  async send(text: string, signal: AbortSignal, on: (e: AssistantEvent) => void = () => undefined): Promise<RunResult> {
    if (this.held) return { kind: "erro", error: new ProviderError("servico", "Há uma operação aguardando sua confirmação. Confirme ou cancele antes de pedir outra coisa.") };
    const t = text.trim().slice(0, 4000);
    if (!t) return { kind: "resposta", text: "" };
    this.history.push({ role: "user", text: t });
    return this.loop(signal, on);
  }

  /** Confirma (true) ou recusa (false) a prévia pendente; o modelo recebe o resultado REAL e a conversa continua. */
  async resolve(confirm: boolean, signal: AbortSignal, on: (e: AssistantEvent) => void = () => undefined): Promise<RunResult> {
    const h = this.held;
    if (!h) return { kind: "erro", error: new ProviderError("servico", "Nenhuma operação aguardando confirmação.") };
    this.held = null;
    if (signal.aborted) return this.cancelHeld(h);
    let outcome: ToolOutcome;
    if (confirm) {
      try {
        outcome = await h.pending.preview.apply();
      } catch (e) {
        outcome = { status: "erro", message: `A operação falhou no aplicativo: ${String((e as Error)?.message ?? e).slice(0, 300)}` };
      }
      on({ type: "aplicado", call: h.pending.call, outcome });
    } else {
      outcome = { status: "erro", message: "Cancelado pelo usuário: nada foi alterado." };
      on({ type: "recusado", call: h.pending.call });
    }
    const results = [...h.done, { call: h.pending.call, result: forModel(outcome) }];
    for (const c of h.calls.slice(h.index + 1))
      results.push({ call: c, result: { status: "erro", mensagem: "Não executada: o passo anterior precisou de confirmação do usuário. Peça de novo se ainda for necessário." } });
    this.history.push({ role: "tool", results });
    return this.loop(signal, on);
  }

  private cancelHeld(h: Held): RunResult {
    const results = [...h.done, { call: h.pending.call, result: { status: "erro", mensagem: "Pedido cancelado pelo usuário: nada foi alterado." } }];
    for (const c of h.calls.slice(h.index + 1)) results.push({ call: c, result: { status: "erro", mensagem: "Pedido cancelado." } });
    this.history.push({ role: "tool", results });
    return { kind: "cancelado" };
  }

  /** Cancela o que estiver pendente (prévia não aplicada). */
  cancel(): RunResult {
    const h = this.held;
    this.held = null;
    return h ? this.cancelHeld(h) : { kind: "cancelado" };
  }

  private system(): string {
    if (!this.o.context) return this.o.system;
    let ctx: string;
    try {
      ctx = JSON.stringify(this.o.context());
    } catch {
      ctx = '{"erro":"estado indisponível"}';
    }
    return `${this.o.system}\n\nESTADO ATUAL DO APLICATIVO (lido agora; substitui qualquer estado mencionado antes nesta conversa):\n${ctx}`;
  }

  private async loop(signal: AbortSignal, on: (e: AssistantEvent) => void): Promise<RunResult> {
    const max = this.o.maxSteps ?? 8;
    let lastText = "";
    for (let step = 0; step < max; step++) {
      if (signal.aborted) return { kind: "cancelado" };
      const q = this.o.quota?.check();
      if (q && !q.ok) {
        const when = new Date(q.until).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        return { kind: "erro", error: new ProviderError("cota", `${q.reason}. Aguardando renovação (${when}). Nada foi enviado; o CAD segue funcionando.`, q.until) };
      }
      on({ type: "pensando" });
      let reply;
      try {
        const turns = this.o.maxTurns ? this.trimmed(this.o.maxTurns) : this.history;
        reply = await this.o.provider.generate({ system: this.system(), history: turns, tools: this.o.tools, signal });
        this.o.quota?.record(reply.usage?.total);
      } catch (e) {
        if (signal.aborted) return { kind: "cancelado" };
        const err = e instanceof ProviderError ? e : new ProviderError("servico", String((e as Error)?.message ?? e));
        if (err.kind === "cota") this.o.quota?.block(err.retryAt);
        else if (err.kind !== "cancelado" && err.kind !== "sem_chave") this.o.quota?.record(0);
        return { kind: "erro", error: err };
      }
      if (signal.aborted) return { kind: "cancelado" };
      this.history.push({ role: "model", text: reply.text, calls: reply.calls, raw: reply.raw });
      if (reply.text) {
        lastText = reply.text;
        on({ type: "texto", text: reply.text });
      }
      if (!reply.calls.length) return { kind: "resposta", text: reply.text };

      const done: { call: ToolCallReq; result: unknown }[] = [];
      for (let i = 0; i < reply.calls.length; i++) {
        const call = reply.calls[i];
        if (signal.aborted) {
          // fecha o turno para o histórico ficar coerente com o protocolo
          for (const c of reply.calls.slice(i)) done.push({ call: c, result: { status: "erro", mensagem: "Pedido cancelado." } });
          this.history.push({ role: "tool", results: done });
          return { kind: "cancelado" };
        }
        const outcome = await this.runTool(call, signal);
        on({ type: "ferramenta", call, outcome });
        if (outcome.status === "previa") {
          const pending: Pending = { call, preview: outcome.preview };
          this.held = { calls: reply.calls, done, index: i, pending };
          on({ type: "previa", pending });
          return { kind: "aguardando_confirmacao", pending, text: lastText };
        }
        done.push({ call, result: forModel(outcome) });
      }
      this.history.push({ role: "tool", results: done });
    }
    return { kind: "resposta", text: lastText || "Parei: o pedido exigiu passos demais. Divida em partes menores." };
  }

  /** Executa UMA ferramenta pedida pelo modelo: existe? argumentos válidos? só então chama a implementação real. */
  private async runTool(call: ToolCallReq, signal: AbortSignal): Promise<ToolOutcome> {
    const tool = this.byName.get(call.name);
    if (!tool) return { status: "erro", message: `Ferramenta "${call.name.slice(0, 60)}" não existe ou não é permitida. Use só as ferramentas declaradas.` };
    const v = validateArgs(tool.parameters, call.args);
    if (!v.ok) return { status: "erro", message: `Argumentos inválidos para ${tool.name}: ${v.errors.slice(0, 8).join("; ")}. Corrija ou pergunte ao usuário — não invente valores.` };
    try {
      const out = await tool.run(v.value, { signal });
      if (out.status === "previa" && tool.risk !== "previa")
        return { status: "erro", message: `Ferramenta ${tool.name} tentou alterar o documento sem ser de prévia — bloqueado.` };
      return out;
    } catch (e) {
      return { status: "erro", message: `Falha ao executar ${tool.name}: ${String((e as Error)?.message ?? e).slice(0, 300)}` };
    }
  }

  /** Últimos N turnos, sem cortar no meio de um par modelo→ferramenta. */
  private trimmed(n: number): Turn[] {
    if (this.history.length <= n) return this.history;
    let start = this.history.length - n;
    while (start < this.history.length && this.history[start].role !== "user") start++;
    return this.history.slice(start);
  }
}

/** Instruções do sistema (pt-BR). */
export const SYSTEM_PROMPT = `Você é o AGTN AI ASSISTANT, assistente integrado ao AGTN INDUSTRIAL CAD (caldeiraria e chapas, AGTN Metalúrgica).
Responda sempre em português do Brasil, curto e objetivo. Unidade interna: milímetro.

REGRAS OBRIGATÓRIAS
1. Você opera o CAD SOMENTE pelas ferramentas declaradas. Não existe outra forma de agir.
2. Nunca invente medidas, dimensões, volumes, fatores K ou resultados. Medidas e cálculos vêm das ferramentas.
   Se faltar um dado necessário (ex.: espessura, fator K, ponto), PERGUNTE ao usuário.
3. Ferramentas que alteram o desenho devolvem "previa_aguardando_confirmacao": diga em uma frase o que foi preparado e
   peça para o usuário conferir a prévia e confirmar no cartão. NÃO diga que foi feito antes de receber o resultado
   real "ok" da aplicação.
4. Só afirme que algo foi criado, alterado, exportado ou desfeito quando a ferramenta devolver status "ok".
   Se devolver "erro", explique o erro com as palavras da mensagem e sugira o próximo passo.
5. Planificação de chapa exige fator K: use o valor informado pelo usuário ou, se ele autorizar, o da tabela do projeto.
   Se ele não disse, pergunte antes de gerar.
6. Medidas de sólido só valem se o grau for "exato". Se vier "invalido", "nao_verificado" ou "nao_calculavel", diga que
   o valor NÃO é apto para engenharia/fabricação e por quê.
7. Use o ESTADO ATUAL DO APLICATIVO enviado junto; ele é relido a cada passo e substitui qualquer estado anterior.
8. Recuse pedidos fora do CAD que envolvam sistema operacional, arquivos, terminal, rede ou execução de código.`;
