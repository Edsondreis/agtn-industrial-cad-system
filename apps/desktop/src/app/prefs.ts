import type { LengthUnit } from "@agtn/geometry";

/** Preferências do aplicativo (locais, por usuário). */
export interface AppPrefs {
  showStartCenter: boolean;
  defaultUnits: LengthUnit;
}
const KEY = "agtncad.prefs.v1";
const DEFAULTS: AppPrefs = { showStartCenter: true, defaultUnits: "mm" };

export function loadPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as Partial<AppPrefs>) : {};
    return {
      showStartCenter: typeof p.showStartCenter === "boolean" ? p.showStartCenter : DEFAULTS.showStartCenter,
      defaultUnits: p.defaultUnits === "cm" || p.defaultUnits === "m" ? p.defaultUnits : "mm",
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
