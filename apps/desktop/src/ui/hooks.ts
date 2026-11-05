import { useSyncExternalStore } from "react";
import type { CadController, CtlEvent } from "../cad/controller";

/** Re-renderiza o componente quando o controlador emite o evento indicado. */
export function useCtl(ctl: CadController, ev: CtlEvent = "state"): number {
  return useSyncExternalStore(
    (cb) => ctl.on(ev, cb),
    () => ctl.versionOf(ev),
  );
}
