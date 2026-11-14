/**
 * FASE 4 · ETAPA 5 — F-06: diagnóstico do motor 3D.
 *
 * Quando o ambiente 3D falha, o usuário recebe título, explicação em português e o que fazer — e o 2D continua.
 * Os detalhes técnicos (etapa, erro original, ambiente) ficam disponíveis para o suporte ("Detalhes técnicos" /
 * "Copiar diagnóstico"), sem esconder o erro real e sem transformar falha em sucesso.
 */

/** Etapa em que o erro aconteceu: leitura do .wasm, criação do worker, inicialização do OCCT, comunicação. */
export type EngineStage = "wasm" | "worker" | "init" | "comm" | "sync";

export type DiagCode =
  | "WASM_LOAD" // não leu o arquivo occt-wasm.wasm
  | "WASM_COMPILE" // leu, mas não compilou/instanciou (arquivo danificado ou incompatível)
  | "WORKER_START" // o worker do motor não iniciou
  | "CSP" // política de segurança bloqueou
  | "OCCT_INIT" // o módulo carregou, mas o kernel OCCT não inicializou
  | "MEMORY" // sem memória
  | "COMMUNICATION" // perdeu contato com o worker / resposta não chegou
  | "SOLID" // falha ao gerar o sólido de uma operação
  | "BOOLEAN" // falha numa operação booleana
  | "FLAT"; // falha na planificação

