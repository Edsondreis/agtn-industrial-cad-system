/**
 * Controle LOCAL de cota (antes de enviar). O Google não publica os limites do nível gratuito por modelo na
 * documentação (ficam no console do AI Studio, por projeto), então os limites aqui são configuráveis, com padrão
 * conservador. Se o contador local diz que vai estourar, o assistente avisa e espera — não envia. A cota diária
 * renova à meia-noite do Pacífico, como a do Gemini.
 */
import { nextPacificMidnight } from "./gemini";

export interface QuotaLimits {
  /** requisições por minuto */
  readonly rpm: number;
  /** requisições por dia (dia do Pacífico) */
  readonly rpd: number;
}
export const DEFAULT_LIMITS: QuotaLimits = { rpm: 5, rpd: 100 };

export interface QuotaState {
  /** instantes (ms) das requisições do último minuto */
  minute: number[];
  /** fim do dia corrente (próxima meia-noite do Pacífico) */
  dayEnds: number;
  day: number;
  /** tokens totais informados pelo provedor hoje */
  tokens: number;
  /** bloqueio informado pelo provedor (429) até este instante */
  blockedUntil: number;
}

export interface QuotaStore {
  load(): QuotaState | null;
  save(s: QuotaState): void;
}

export type QuotaCheck = { readonly ok: true } | { readonly ok: false; readonly until: number; readonly reason: string };

export class LocalQuota {
  private s: QuotaState;
  constructor(
    private limits: QuotaLimits = DEFAULT_LIMITS,
    private readonly store?: QuotaStore,
    private readonly now: () => number = Date.now,
  ) {
    const t = now();
    const loaded = store?.load();
    this.s = loaded && Array.isArray(loaded.minute) ? loaded : { minute: [], dayEnds: nextPacificMidnight(t), day: 0, tokens: 0, blockedUntil: 0 };
  }
  setLimits(l: QuotaLimits) {
    this.limits = l;
  }
  private roll(t: number) {
    if (t >= this.s.dayEnds) this.s = { ...this.s, dayEnds: nextPacificMidnight(t), day: 0, tokens: 0 };
    this.s.minute = this.s.minute.filter((x) => t - x < 60_000);
  }
  check(): QuotaCheck {
    const t = this.now();
    this.roll(t);
    if (this.s.blockedUntil > t) return { ok: false, until: this.s.blockedUntil, reason: "Cota gratuita esgotada segundo o Gemini" };
    if (this.s.day >= this.limits.rpd) return { ok: false, until: this.s.dayEnds, reason: `Limite diário configurado (${this.limits.rpd} pedidos) atingido` };
    if (this.s.minute.length >= this.limits.rpm) return { ok: false, until: this.s.minute[0] + 60_000, reason: `Limite por minuto configurado (${this.limits.rpm}) atingido` };
    return { ok: true };
  }
  record(tokens = 0) {
    const t = this.now();
    this.roll(t);
    this.s.minute.push(t);
    this.s.day++;
    this.s.tokens += Math.max(0, tokens || 0);
    this.store?.save(this.s);
  }
  /** o provedor disse 429: respeita o tempo informado (ou 60 s), sem repetir em loop */
  block(until?: number) {
    const t = this.now();
    this.s.blockedUntil = Math.max(this.s.blockedUntil, until ?? t + 60_000);
    this.store?.save(this.s);
  }
  get usage() {
    this.roll(this.now());
    return { today: this.s.day, tokens: this.s.tokens, limits: this.limits, resetsAt: this.s.dayEnds, blockedUntil: this.s.blockedUntil };
  }
}
