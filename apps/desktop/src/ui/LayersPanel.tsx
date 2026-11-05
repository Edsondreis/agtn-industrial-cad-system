import { LINETYPES, LINEWEIGHTS_MM, type Layer, validateLayerName } from "@agtn/document";
import { formatNumber } from "@agtn/geometry";
import { useState } from "react";
import type { CadController } from "../cad/controller";
import { AciPicker } from "./AciPicker";
import { Icon } from "./Icons";
import { useCtl } from "./hooks";

/** Gerenciador de camadas: criar, renomear, excluir, cor, espessura, tipo, visibilidade, bloqueio, atual. */
export function LayersPanel({ ctl }: { ctl: CadController }) {
  useCtl(ctl, "state");
  const doc = ctl.doc;
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const run = (label: string, fn: () => ReturnType<typeof doc.layerUpdateChange>[] | ReturnType<typeof doc.layerUpdateChange>) => {
    try {
      const r = fn();
      ctl.commit(label, Array.isArray(r) ? r : [r]);
    } catch (e) {
      ctl.message(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const patch = (l: Layer, p: Partial<Omit<Layer, "name">>, label: string) => run(label, () => doc.layerUpdateChange(l.name, p));

  const addLayer = () => {
    let i = 1;
    while (doc.layer(`CAMADA${i}`)) i++;
    const name = `CAMADA${i}`;
    run("Nova camada", () => [
      doc.layerAddChange({ name, color: 7, lineweight: 0.25, linetype: "CONTINUOUS", visible: true, locked: false }),
    ]);
    setEditing(name);
    setDraft(name);
  };
  const finishRename = (l: Layer) => {
    const n = draft.trim().toUpperCase();
    setEditing(null);
    if (!n || n === l.name) return;
    const err = validateLayerName(n);
    if (err) {
      ctl.message(`Nome inválido: ${err}`, "error");
      return;
    }
    run("Renomear camada", () => doc.layerRenameChanges(l.name, n));
  };

  const counts = new Map<string, number>();
  for (const e of doc.all()) counts.set(e.layer, (counts.get(e.layer) ?? 0) + 1);

  return (
    <>
      <div className="panel-h">
        Camadas
        <div className="spacer" />
        <button className="ibtn" title="Nova camada" onClick={addLayer}>
          <Icon name="plus" />
        </button>
        <button
          className="ibtn"
          title="Mover seleção para a camada atual"
          disabled={!ctl.sel.size}
          onClick={() => ctl.commit("Mover para camada", doc.updateChanges(ctl.sel.entities().map((e) => ({ ...e, layer: doc.currentLayer }))))}
        >
          <Icon name="moveTo" />
        </button>
      </div>
      <div className="panel-b" style={{ padding: "4px 6px" }}>
        <table className="layers">
          <colgroup>
            <col style={{ width: 26 }} />
            <col />
            <col style={{ width: 26 }} />
            <col style={{ width: 26 }} />
            <col style={{ width: 22 }} />
            <col style={{ width: 66 }} />
            <col style={{ width: 46 }} />
            <col style={{ width: 26 }} />
          </colgroup>
          <tbody>
            {doc.layers.map((l) => {
              const cur = l.name === doc.currentLayer;
              const count = counts.get(l.name) ?? 0;
              return (
                <tr key={l.name} className={cur ? "cur" : ""}>
                  <td>
                    <button className={`tog${cur ? " on" : ""}`} title="Tornar atual" onClick={() => !cur && run("Camada atual", () => doc.setCurrentLayerChange(l.name))}>
                      {cur ? <Icon name="check" /> : null}
                    </button>
                  </td>
                  <td className="nm" title={`${l.name} — ${count} objeto(s). Duplo clique para renomear.`} onDoubleClick={() => l.name !== "0" && (setEditing(l.name), setDraft(l.name))}>
                    {editing === l.name ? (
                      <input
                        autoFocus
                        onFocus={(e) => e.target.select()}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => finishRename(l)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") finishRename(l);
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      l.name
                    )}
                  </td>
                  <td>
                    <button className={`tog${l.visible ? " on" : ""}`} title={l.visible ? "Ocultar" : "Mostrar"} onClick={() => patch(l, { visible: !l.visible }, l.visible ? "Ocultar camada" : "Mostrar camada")}>
                      <Icon name={l.visible ? "eye" : "eyeoff"} />
                    </button>
                  </td>
                  <td>
                    <button className={`tog${l.locked ? " on" : ""}`} title={l.locked ? "Desbloquear" : "Bloquear"} onClick={() => patch(l, { locked: !l.locked }, l.locked ? "Desbloquear camada" : "Bloquear camada")}>
                      <Icon name={l.locked ? "lock" : "unlock"} />
                    </button>
                  </td>
                  <td>
                    <AciPicker value={l.color} onChange={(c) => c != null && patch(l, { color: c }, "Cor da camada")} />
                  </td>
                  <td>
                    <select value={l.linetype} title="Tipo de linha" onChange={(e) => patch(l, { linetype: e.target.value }, "Tipo de linha da camada")}>
                      {LINETYPES.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={String(l.lineweight)} title="Espessura (mm)" onChange={(e) => patch(l, { lineweight: Number(e.target.value) }, "Espessura da camada")}>
                      {LINEWEIGHTS_MM.map((w) => (
                        <option key={w} value={w}>
                          {formatNumber(w, 2, ",")}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="tog" title="Excluir camada" disabled={l.name === "0"} onClick={() => run("Excluir camada", () => doc.layerRemoveChanges(l.name))}>
                      <Icon name="trash" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