export interface EngineDiagnostic {
  readonly code: DiagCode;
  readonly titulo: string;
  readonly mensagem: string;
  readonly acao: string;
  readonly etapa: EngineStage;
  /** erro original e detalhes, sem tradução */
  readonly tecnico: readonly string[];
  readonly quando: string;
  readonly ambiente: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RawFailure {
  readonly name?: string;
  readonly message: string;
  readonly details?: readonly string[];
}

const TEXTS: Record<Exclude<DiagCode, "SOLID" | "BOOLEAN" | "FLAT">, { mensagem: string; acao: string }> = {
  WASM_LOAD: {
    mensagem: "O arquivo do componente geométrico (occt-wasm.wasm) não pôde ser lido. A instalação pode estar incompleta.",
    acao: "Tente novamente. Se continuar, reinstale o AGTN Industrial CAD.",
  },
  WASM_COMPILE: {
    mensagem: "O componente geométrico foi encontrado, mas não pôde ser carregado: o arquivo está danificado ou é incompatível.",
    acao: "Reinstale o AGTN Industrial CAD. Se continuar, envie o diagnóstico ao suporte.",
  },
  WORKER_START: {
    mensagem: "O processo de cálculo 3D não pôde ser iniciado neste computador.",
    acao: "Tente novamente. Se continuar, atualize o Microsoft Edge WebView2 Runtime e envie o diagnóstico ao suporte.",
  },
  CSP: {
    mensagem: "A política de segurança do aplicativo bloqueou o componente geométrico.",
    acao: "Envie o diagnóstico ao suporte (é um problema do aplicativo, não do seu arquivo).",
  },
  OCCT_INIT: {
    mensagem: "O componente geométrico não conseguiu ser inicializado.",
    acao: "Tente novamente. Se continuar, envie o diagnóstico ao suporte.",
  },
  MEMORY: {
    mensagem: "Não há memória suficiente para o ambiente 3D.",
    acao: "Feche outros programas ou projetos e tente novamente.",
  },
  COMMUNICATION: {
    mensagem: "A comunicação com o processo de cálculo 3D foi interrompida.",
    acao: "Tente novamente. Se continuar, reinicie o aplicativo e envie o diagnóstico ao suporte.",
  },
};

const RX = {
  csp: /Content Security Policy|unsafe-eval|wasm-unsafe-eval|EvalError|violates the following|Refused to (?:evaluate|compile|load|create)|Code generation from strings disallowed/i,
  memory: /out of memory|\bOOM\b|Cannot enlarge memory|could not allocate memory|Array buffer allocation failed|WebAssembly\.Memory|Aborted\(OOM\)|RangeError: .*memory/i,
  compile: /CompileError|LinkError|wasm streaming compile failed|failed to asynchronously prepare wasm|expected magic word|WebAssembly\.(?:instantiate|compile)|invalid wasm|wasm validation/i,
  comm: /DataCloneError|could not be cloned|messageerror|sem resposta|não respondeu|encerrado|terminated/i,
};

function env(): Record<string, string | number | boolean | null> {
  const g = globalThis as { navigator?: Navigator; location?: Location; __TAURI_INTERNALS__?: unknown; crossOriginIsolated?: boolean };
  return {
    app: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null,
    navegador: g.navigator?.userAgent ?? null,
    origem: g.location?.origin ?? null,
    tauri: !!g.__TAURI_INTERNALS__,
    webassembly: typeof WebAssembly === "object",
    worker: typeof Worker === "function",
    memoriaDispositivoGB: (g.navigator as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory ?? null,
    nucleos: g.navigator?.hardwareConcurrency ?? null,
  };
}
declare const __APP_VERSION__: string;

/** Classifica uma falha do motor (inicialização ou comunicação). O texto técnico original é preservado. */
export function classifyEngineFailure(etapa: EngineStage, f: RawFailure, ambiente: Record<string, string | number | boolean | null> = env()): EngineDiagnostic {
  const all = [f.name ? `${f.name}: ${f.message}` : f.message, ...(f.details ?? [])].join("\n");
  let code: Exclude<DiagCode, "SOLID" | "BOOLEAN" | "FLAT">;
  if (RX.csp.test(all)) code = "CSP";
  else if (RX.memory.test(all)) code = "MEMORY";
  else if (etapa === "wasm") code = "WASM_LOAD";
  else if (RX.compile.test(all)) code = "WASM_COMPILE";
  else if (etapa === "worker") code = "WORKER_START";
  else if (etapa === "comm" || RX.comm.test(all)) code = "COMMUNICATION";
  else code = "OCCT_INIT";
  const t = TEXTS[code];
  return {
    code,
    titulo: etapa === "sync" || etapa === "comm" ? "O ambiente 3D parou de responder." : "Não foi possível iniciar o ambiente 3D.",
    mensagem: t.mensagem,
    acao: t.acao,
    etapa,
    tecnico: [f.name ? `${f.name}: ${f.message}` : f.message, ...(f.details ?? [])].filter(Boolean),
    quando: new Date().toISOString(),
    ambiente,
  };
}

/** Rótulo de uma falha de operação (aparece no aviso e na árvore): sólido, booleana ou planificação. */
export function classifyOperationFailure(feature: { readonly t?: string; readonly op?: string } | "flat" | null | undefined): { code: "SOLID" | "BOOLEAN" | "FLAT"; rotulo: string } {
  if (feature === "flat") return { code: "FLAT", rotulo: "Falha na planificação" };
  const t = feature?.t ?? "";
  const op = feature?.op ?? "";
  // furo e combinação são sempre booleanas; extrusão/revolução/varredura/loft só quando unem, cortam ou intersectam
  if (t === "combine" || t === "hole" || ((t === "extrude" || t === "revolve" || t === "sweep" || t === "loft") && (op === "cut" || op === "join" || op === "intersect")))
    return { code: "BOOLEAN", rotulo: "Falha na operação booleana" };
  if (t === "sheetFlatCut") return { code: "FLAT", rotulo: "Falha no recorte da planificação" };
  return { code: "SOLID", rotulo: "Falha ao gerar o sólido" };
}

/** Texto do diagnóstico para copiar e mandar ao suporte. */
export function diagnosticText(d: EngineDiagnostic): string {
  return [
    `AGTN Industrial CAD — diagnóstico do motor 3D`,
    `código: ${d.code} · etapa: ${d.etapa} · quando: ${d.quando}`,
    `${d.titulo} ${d.mensagem}`,
    "",
    "detalhes técnicos:",
    ...d.tecnico.map((x) => `  ${x}`),
    "",
    "ambiente:",
    ...Object.entries(d.ambiente).map(([k, v]) => `  ${k}: ${v}`),
  ].join("\n");
}
