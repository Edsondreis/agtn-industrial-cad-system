/**
 * Estado do painel AGTN AI ASSISTANT, fora do React: conversa da sessão, prévia pendente, cancelamento, preferências
 * (consentimento, modelo gratuito, limites) e cota local. O painel só observa; fechar o painel não perde a conversa.
 */
import {
  type AiProvider,
  Assistant,
  type AssistantEvent,
  GEMINI_DEFAULT_MODEL,
  type GeminiFreeModel,
  GeminiProvider,
  type GeminiTransport,
  LocalQuota,
  type Pending,
  type QuotaState,
  type RunResult,
  SYSTEM_PROMPT,
  isFreeModel,
} from "@agtn/ai";
import { type AiHost, AiSession, cadContext, createCadTools } from "./tools";

export interface AiPrefs {
  /** aceitou o aviso de privacidade do nível gratuito */
  consent: boolean;
  model: GeminiFreeModel;
  rpm: number;
  rpd: number;
}
const DEFAULT_PREFS: AiPrefs = { consent: false, model: GEMINI_DEFAULT_MODEL, rpm: 5, rpd: 100 };
const PREFS_KEY = "agtn.ai.prefs";
const QUOTA_KEY = "agtn.ai.quota";

export type Msg =
  | { readonly id: number; readonly kind: "usuario"; readonly text: string }
  | { readonly id: number; readonly kind: "ia"; readonly text: string }
  | { readonly id: number; readonly kind: "ferramenta"; readonly name: string; readonly status: string; readonly text: string }
  | { readonly id: number; readonly kind: "aplicado"; readonly ok: boolean; readonly text: string }
  | { readonly id: number; readonly kind: "erro"; readonly text: string; readonly errKind?: string };

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface AiStorage {
  get(k: string): string | null;
  set(k: string, v: string): void;
}
const memoryStorage = (): AiStorage => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

export const TOOL_LABEL: Record<string, string> = {
  ler_documento: "leu o desenho",
  ler_selecao: "mediu a seleção",
  medir_distancia: "mediu distância",
  calcular_area: "calculou área",
  info_solidos_3d: "leu os sólidos 3D",
  criar_perfil_chapa: "preparou perfil",
  editar_perfil_chapa: "alterou perfil",
  gerar_planificacao: "preparou planificação",
  criar_chapa_retangular: "preparou chapa",
  criar_folha_a4: "preparou folha A4",
  mover_selecao: "preparou mover",
  apagar_selecao: "preparou apagar",
  exportar_dxf: "preparou exportação DXF",
  exportar_pdf: "preparou impressão/PDF",
  desfazer_ultima_operacao: "desfez",
  enquadrar_desenho: "enquadrou",
};

export class AiController {
  messages: Msg[] = [];
  busy = false;
  pending: Pending | null = null;
  prefs: AiPrefs;
  readonly session = new AiSession();
  readonly quota: LocalQuota;
  private assistant: Assistant;
  private abort: AbortController | null = null;
  private seq = 0;
  private listeners = new Set<() => void>();
  private ver = 0;

  constructor(
    private readonly host: AiHost,
    private readonly opts: { transport: GeminiTransport; storage?: AiStorage; provider?: (model: GeminiFreeModel) => AiProvider },
  ) {
    const st = opts.storage ?? memoryStorage();
    let p: Partial<AiPrefs> = {};
    try {
      p = JSON.parse(st.get(PREFS_KEY) ?? "{}") as Partial<AiPrefs>;
    } catch {
      p = {};
    }
    this.prefs = { ...DEFAULT_PREFS, ...p, model: isFreeModel(String(p.model)) ? (p.model as GeminiFreeModel) : DEFAULT_PREFS.model };
    this.quota = new LocalQuota({ rpm: this.prefs.rpm, rpd: this.prefs.rpd }, {
      load: () => {
        try {
          return JSON.parse(st.get(QUOTA_KEY) ?? "null") as QuotaState | null;
        } catch {
          return null;
        }
      },
      save: (s) => st.set(QUOTA_KEY, JSON.stringify(s)),
    });
    this.assistant = this.make();
  }

  private make(): Assistant {
    const provider = this.opts.provider ? this.opts.provider(this.prefs.model) : new GeminiProvider({ model: this.prefs.model, transport: this.opts.transport });
    return new Assistant({
      provider,
      tools: createCadTools(this.host, this.session),
      system: SYSTEM_PROMPT,
      context: () => cadContext(this.host, this.session),
      quota: this.quota,
      maxSteps: 8,
      maxTurns: 40,
    });
  }

