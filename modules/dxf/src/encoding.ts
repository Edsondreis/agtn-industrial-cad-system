/**
 * Codificação de texto DXF.
 * - Até AC1018 (R2004) o arquivo é codificado na página de código do desenho ($DWGCODEPAGE), tipicamente ANSI_1252.
 * - A partir de AC1021 (R2007) o arquivo é UTF-8.
 * O AGTN CAD exporta R12 (AC1009) em Windows-1252, com os códigos de controle %%d (°), %%c (Ø), %%p (±).
 */
let cp1252Map: Map<string, number> | null = null;

function cp1252(): Map<string, number> {
  if (cp1252Map) return cp1252Map;
  const m = new Map<string, number>();
  const dec = new TextDecoder("windows-1252");
  for (let b = 0x80; b <= 0xff; b++) {
    const ch = dec.decode(new Uint8Array([b]));
    if (ch && ch !== "�") m.set(ch, b);
  }
  cp1252Map = m;
  return m;
}

/** Texto para DXF R12: substitui símbolos técnicos por códigos de controle AutoCAD. */
export function toDxfText(s: string): string {
  return s.replace(/°/g, "%%d").replace(/[ØⰞ⌀]/g, "%%c").replace(/±/g, "%%p").replace(/[\r\n]+/g, " ");
}

/** Códigos de controle AutoCAD → caracteres. */
export function fromDxfText(s: string): string {
  return s
    .replace(/%%[dD]/g, "°")
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[uUoO]/g, "")
    .replace(/%%%/g, "%")
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Codifica string em Windows-1252 (caracteres fora da página viram "?"). */
export function encodeCp1252(s: string): Uint8Array {
  const m = cp1252();
  const out = new Uint8Array(s.length);
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out[n++] = c;
    else out[n++] = m.get(ch) ?? 0x3f;
  }
  return out.slice(0, n);
}

/** Decodifica bytes DXF escolhendo a codificação pela versão declarada no cabeçalho. */
export function decodeDxfBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length >= 22) {
    const sig = new TextDecoder("ascii").decode(bytes.slice(0, 22));
    if (sig.startsWith("AutoCAD Binary DXF")) throw new Error("DXF binário não suportado. Salve como DXF ASCII.");
  }
  const head = new TextDecoder("latin1").decode(bytes.slice(0, Math.min(bytes.length, 64 * 1024)));
  const ver = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(head)?.[1] ?? "AC1009";
  const verNum = Number(ver.slice(2));
  if (verNum >= 1021) return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" };
  const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(head)?.[1]?.toUpperCase() ?? "ANSI_1252";
  const map: Record<string, string> = {
    ANSI_1252: "windows-1252",
    ANSI_1250: "windows-1250",
    ANSI_1251: "windows-1251",
    ANSI_1253: "windows-1253",
    ANSI_1254: "windows-1254",
    ANSI_874: "windows-874",
    ANSI_932: "shift_jis",
    ANSI_936: "gbk",
    ANSI_949: "euc-kr",
    ANSI_950: "big5",
  };
  const enc = map[cp] ?? "windows-1252";
  try {
    return { text: new TextDecoder(enc).decode(bytes), encoding: enc };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}
