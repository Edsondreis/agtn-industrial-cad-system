import type { ReactNode } from "react";
import { NumField } from "./fields";

/**
 * Campo de medida com tipo visível (cor + etiqueta + unidade):
 *  ext = medida externa · int = medida interna · thk = espessura · ang = ângulo
 *  rad = raio · k = fator K · len = comprimento/valor geral
 */
export type MeasureKind = "ext" | "int" | "thk" | "ang" | "rad" | "k" | "len";

export const MEASURE_INFO: Record<MeasureKind, { tag: string; title: string }> = {
  ext: { tag: "EXT", title: "Medida externa (até o vértice virtual externo)" },
  int: { tag: "INT", title: "Medida interna (até o vértice virtual interno)" },
  thk: { tag: "T", title: "Espessura da chapa" },
  ang: { tag: "∠", title: "Ângulo" },
  rad: { tag: "R", title: "Raio" },
  k: { tag: "K", title: "Fator K (posição do eixo neutro)" },
  len: { tag: "L", title: "Comprimento / valor" },
};

export function MeasureField({
  label,
  kind,
  value,
  onCommit,
  unit = "mm",
  tag,
  digits = 3,
  min,
  disabled,
  bad,
  title,
  onTagClick,
  extra,
}: {
  label: ReactNode;
  kind: MeasureKind;
  value: number;
  onCommit: (v: number) => void;
  unit?: string;
  tag?: string;
  digits?: number;
  min?: number;
  disabled?: boolean;
  bad?: boolean;
  title?: string;
  /** clique na etiqueta (ex.: alternar externa/interna) */
  onTagClick?: () => void;
  extra?: ReactNode;
}) {
  const info = MEASURE_INFO[kind];
  return (
    <div className={`mf mk-${kind}`} title={title}>
      <div className="lab">
        <span
          className="mtag"
          title={onTagClick ? `${info.title} — clique para alternar` : info.title}
          onClick={onTagClick}
          style={onTagClick ? { cursor: "pointer" } : undefined}
        >
          {tag ?? info.tag}
        </span>
        <span>{label}</span>
        {extra}
      </div>
      <div className={`mbox${bad ? " bad" : ""}`}>
        <NumField value={value} onCommit={onCommit} digits={digits} min={min} disabled={disabled} />
        {unit && <span className="unit">{unit}</span>}
      </div>
    </div>
  );
}

export function MeasureLegend({ kinds }: { kinds: MeasureKind[] }) {
  return (
    <div className="mlegend">
      {kinds.map((k) => (
        <span key={k} className={`mk-${k}`}>
          <span className="mtag">{MEASURE_INFO[k].tag}</span>
          {MEASURE_INFO[k].title.split(" (")[0]}
        </span>
      ))}
    </div>
  );
}
