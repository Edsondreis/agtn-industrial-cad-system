/**
 * AGTN AI ASSISTANT — tipos do núcleo (sem UI, sem rede, sem DOM).
 *
 * A IA NÃO opera o CAD diretamente: ela pede ferramentas tipadas; o núcleo valida os argumentos, aplica a política de
 * permissão (leitura direta / prévia + confirmação), executa pela implementação real do aplicativo e devolve à IA o
 * resultado REAL da execução. Nenhum caminho deixa o modelo executar código, comandos de terminal ou acessar arquivos.
 */

/** Esquema de parâmetros (subconjunto de JSON Schema aceito pelo Gemini e pelo validador local). */
export type JsonSchema =
  | { type: "object"; description?: string; properties: Record<string, JsonSchema>; required?: readonly string[] }
  | { type: "array"; description?: string; items: JsonSchema; minItems?: number; maxItems?: number }
  | { type: "number" | "integer"; description?: string; minimum?: number; maximum?: number; exclusiveMinimum?: number }
  | { type: "string"; description?: string; enum?: readonly string[]; maxLength?: number }
  | { type: "boolean"; description?: string };

/**
 * Nível de risco da ferramenta:
 *  - leitura: consulta/medição/explicação — executa direto.
 *  - previa: prepara uma prévia REAL (geometria calculada pelo motor) e só altera o documento depois que o usuário
 *    confirma na interface. Criação, edição, exclusão, substituição e exportação passam por aqui.
 *  - direta_reversivel: muda o estado mas é desfeita/refeita pelo próprio CAD (ex.: desfazer, zoom).
 */
export type ToolRisk = "leitura" | "previa" | "direta_reversivel";

/** Resultado de uma ferramenta: sempre o que o aplicativo REALMENTE fez/calculou. */
export type ToolOutcome =
  | { readonly status: "ok"; readonly data: unknown }
  /** precisa de informação do usuário (ex.: fator K) — a IA deve perguntar, não inventar */
  | { readonly status: "precisa_informacao"; readonly question: string; readonly data?: unknown }
  /** prévia pronta: o documento NÃO foi alterado; aguarda confirmação na interface */
  | { readonly status: "previa"; readonly preview: Preview; readonly data?: unknown }
  | { readonly status: "erro"; readonly message: string; readonly data?: unknown };

/** Prévia de uma alteração. `apply` só é chamado depois da confirmação do usuário. */
export interface Preview {
  /** texto curto mostrado no cartão de confirmação */
  readonly title: string;
  /** linhas de detalhe (medidas reais calculadas) */
  readonly details: readonly string[];
  /** a operação altera/remove algo que já existe (aviso destacado) */
  readonly destructive: boolean;
  /** geometria da prévia para desenhar (opcional; formato livre do aplicativo) */
  readonly visual?: unknown;
  /** executa de verdade; devolve o resultado real (ex.: ids criados, rótulo do desfazer) */
  readonly apply: () => Promise<ToolOutcome> | ToolOutcome;
}

export interface ToolContext {
  /** cancelamento do pedido em andamento */
  readonly signal: AbortSignal;
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema & { type: "object" };
  readonly risk: ToolRisk;
  readonly run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome> | ToolOutcome;
}

/* ---------------------------------- conversa ---------------------------------- */

export interface ToolCallReq {
  /** id devolvido pelo modelo (quando houver), repassado na resposta */
  readonly id?: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** Turno guardado no histórico. `raw` preserva as partes do modelo como vieram (ex.: thoughtSignature do Gemini). */
export type Turn =
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "model"; readonly text: string; readonly calls: readonly ToolCallReq[]; readonly raw?: unknown }
  | { readonly role: "tool"; readonly results: readonly { readonly call: ToolCallReq; readonly result: unknown }[] };

export interface ModelReply {
  readonly text: string;
  readonly calls: readonly ToolCallReq[];
  /** partes cruas para devolver ao provedor no próximo turno (obrigatório no Gemini 3) */
  readonly raw?: unknown;
  readonly usage?: { readonly input?: number; readonly output?: number; readonly total?: number };
  /** motivo de parada informado pelo provedor */
  readonly finish?: string;
}

export interface ProviderRequest {
  readonly system: string;
  readonly history: readonly Turn[];
  readonly tools: readonly ToolDef[];
  readonly signal: AbortSignal;
}

/** Erro do provedor já classificado (mensagem em português para o usuário). */
export type ProviderErrorKind = "sem_chave" | "chave_invalida" | "cota" | "rede" | "tempo_esgotado" | "bloqueado" | "resposta_invalida" | "servico" | "cancelado" | "indisponivel";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    /** cota: quando tentar de novo (ms epoch), se o provedor informou */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  generate(req: ProviderRequest): Promise<ModelReply>;
}
