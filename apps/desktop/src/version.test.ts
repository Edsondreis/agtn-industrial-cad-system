import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * FASE 4 · ETAPA 5 (F-08): a versão aparece em 5 lugares e o GitHub Actions publica uma Release automática quando
 * `v<versão do tauri.conf.json>` ainda não existe. Este teste NÃO muda a versão: garante que os 5 lugares concordam
 * e que existe a nota de versão que a publicação usaria (docs/release-notes/v<versão>.md).
 */
const ROOT = new URL("../../../", import.meta.url).pathname;
const j = (p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const tauri = j("apps/desktop/src-tauri/tauri.conf.json").version as string;

describe("versão do aplicativo", () => {
  it("tauri.conf.json, package.json (raiz e desktop), Cargo.toml e Cargo.lock com a mesma versão", () => {
    const cargo = readFileSync(join(ROOT, "apps/desktop/src-tauri/Cargo.toml"), "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    const lock = readFileSync(join(ROOT, "apps/desktop/src-tauri/Cargo.lock"), "utf8").match(/name = "agtn-cad"\nversion = "([^"]+)"/)?.[1];
    expect({ raiz: j("package.json").version, desktop: j("apps/desktop/package.json").version, cargo, lock }).toEqual({ raiz: tauri, desktop: tauri, cargo: tauri, lock: tauri });
  });
  it("versão semver; pré-lançamento só numérico (exigência do MSI/WiX)", () => {
    expect(tauri).toMatch(/^\d+\.\d+\.\d+(-\d+)?$/);
  });
  it("a nota de versão que a publicação automática usaria existe", () => {
    expect(existsSync(join(ROOT, `docs/release-notes/v${tauri}.md`))).toBe(true);
  });
});
