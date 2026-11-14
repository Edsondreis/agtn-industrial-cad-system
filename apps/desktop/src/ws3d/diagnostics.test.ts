import { classifyEngineFailure, classifyOperationFailure, diagnosticText } from "./diagnostics";

/**
 * F-06 (ETAPA 5): cada falha do motor vira um diagnóstico com código, texto para o usuário e o erro ORIGINAL
 * preservado. As mensagens de erro usadas aqui são as reais dos motores (Chromium/WebView2, WebKit, Emscripten).
 */
const env = { teste: true };
const c = (stage: Parameters<typeof classifyEngineFailure>[0], name: string | undefined, message: string, details: string[] = []) => classifyEngineFailure(stage, { name, message, details }, env);

describe("F-06 — classificação das falhas do motor 3D", () => {
  it("CSP: código dinâmico no worker (mensagem real do Chromium)", () => {
    const d = c("init", "SolidError", "Não foi possível iniciar o motor 3D (OCCT).", ["EvalError: Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script"]);
    expect(d.code).toBe("CSP");
    expect(d.titulo).toBe("Não foi possível iniciar o ambiente 3D.");
  });
  it("CSP: WebAssembly bloqueado (sem 'wasm-unsafe-eval') ganha de 'compilação'", () => {
    expect(c("init", "CompileError", "WebAssembly.instantiate(): Refused to compile or instantiate WebAssembly module because 'unsafe-eval' is not an allowed source of script").code).toBe("CSP");
  });
  it("WASM_LOAD: arquivo do motor não encontrado / não lido", () => {
    expect(c("wasm", undefined, "Motor 3D não encontrado (HTTP 404).").code).toBe("WASM_LOAD");
    expect(c("wasm", "Error", "Não foi possível ler o arquivo do motor 3D (occt-wasm.wasm).", ["Error: recurso não encontrado"]).code).toBe("WASM_LOAD");
  });
  it("WASM_COMPILE: arquivo danificado", () => {
    expect(c("init", "SolidError", "Não foi possível iniciar o motor 3D (OCCT).", ["CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 64 6f @+0"]).code).toBe("WASM_COMPILE");
  });
  it("WORKER_START: o script do worker não carregou", () => {
    expect(c("worker", undefined, "Falha no motor 3D: Failed to load module script", ["Failed to load module script"]).code).toBe("WORKER_START");
  });
  it("MEMORY: sem memória para o WebAssembly", () => {
    expect(c("init", "SolidError", "Não foi possível iniciar o motor 3D (OCCT).", ["RangeError: WebAssembly.Memory(): could not allocate memory"]).code).toBe("MEMORY");
    expect(c("sync", "Error", "Aborted(OOM). Build with -sASSERTIONS for more info.").code).toBe("MEMORY");
  });
  it("COMMUNICATION: worker não respondeu / caiu depois de pronto", () => {
    expect(c("comm", undefined, "O motor 3D não respondeu em 90 s.").code).toBe("COMMUNICATION");
    expect(c("init", "DataCloneError", "Failed to execute 'postMessage' on 'Worker': could not be cloned.").code).toBe("COMMUNICATION");
    expect(c("comm", undefined, "x").titulo).toBe("O ambiente 3D parou de responder.");
  });
  it("OCCT_INIT: o resto da inicialização", () => {
    expect(c("init", "SolidError", "Não foi possível iniciar o motor 3D (OCCT).", ["Error: OCCT kernel failed"]).code).toBe("OCCT_INIT");
  });
  it("o erro original fica nos detalhes técnicos (nada é escondido)", () => {
    const d = c("init", "SolidError", "Não foi possível iniciar o motor 3D (OCCT).", ["EvalError: xyz"]);
    const t = diagnosticText(d);
    expect(t).toContain("EvalError: xyz");
    expect(t).toContain("código: CSP");
    expect(t).toContain("teste: true");
    expect(d.mensagem).not.toMatch(/EvalError|unsafe/); // a mensagem para o usuário é legível
  });
});

describe("F-06 — rótulo das falhas de operação", () => {
  it("booleana: extrusão de corte/união e combinação de corpos", () => {
    expect(classifyOperationFailure({ t: "extrude", op: "cut" }).code).toBe("BOOLEAN");
    expect(classifyOperationFailure({ t: "revolve", op: "join" }).code).toBe("BOOLEAN");
    expect(classifyOperationFailure({ t: "combine" }).code).toBe("BOOLEAN");
    expect(classifyOperationFailure({ t: "hole" }).code).toBe("BOOLEAN");
  });
  it("geração do sólido: base, aba, extrusão nova", () => {
    expect(classifyOperationFailure({ t: "extrude", op: "new" }).code).toBe("SOLID");
    expect(classifyOperationFailure({ t: "sheetFlange" }).code).toBe("SOLID");
    expect(classifyOperationFailure(undefined).code).toBe("SOLID");
  });
  it("planificação", () => {
    expect(classifyOperationFailure("flat").rotulo).toBe("Falha na planificação");
    expect(classifyOperationFailure({ t: "sheetFlatCut" }).code).toBe("FLAT");
  });
});
