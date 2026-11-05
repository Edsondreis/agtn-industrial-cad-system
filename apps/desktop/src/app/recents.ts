/**
 * Lista de arquivos recentes — persistente entre sessões (localStorage do WebView, leve e local).
 * Só registra arquivos reais abertos/salvos pelo usuário (com caminho no disco).
 */
export interface RecentItem {
  path: string;
  name: string;
  kind: "agtncad" | "dxf";
  lastOpened: string;
}

export interface KVStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const RECENTS_KEY = "agtncad.recents.v1";
export const MAX_RECENTS = 15;

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const dirName = (p: string) => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
};

export class RecentStore {
  private items: RecentItem[] = [];
  private subs = new Set<() => void>();
  constructor(private readonly storage: KVStorage | null) {
    this.items = this.load();
  }
  private load(): RecentItem[] {
    try {
      const raw = this.storage?.getItem(RECENTS_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      if (!Array.isArray(arr)) return [];
      return arr
        .filter((x): x is RecentItem => !!x && typeof x.path === "string" && typeof x.name === "string" && typeof x.lastOpened === "string")
        .map((x) => ({ ...x, kind: /\.dxf$/i.test(x.path) ? "dxf" : "agtncad" }) as RecentItem)
        .slice(0, MAX_RECENTS);
    } catch {
      return [];
    }
  }
  private save() {
    try {
      this.storage?.setItem(RECENTS_KEY, JSON.stringify(this.items));
    } catch {
      /* armazenamento indisponível: lista vale só nesta sessão */
    }
    for (const f of this.subs) f();
  }
  list(): readonly RecentItem[] {
    return this.items;
  }
  /** Registra abertura/salvamento. Caminhos iguais (sem diferenciar maiúsculas no Windows) são unificados. */
  touch(path: string, when = new Date()): void {
    if (!path) return;
    const key = path.toLowerCase();
    const rest = this.items.filter((i) => i.path.toLowerCase() !== key);
    const name = baseName(path).replace(/\.(agtncad|dxf)$/i, "");
    const item: RecentItem = { path, name, kind: /\.dxf$/i.test(path) ? "dxf" : "agtncad", lastOpened: when.toISOString() };
    this.items = [item, ...rest].slice(0, MAX_RECENTS);
    this.save();
  }
  remove(path: string): void {
    this.items = this.items.filter((i) => i.path !== path);
    this.save();
  }
  clear(): void {
    this.items = [];
    this.save();
  }
  subscribe(fn: () => void): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }
}

const browserStorage = (): KVStorage | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};
export const recents = new RecentStore(browserStorage());
