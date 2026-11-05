import { useState } from "react";
import { aciColor } from "../cad/renderer";

const QUICK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 250, 10, 30, 50, 70, 90, 110, 130, 150, 170, 190, 210, 230, 251, 252, 253, 254, 255, 11, 31, 51];

/** Seletor de cor ACI (índice de cor CAD 1–255). */
export function AciPicker({ value, onChange, allowByLayer }: { value: number | null; onChange: (v: number | null) => void; allowByLayer?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        className="swatch"
        style={{ background: value == null ? "transparent" : aciColor(value), backgroundImage: value == null ? "linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%)" : undefined, backgroundSize: "6px 6px" }}
        title={value == null ? "Por camada" : `ACI ${value}`}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="aci-pop" onMouseLeave={() => setOpen(false)} style={{ top: 18, right: 0 }}>
          {QUICK.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: aciColor(c), width: 16, height: 16, outline: value === c ? "2px solid #3d8bfd" : undefined }}
              title={`ACI ${c}`}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
          {allowByLayer && (
            <button
              className="btn"
              style={{ gridColumn: "1 / -1", height: 22, marginTop: 4 }}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Por camada
            </button>
          )}
          <label style={{ gridColumn: "1 / -1", display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
            <span className="note">ACI</span>
            <input
              type="number"
              min={1}
              max={255}
              defaultValue={value ?? 7}
              style={{ width: 70, height: 22, background: "#23272e", border: "1px solid #353b45" }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  const v = Math.round(Number((e.target as HTMLInputElement).value));
                  if (v >= 1 && v <= 255) {
                    onChange(v);
                    setOpen(false);
                  }
                }
              }}
            />
          </label>
        </div>
      )}
    </span>
  );
}
