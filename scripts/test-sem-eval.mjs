// FASE 4 · ETAPA 5 (F-05): roda a suíte inteira com o V8 PROIBINDO geração de código a partir de texto
// (eval/new Function lançam EvalError) — a mesma restrição que a CSP sem 'unsafe-eval' impõe ao app.
// Uso: npm run test:sem-eval   (funciona no Windows e no Linux)
import { spawnSync } from "node:child_process";
const flag = "--disallow-code-generation-from-strings";
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} ${flag}`.trim() };
const r = spawnSync("npx", ["vitest", "run", ...process.argv.slice(2)], { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(r.status ?? 1);
