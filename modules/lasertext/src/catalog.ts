/**
 * Fontes para corte a laser — todas sob SIL Open Font License 1.1 (licenças em ../fonts/licenses).
 * Arquivos WOFF (subconjunto latino com acentos do português).
 */
export type FontKind = "stencil" | "industrial" | "script";

export interface LaserFont {
  id: string;
  name: string;
  file: string;
  kind: FontKind;
  /** modo recomendado */
  best: "vazado" | "emendado";
  note: string;
}

export const LASER_FONTS: readonly LaserFont[] = [
  { id: "black-ops-one", name: "Black Ops One (stencil militar)", file: "black-ops-one-400.woff", kind: "stencil", best: "vazado", note: "Pontes próprias da fonte; ótima para placas." },
  { id: "allerta-stencil", name: "Allerta Stencil", file: "allerta-stencil-400.woff", kind: "stencil", best: "vazado", note: "Stencil sem serifa, legível em tamanhos pequenos." },
  { id: "big-shoulders-stencil-display", name: "Big Shoulders Stencil (condensada)", file: "big-shoulders-stencil-display-700.woff", kind: "stencil", best: "vazado", note: "Condensada, ocupa pouca largura." },
  { id: "saira-stencil-one", name: "Saira Stencil", file: "saira-stencil-one-400.woff", kind: "stencil", best: "vazado", note: "Stencil técnica, cantos retos." },
  { id: "stardos-stencil", name: "Stardos Stencil (serifada)", file: "stardos-stencil-700.woff", kind: "stencil", best: "vazado", note: "Stencil serifada clássica." },
  { id: "barlow", name: "Barlow Bold (industrial)", file: "barlow-700.woff", kind: "industrial", best: "vazado", note: "Sem serifa industrial; pontes automáticas no vazado." },
  { id: "oswald", name: "Oswald SemiBold (condensada)", file: "oswald-600.woff", kind: "industrial", best: "vazado", note: "Condensada; pontes automáticas no vazado." },
  { id: "roboto-condensed", name: "Roboto Condensed Bold", file: "roboto-condensed-700.woff", kind: "industrial", best: "vazado", note: "Neutra e compacta; boa para marcação." },
  { id: "pacifico", name: "Pacifico (cursiva)", file: "pacifico-400.woff", kind: "script", best: "emendado", note: "Letras naturalmente ligadas; ideal para peça emendada." },
  { id: "lobster", name: "Lobster (cursiva)", file: "lobster-400.woff", kind: "script", best: "emendado", note: "Cursiva encorpada; ligações largas." },
];

export const fontById = (id: string): LaserFont => LASER_FONTS.find((f) => f.id === id) ?? LASER_FONTS[0];
