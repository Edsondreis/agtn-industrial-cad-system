import { type LaserTextOptions, DEFAULT_LASER_TEXT, LASER_FONTS, buildLaserText, fontById, parseFont } from "@agtn/lasertext";
import { type Entity, type TextEntity, rotation, transformEntity, translation, compose } from "@agtn/geometry";

type Font = ReturnType<typeof parseFont>;

/** URLs dos arquivos de fonte empacotados pelo Vite. */
const URLS = import.meta.glob("../../../../modules/lasertext/fonts/*.woff", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const cache = new Map<string, Promise<Font>>();

export function loadLaserFont(id: string): Promise<Font> {
  const f = fontById(id);
  let p = cache.get(f.id);
  if (!p) {
    const url = Object.entries(URLS).find(([k]) => k.endsWith(`/${f.file}`))?.[1];
    if (!url) return Promise.reject(new Error(`Fonte ${f.name} não empacotada.`));
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Falha ao carregar a fonte ${f.name}.`);
        return r.arrayBuffer();
      })
      .then(parseFont);
    cache.set(f.id, p);
  }
  return p;
}

export const MARK_FONT = "roboto-condensed";

/**
 * Converte entidades TEXT das camadas de marcação em contornos (geometria) para o laser,
 * mantendo posição, altura, rotação e alinhamento.
 */
export async function textsToGeometry(ents: Entity[], layers: string[] = ["MARCACAO"], fontId = MARK_FONT): Promise<Entity[]> {
  const targets = ents.filter((e): e is TextEntity => e.type === "text" && layers.includes(e.layer));
  if (!targets.length) return ents;
  const font = await loadLaserFont(fontId);
  const out: Entity[] = [];
  for (const e of ents) {
    if (e.type !== "text" || !layers.includes(e.layer)) {
      out.push(e);
      continue;
    }
    const opt: LaserTextOptions = {
      ...DEFAULT_LASER_TEXT,
      text: e.value,
      height: e.h,
      mode: "marcacao",
      align: e.halign === 1 ? "center" : e.halign === 2 ? "right" : "left",
      thickness: 0,
      tolerance: Math.max(0.005, e.h / 2000),
    };
    const r = buildLaserText(font, opt);
    const m = compose(translation(e.p.x, e.p.y), rotation(e.rot));
    for (const g of r.entities) out.push({ ...transformEntity(g, m), layer: e.layer, color: e.color });
  }
  return out;
}

export { LASER_FONTS };
