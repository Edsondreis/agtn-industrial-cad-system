import type { LengthUnit } from "@agtn/geometry";

/** Versões de DWG/DXF do conversor. */
export const CAD_VERSIONS = [
  { id: "ACAD2018", label: "AutoCAD 2018–2025 (AC1032)" },
  { id: "ACAD2013", label: "AutoCAD 2013–2017 (AC1027)" },
  { id: "ACAD2010", label: "AutoCAD 2010–2012 (AC1024)" },
  { id: "ACAD2007", label: "AutoCAD 2007–2009 (AC1021)" },
  { id: "ACAD2004", label: "AutoCAD 2004–2006 (AC1018)" },
  { id: "ACAD2000", label: "AutoCAD 2000–2002 (AC1015) · simplifica" },
  { id: "ACAD14", label: "AutoCAD R14 (AC1014) · simplifica" },
  { id: "ACAD12", label: "AutoCAD R12 (AC1009) · simplifica" },
] as const;
export type CadVersion = (typeof CAD_VERSIONS)[number]["id"];
const isVersion = (v: unknown): v is CadVersion => CAD_VERSIONS.some((x) => x.id === v);

/** Preferências do aplicativo (locais, por usuário). */
export interface AppPrefs {
  showStartCenter: boolean;
  defaultUnits: LengthUnit;
  /** Versão usada ao gravar DWG (exportar / converter). */
  dwgVersion: CadVersion;
  /** Versão do DXF exportado (R12 = máxima compatibilidade com CAM; R2000 = elipse/spline/hachura nativas). */
  dxfVersion: "R12" | "R2000";
}
const KEY = "agtncad.prefs.v1";
const DEFAULTS: AppPrefs = { showStartCenter: true, defaultUnits: "mm", dwgVersion: "ACAD2018", dxfVersion: "R12" };

export function loadPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<AppPrefs>) : {};
    return {
      showStartCenter: typeof p.showStartCenter === "boolean" ? p.showStartCenter : DEFAULTS.showStartCenter,
      defaultUnits: p.defaultUnits === "cm" || p.defaultUnits === "m" ? p.defaultUnits : "mm",
      dwgVersion: isVersion(p.dwgVersion) ? p.dwgVersion : DEFAULTS.dwgVersion,
      dxfVersion: p.dxfVersion === "R2000" ? "R2000" : "R12",
    };
  } catch {
    return { ...DEFAULTS };
  }
}
export function savePrefs(p: AppPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
