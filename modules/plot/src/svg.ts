import { CAP_HEIGHT, type PlotPage, textLines } from "./plot";

/**
 * SVG da folha (para a pré-visualização e para a impressora do sistema).
 * Mesmas primitivas do PDF; a folha tem o tamanho real em milímetros.
 */
const n = (v: number) => String(Math.round(v * 1000) / 1000);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (v: readonly number[]) => `rgb(${v[0]},${v[1]},${v[2]})`;

export function plotToSvg(page: PlotPage, opts: { background?: string } = {}): string {
  const H = page.h;
  const Y = (y: number) => H - y;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(page.w)}mm" height="${n(page.h)}mm" viewBox="0 0 ${n(page.w)} ${n(page.h)}">`,
  );
  if (opts.background) parts.push(`<rect width="100%" height="100%" fill="${opts.background}"/>`);
  const c = page.clip;
  parts.push(`<defs><clipPath id="area"><rect x="${n(c.minX)}" y="${n(Y(c.maxY))}" width="${n(c.maxX - c.minX)}" height="${n(c.maxY - c.minY)}"/></clipPath></defs>`);
  parts.push(`<g clip-path="url(#area)" stroke-linecap="round" stroke-linejoin="round">`);
  for (const f of page.fills) {
    const d = f.polys
      .filter((p) => p.length >= 3)
      .map((p) => `M${p.map((q) => `${n(q.x)} ${n(Y(q.y))}`).join("L")}Z`)
      .join("");
    if (d) parts.push(`<path d="${d}" fill="${col(f.rgb)}" fill-rule="evenodd" stroke="none"/>`);
  }
  for (const s of page.strokes) {
    const d = s.paths
      .filter((p) => p.pts.length)
      .map((p) => {
        const pts = p.pts.length === 1 ? [p.pts[0], p.pts[0]] : p.pts;
        return `M${pts.map((q) => `${n(q.x)} ${n(Y(q.y))}`).join("L")}${p.closed ? "Z" : ""}`;
      })
      .join("");
    if (!d) continue;
    const dash = s.dash.length ? ` stroke-dasharray="${s.dash.map((v) => n(v === 0 ? 0.001 : v)).join(" ")}"` : "";
    parts.push(`<path d="${d}" fill="none" stroke="${col(s.rgb)}" stroke-width="${n(s.width)}"${dash}/>`);
  }
  for (const t of page.texts) {
    const size = t.h / CAP_HEIGHT;
    const anchor = t.halign === 0 ? "start" : t.halign === 1 ? "middle" : "end";
    const deg = (-t.rot * 180) / Math.PI;
    const tspans = textLines(t)
      .map(({ line, dy }) => `<tspan x="0" y="${n(dy)}">${esc(line)}</tspan>`)
      .join("");
    parts.push(
      `<text transform="translate(${n(t.p.x)} ${n(Y(t.p.y))}) rotate(${n(deg)})" font-family="Helvetica, Arial, sans-serif" font-size="${n(size)}" text-anchor="${anchor}" fill="${col(t.rgb)}">${tspans}</text>`,
    );
  }
  parts.push("</g></svg>");
  return parts.join("");
}
