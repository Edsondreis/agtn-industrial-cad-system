import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

/**
 * FASE 4 · ETAPA 4 — scripts de homologação do Windows (scripts/windows). Não roda PowerShell (o ambiente de
 * desenvolvimento não tem Windows); confere o que já derrubou um script antes de ele chegar ao PC da AGTN:
 *  - F-04: o Windows PowerShell 5.1 lê .ps1 SEM BOM como ANSI (cp1252). O "—" em UTF-8 (E2 80 94) vira "â€”", e o
 *    0x94 é "”", que o PowerShell trata como ASPAS → a string fecha no meio e o script inteiro não abre.
 *    Regra: todo .ps1 com caractere não-ASCII tem BOM UTF-8.
 *  - o JavaScript injetado no app compila; as referências cobrem todos os projetos que o script abre.
 */
const ROOT = new URL("../../../", import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const ps1 = walk(join(ROOT, "scripts/windows")).filter((f) => f.endsWith(".ps1"));

describe("scripts de homologação do Windows", () => {
  it("existem os três scripts", () => {
    expect(ps1.map((f) => f.slice(ROOT.length)).sort()).toEqual(["scripts/windows/homologacao.ps1", "scripts/windows/smoke/webview2_smoke.ps1", "scripts/windows/validar_instalado.ps1"]);
  });
  for (const f of ps1)
    it(`${f.slice(ROOT.length)}: UTF-8 com BOM (PowerShell 5.1 não lê acento/— sem BOM)`, () => {
      const b = readFileSync(f);
      const hasBom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
      const nonAscii = b.some((x) => x > 127);
      expect(!nonAscii || hasBom).toBe(true);
      // e o texto é UTF-8 válido
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(b)).not.toThrow();
    });
  it("agtn_smoke.js compila e define window.__agtnSmoke", () => {
    const src = readFileSync(join(ROOT, "scripts/windows/smoke/agtn_smoke.js"), "utf8");
    // vm (e não Function/eval): o teste também roda com --disallow-code-generation-from-strings
    const w: Record<string, unknown> = {};
    runInNewContext(src, { window: w });
    expect(typeof w.__agtnSmoke).toBe("function");
  });
  it("referencias.json cobre os projetos abertos pelo webview2_smoke.ps1, e eles existem", () => {
    const ref = JSON.parse(readFileSync(join(ROOT, "scripts/windows/smoke/referencias.json"), "utf8"));
    const ps = readFileSync(join(ROOT, "scripts/windows/smoke/webview2_smoke.ps1"), "utf8");
    const list = [...(ps.match(/\[string\[\]\]\$Arquivos = @\(([^)]*)\)/)?.[1].matchAll(/"([^"]+)"/g) ?? [])].map((m) => m[1]);
    expect(list.length).toBeGreaterThanOrEqual(5);
    for (const f of list) {
      expect(ref[f], f).toBeDefined();
      expect(() => statSync(join(ROOT, "modules/sheet3d/src/fixtures", f))).not.toThrow();
    }
  });
});
