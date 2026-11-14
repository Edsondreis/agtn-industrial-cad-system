import { readFileSync } from "node:fs";
import { OcctKernel } from "occt-wasm";
import { OCCT_GLUE_SHA256, findDynamicCode, patchOcctGlue } from "./occt-csp-patch";

/**
 * F-05 (ETAPA 5): a correção do glue do OCCT.
 *  - estática: o glue original TEM geração de código; o corrigido não; outra versão do glue faz o build parar;
 *  - em execução: inicializar o motor e fazer sólido + booleanas + caixa SEM nenhuma chamada a Function/eval
 *    (o construtor global é trocado por um que registra e recusa). Os testes usam o glue corrigido pelo plugin do
 *    vitest.config.ts — o mesmo do app.
 */
const ORIG = readFileSync(new URL("../../../node_modules/occt-wasm/dist/occt-wasm.js", import.meta.url), "utf8");

describe("F-05 — correção do glue do occt-wasm", () => {
  it("o glue original (5.17.1) gera código; o corrigido não", () => {
    expect(findDynamicCode(ORIG).length).toBeGreaterThan(0);
    const out = patchOcctGlue(ORIG);
    expect(findDynamicCode(out)).toEqual([]);
    expect(out).toContain("AGTN F-05");
  });
  it("glue diferente (outra versão do occt-wasm) → erro, o build para", () => {
    expect(() => patchOcctGlue(`${ORIG} `)).toThrow(/SHA-256/);
    expect(OCCT_GLUE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("as outras partes do glue ficam iguais (só os 2 geradores mudam)", () => {
    const out = patchOcctGlue(ORIG);
    const a = ORIG.indexOf("function createJsInvoker");
    const b = out.indexOf("function createJsInvoker");
    expect(out.slice(0, b)).toBe(ORIG.slice(0, a));
    const tailO = ORIG.slice(ORIG.indexOf("var functionName=`methodCaller<"));
    const tailN = out.slice(out.indexOf("var functionName=`methodCaller<"));
    expect(tailN).toBe(tailO);
  });

  it("motor inicia e faz sólido, booleanas e medidas sem gerar código em tempo de execução", async () => {
    const G = globalThis as { Function: FunctionConstructor; eval: typeof eval };
    const F0 = G.Function;
    const E0 = G.eval;
    const calls: string[] = [];
    const trap = new Proxy(F0, {
      apply: (_t, _s, args) => {
        calls.push(`Function(${String(args.at(-1)).slice(0, 60)})`);
        throw new EvalError("geração de código proibida (teste F-05)");
      },
      construct: (_t, args) => {
        calls.push(`new Function(${String(args.at(-1)).slice(0, 60)})`);
        throw new EvalError("geração de código proibida (teste F-05)");
      },
    });
    G.Function = trap;
    G.eval = ((s: string) => {
      calls.push(`eval(${String(s).slice(0, 60)})`);
      throw new EvalError("eval proibido (teste F-05)");
    }) as typeof eval;
    try {
      const k = await OcctKernel.init();
      const a = k.makeBox(10, 10, 10);
      const c = k.translate(k.makeCylinder(3, 20), 5, 5, -5);
      const f = k.fuse(a, c);
      const d = k.cut(a, c);
      const m = k.common(a, c);
      expect(k.getVolume(a)).toBeCloseTo(1000, 9);
      // cilindro R3 inteiro dentro da caixa em XY, altura 10 dentro dela: volume comum = π·9·10
      expect(k.getVolume(m)).toBeCloseTo(Math.PI * 9 * 10, 6);
      expect(k.getVolume(d)).toBeCloseTo(1000 - Math.PI * 90, 6);
      expect(k.getVolume(f)).toBeCloseTo(1000 + Math.PI * 9 * 10, 6);
      expect(k.isValid(f) && k.isValid(d)).toBe(true);
      const bb = k.getBoundingBox(f);
      expect(bb.zmax - bb.zmin).toBeCloseTo(20, 6);
      for (const h of [a, c, f, d, m]) k.release(h);
    } finally {
      G.Function = F0;
      G.eval = E0;
    }
    expect(calls).toEqual([]);
  });
});