  get version() {
    return this.ver;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.ver++;
    for (const f of this.listeners) f();
  }
  private push(m: DistOmit<Msg, "id">) {
    this.messages = [...this.messages, { ...m, id: ++this.seq } as Msg];
  }

  setPrefs(patch: Partial<AiPrefs>) {
    const next = { ...this.prefs, ...patch };
    if (!isFreeModel(next.model)) next.model = DEFAULT_PREFS.model;
    next.rpm = Math.max(1, Math.min(60, Math.round(next.rpm)));
    next.rpd = Math.max(1, Math.min(5000, Math.round(next.rpd)));
    const modelChanged = next.model !== this.prefs.model;
    this.prefs = next;
    (this.opts.storage ?? memoryStorage()).set(PREFS_KEY, JSON.stringify(next));
    this.quota.setLimits({ rpm: next.rpm, rpd: next.rpd });
    if (modelChanged) {
      // troca de modelo = conversa nova (o histórico cru de um modelo não serve para outro)
      this.abort?.abort();
      this.assistant = this.make();
      this.pending = null;
      this.push({ kind: "ia", text: `Modelo trocado para ${next.model}. Nova conversa iniciada.` });
    }
    this.emit();
  }

  newConversation() {
    this.abort?.abort();
    this.assistant.reset();
    this.session.profile = null;
    this.pending = null;
    this.busy = false;
    this.messages = [];
    this.emit();
  }

  private onEvent = (e: AssistantEvent) => {
    if (e.type === "texto") this.push({ kind: "ia", text: e.text });
    else if (e.type === "ferramenta") {
      const o = e.outcome;
      const text = o.status === "erro" ? o.message : o.status === "precisa_informacao" ? o.question : o.status === "previa" ? o.preview.title : "";
      this.push({ kind: "ferramenta", name: e.call.name, status: o.status, text });
    } else if (e.type === "aplicado") {
      const o = e.outcome;
      this.push({ kind: "aplicado", ok: o.status === "ok", text: o.status === "ok" ? `Aplicado: ${String((o.data as { transacao?: string; exportado?: boolean; arquivo?: string; janela_aberta?: boolean })?.transacao ?? (o.data as { arquivo?: string })?.arquivo ?? "ok")}` : o.status === "erro" ? o.message : "" });
    } else if (e.type === "recusado") this.push({ kind: "aplicado", ok: false, text: "Cancelado: nada foi alterado." });
    this.emit();
  };

  private finish(r: RunResult) {
    this.busy = false;
    this.abort = null;
    this.pending = r.kind === "aguardando_confirmacao" ? r.pending : null;
    if (r.kind === "erro") this.push({ kind: "erro", text: r.error.message, errKind: r.error.kind });
    if (r.kind === "cancelado") this.push({ kind: "aplicado", ok: false, text: "Pedido cancelado." });
    this.emit();
  }

  async send(text: string): Promise<void> {
    const t = text.trim();
    if (!t || this.busy) return;
    if (!this.prefs.consent) {
      this.push({ kind: "erro", text: "Antes de usar, leia e aceite o aviso de privacidade na configuração do assistente (engrenagem).", errKind: "consentimento" });
      this.emit();
      return;
    }
    if (this.pending) {
      this.push({ kind: "erro", text: "Há uma alteração aguardando sua confirmação. Confirme ou cancele no cartão acima." });
      this.emit();
      return;
    }
    this.push({ kind: "usuario", text: t });
    this.busy = true;
    this.abort = new AbortController();
    this.emit();
    this.finish(await this.assistant.send(t, this.abort.signal, this.onEvent));
  }

  async confirm(yes: boolean): Promise<void> {
    if (!this.pending || this.busy) return;
    this.busy = true;
    this.pending = null;
    this.abort = new AbortController();
    this.emit();
    this.finish(await this.assistant.resolve(yes, this.abort.signal, this.onEvent));
  }

  /** Cancela o pedido em andamento (ou a prévia pendente). Nada pendente é aplicado. */
  cancel() {
    if (this.abort) this.abort.abort();
    else if (this.pending) this.finish(this.assistant.cancel());
  }
}
