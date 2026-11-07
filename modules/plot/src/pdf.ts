import { HELVETICA_WIDTHS } from "./helvetica";
import { CAP_HEIGHT, type PlotPage, textLines } from "./plot";

/**
 * Escritor de PDF 1.4 vetorial próprio (sem bibliotecas).
 * - Página do tamanho da folha; conteúdo desenhado em milímetros (matriz 72/25,4).
 * - Linhas com pontas e cantos arredondados (como a caneta de uma plotter).
 * - Texto em Helvetica (fonte-padrão do PDF, não precisa embutir), codificação WinAnsi.
 * Tudo é ASCII: acentos vão como escape octal, então os deslocamentos da tabela xref são exatos.
 */

const n = (v: number): string => {
  if (!Number.isFinite(v)) return "0";
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? "0" : String(r);
};

let cp1252: Map<string, number> | null = null;
function winAnsi(ch: string): number {
  const c = ch.codePointAt(0)!;
  if (c < 0x80) return c;
  if (!cp1252) {
    cp1252 = new Map();
    const dec = new TextDecoder("windows-1252");
    for (let b = 0x80; b <= 0xff; b++) {
      const s = dec.decode(new Uint8Array([b]));
      if (s && s !== "�") cp1252.set(s, b);
    }
  }
  return cp1252.get(ch) ?? 0x3f;
}

/** String PDF literal em WinAnsi com escapes. */
export function pdfString(s: string): string {
  let out = "(";
  for (const ch of s.replace(/Ⰾ|⌀/g, "Ø")) {
    const b = winAnsi(ch);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) out += "\\" + b.toString(8).padStart(3, "0");
    else out += String.fromCharCode(b);
  }
  return out + ")";
}

/** Largura do texto em Helvetica, em unidades do corpo (multiplicar pelo tamanho da fonte). */
export function helveticaWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += HELVETICA_WIDTHS[winAnsi(ch)] ?? 556;
  return w / 1000;
}

export interface PdfMeta {
  title?: string;
  author?: string;
}

export function plotToPdf(page: PlotPage, meta: PdfMeta = {}): Uint8Array {
  const k = 72 / 25.4;
  const c: string[] = [];
  c.push(`${n(k)} 0 0 ${n(k)} 0 0 cm`);
  c.push("1 J 1 j");
  // recorte na área plotada
  const cl = page.clip;
  c.push(`${n(cl.minX)} ${n(cl.minY)} ${n(cl.maxX - cl.minX)} ${n(cl.maxY - cl.minY)} re W n`);
  const rgb = (v: readonly number[]) => v.map((x) => n(x / 255)).join(" ");
  for (const f of page.fills) {
    c.push(`${rgb(f.rgb)} rg`);
    for (const poly of f.polys) {
      if (poly.length < 3) continue;
      c.push(`${n(poly[0].x)} ${n(poly[0].y)} m`);
      for (let i = 1; i < poly.length; i++) c.push(`${n(poly[i].x)} ${n(poly[i].y)} l`);
      c.push("h");
    }
    c.push("f*");
  }
  for (const s of page.strokes) {
    c.push(`${rgb(s.rgb)} RG ${n(s.width)} w [${s.dash.map(n).join(" ")}] 0 d`);
    for (const p of s.paths) {
      if (!p.pts.length) continue;
      c.push(`${n(p.pts[0].x)} ${n(p.pts[0].y)} m`);
      for (let i = 1; i < p.pts.length; i++) c.push(`${n(p.pts[i].x)} ${n(p.pts[i].y)} l`);
      if (p.closed) c.push("h");
      c.push("S");
    }
  }
  for (const t of page.texts) {
    const size = t.h / CAP_HEIGHT;
    const cs = Math.cos(t.rot);
    const sn = Math.sin(t.rot);
    c.push(`BT /F1 ${n(size)} Tf ${rgb(t.rgb)} rg`);
    for (const { line, dy } of textLines(t)) {
      if (!line) continue;
      const wdt = helveticaWidth(line) * size;
      const dx = t.halign === 0 ? 0 : t.halign === 1 ? -wdt / 2 : -wdt;
      // posição local (dx, −dy) girada
      const x = t.p.x + dx * cs + dy * sn;
      const y = t.p.y + dx * sn - dy * cs;
      c.push(`${n(cs)} ${n(sn)} ${n(-sn)} ${n(cs)} ${n(x)} ${n(y)} Tm ${pdfString(line)} Tj`);
    }
    c.push("ET");
  }
  const content = c.join("\n");
  const W = n(page.w * k);
  const H = n(page.h * k);
  const date = pdfDate(new Date());
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Producer ${pdfString("AGTN Industrial CAD")} /Creator ${pdfString("AGTN Industrial CAD")} /Title ${pdfString(meta.title ?? "Desenho")}${
      meta.author ? ` /Author ${pdfString(meta.author)}` : ""
    } /CreationDate (${date}) >>`,
  ];
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // conteúdo é ASCII, exceto os 4 bytes binários do cabeçalho (latin1 → 1 byte cada)
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

function pdfDate(d: Date): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
