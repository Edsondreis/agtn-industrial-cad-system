import { describe, expect, it } from "vitest";
import { MAX_RECENTS, RECENTS_KEY, RecentStore, dirName } from "./recents";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("arquivos recentes", () => {
  it("registra, ordena pelo mais recente e persiste", () => {
    const s = mem();
    const r = new RecentStore(s);
    r.touch("C:\\Projetos\\Perfil U.agtncad", new Date("2026-11-01"));
    r.touch("D:\\DXF\\flange.dxf", new Date("2026-11-02"));
    expect(r.list().map((i) => i.name)).toEqual(["flange", "Perfil U"]);
    expect(r.list()[0].kind).toBe("dxf");
    const again = new RecentStore(s);
    expect(again.list()).toHaveLength(2);
  });
  it("reabrir move para o topo sem duplicar (caminho sem diferenciar maiúsculas)", () => {
    const r = new RecentStore(mem());
    r.touch("C:\\a.agtncad");
    r.touch("C:\\b.agtncad");
    r.touch("c:\\A.agtncad");
    expect(r.list()).toHaveLength(2);
    expect(r.list()[0].path).toBe("c:\\A.agtncad");
  });
  it("remove item e limita o tamanho", () => {
    const r = new RecentStore(mem());
    for (let i = 0; i < 30; i++) r.touch(`C:\\p${i}.agtncad`);
    expect(r.list()).toHaveLength(MAX_RECENTS);
    r.remove("C:\\p29.agtncad");
    expect(r.list().some((i) => i.path === "C:\\p29.agtncad")).toBe(false);
  });
  it("ignora dados corrompidos sem quebrar", () => {
    const s = mem();
    s.m.set(RECENTS_KEY, "{lixo");
    expect(new RecentStore(s).list()).toEqual([]);
    s.m.set(RECENTS_KEY, JSON.stringify([{ path: 1 }, { path: "C:\\x.dxf", name: "x", lastOpened: "2026-01-01" }]));
    expect(new RecentStore(s).list()).toHaveLength(1);
  });
  it("pasta do arquivo", () => {
    expect(dirName("C:\\Projetos\\AGTN\\a.agtncad")).toBe("C:\\Projetos\\AGTN");
    expect(dirName("/home/x/a.dxf")).toBe("/home/x");
  });
});
