import { type ProfileSpec, type PrimitiveKind, type PrimitiveSpec, PRIMITIVE_LABEL, PROFILE_LABEL, describePrimitive, sectionArea, validatePrimitive } from "@agtn/solid";
import { useMemo, useState } from "react";
import { Modal } from "../ui/Dialogs";
import { parseNum } from "../ui/fields";

/** Campos editáveis de cada primitiva (chave no spec, rótulo, unidade). */
export const PRIM_FIELDS: Record<Exclude<PrimitiveKind, "profile">, [key: string, label: string][]> = {
  box: [["w", "Largura X"], ["d", "Profundidade Y"], ["h", "Altura Z"]],
  cylinder: [["r", "Raio"], ["h", "Altura"]],
  sphere: [["r", "Raio"]],
  cone: [["r1", "Raio da base"], ["r2", "Raio do topo"], ["h", "Altura"]],
  torus: [["R", "Raio maior"], ["r", "Raio menor"]],
  plane: [["w", "Largura X"], ["d", "Profundidade Y"]],
  tube: [["od", "Diâmetro externo"], ["t", "Parede"], ["h", "Comprimento"]],
};
export const PROFILE_FIELDS: Record<ProfileSpec["shape"], [key: string, label: string][]> = {
  L: [["a", "Aba a (Y)"], ["b", "Aba b (X)"], ["t", "Espessura"]],
  U: [["h", "Altura"], ["b", "Aba"], ["tw", "Espessura da alma"], ["tf", "Espessura da aba"]],
  I: [["h", "Altura"], ["b", "Largura da mesa"], ["tw", "Espessura da alma"], ["tf", "Espessura da mesa"]],
  RHS: [["b", "Largura"], ["h", "Altura"], ["t", "Parede"]],
  FLAT: [["b", "Largura"], ["t", "Espessura"]],
};

export const DEFAULT_SPECS: Record<PrimitiveKind, PrimitiveSpec> = {
  box: { kind: "box", w: 200, d: 100, h: 50 },
  cylinder: { kind: "cylinder", r: 50, h: 100 },
  sphere: { kind: "sphere", r: 50 },
  cone: { kind: "cone", r1: 50, r2: 20, h: 100 },
  torus: { kind: "torus", R: 80, r: 15 },
  plane: { kind: "plane", w: 200, d: 100 },
  tube: { kind: "tube", od: 60.3, t: 3.91, h: 500 },
  profile: { kind: "profile", length: 1000, profile: { shape: "U", h: 100, b: 50, tw: 6, tf: 8 } },
};
export const DEFAULT_PROFILES: Record<ProfileSpec["shape"], ProfileSpec> = {
  L: { shape: "L", a: 50.8, b: 50.8, t: 6.35 },
  U: { shape: "U", h: 101.6, b: 40.2, tw: 4.67, tf: 7.52 },
  I: { shape: "I", h: 200, b: 100, tw: 5.6, tf: 8.5 },
  RHS: { shape: "RHS", b: 50, h: 100, t: 3 },
  FLAT: { shape: "FLAT", b: 76.2, t: 9.52 },
};

const fmt = (v: number) => String(Number(v.toFixed(4))).replace(".", ",");
type Vals = Record<string, string>;

function toVals(s: PrimitiveSpec): Vals {
  if (s.kind === "profile") {
    const v: Vals = { length: fmt(s.length) };
    for (const [k] of PROFILE_FIELDS[s.profile.shape]) v[k] = fmt((s.profile as unknown as Record<string, number>)[k]);
    return v;
  }
  const v: Vals = {};
  for (const [k] of PRIM_FIELDS[s.kind]) v[k] = fmt((s as unknown as Record<string, number>)[k]);
  return v;
}

function fromVals(kind: PrimitiveKind, shape: ProfileSpec["shape"], v: Vals): PrimitiveSpec {
  const n = (k: string) => parseNum(v[k] ?? "") ?? Number.NaN;
  if (kind === "profile") {
    const p: Record<string, unknown> = { shape };
    for (const [k] of PROFILE_FIELDS[shape]) p[k] = n(k);
    return { kind, length: n("length"), profile: p as unknown as ProfileSpec };
  }
  const s: Record<string, unknown> = { kind };
  for (const [k] of PRIM_FIELDS[kind]) s[k] = n(k);
  return s as unknown as PrimitiveSpec;
}

export interface PrimitiveResult {
  spec: PrimitiveSpec;
  name: string;
  origin: { x: number; y: number; z: number };
  rot: { x: number; y: number; z: number };
}

/**
 * Criação (ou edição) de primitiva paramétrica. Valida antes de liberar o botão e mostra o volume teórico
 * para o usuário conferir a medida antes de criar.
 */
export function PrimitiveDialog({
  initial,
  title,
  submitLabel,
  onSubmit,
  onClose,
}: {
  initial: PrimitiveSpec;
  title: string;
  submitLabel: string;
  onSubmit: (r: PrimitiveResult) => string | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<PrimitiveKind>(initial.kind);
  const [shape, setShape] = useState<ProfileSpec["shape"]>(initial.kind === "profile" ? initial.profile.shape : "U");
  const [vals, setVals] = useState<Vals>(() => toVals(initial));
  const [name, setName] = useState("");
  const [pos, setPos] = useState<Vals>({ x: "0", y: "0", z: "0", rx: "0", ry: "0", rz: "0" });
  const [err, setErr] = useState<string | null>(null);

  const spec = useMemo(() => fromVals(kind, shape, vals), [kind, shape, vals]);
  const errors = useMemo(() => validatePrimitive(spec), [spec]);
  const posBad = Object.values(pos).some((v) => parseNum(v) === null);

  const switchKind = (k: PrimitiveKind) => {
    setKind(k);
    setVals(toVals(k === "profile" ? { ...(DEFAULT_SPECS.profile as Extract<PrimitiveSpec, { kind: "profile" }>), profile: DEFAULT_PROFILES[shape] } : DEFAULT_SPECS[k]));
  };
  const switchShape = (sh: ProfileSpec["shape"]) => {
    setShape(sh);
    setVals({ ...toVals({ kind: "profile", length: parseNum(vals.length ?? "") ?? 1000, profile: DEFAULT_PROFILES[sh] }) });
  };
  const fields = kind === "profile" ? [...PROFILE_FIELDS[shape], ["length", "Comprimento (Z)"] as [string, string]] : PRIM_FIELDS[kind];
  const info = !errors.length ? describePrimitive(spec) : null;
  const area = !errors.length && spec.kind === "profile" ? sectionArea(spec.profile) : null;

  const submit = () => {
    if (errors.length || posBad) return;
    const p = (k: string) => parseNum(pos[k])!;
    const e = onSubmit({ spec, name, origin: { x: p("x"), y: p("y"), z: p("z") }, rot: { x: p("rx"), y: p("ry"), z: p("rz") } });
    if (e) setErr(e);
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={460}
      footer={
        <>
          <span className="note" style={{ marginRight: "auto" }}>
            Medidas em mm · ângulos em graus
          </span>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!!errors.length || posBad} onClick={submit} data-testid="prim-submit">
            {submitLabel}
          </button>
        </>
      }
    >
      <form
        className="prim-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="sm-row">
          <span className="k">Tipo</span>
          <select value={kind} onChange={(e) => switchKind(e.target.value as PrimitiveKind)} disabled={submitLabel !== "Criar"}>
            {(Object.keys(PRIMITIVE_LABEL) as PrimitiveKind[]).map((k) => (
              <option key={k} value={k}>
                {PRIMITIVE_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        {kind === "profile" && (
          <div className="sm-row">
            <span className="k">Perfil</span>
            <select value={shape} onChange={(e) => switchShape(e.target.value as ProfileSpec["shape"])}>
              {(Object.keys(PROFILE_LABEL) as ProfileSpec["shape"][]).map((k) => (
                <option key={k} value={k}>
                  {PROFILE_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
        )}
        {submitLabel === "Criar" && (
          <div className="sm-row">
            <span className="k">Nome</span>
            <input value={name} placeholder="automático" onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </div>
        )}
        <h4 className="prim-h">Dimensões</h4>
        {fields.map(([k, label]) => (
          <div className="sm-row" key={`${kind}-${shape}-${k}`}>
            <span className="k">{label}</span>
            <span className="unit-in">
              <input
                value={vals[k] ?? ""}
                autoFocus={k === fields[0][0]}
                className={parseNum(vals[k] ?? "") === null ? "bad" : ""}
                onChange={(e) => setVals({ ...vals, [k]: e.target.value })}
                spellCheck={false}
                data-field={k}
              />
              <i>mm</i>
            </span>
          </div>
        ))}
        {submitLabel === "Criar" && (
          <>
            <h4 className="prim-h">Posição</h4>
            <div className="xyz">
              {(["x", "y", "z"] as const).map((k) => (
                <label key={k}>
                  <b className={`ax-${k}`}>{k.toUpperCase()}</b>
                  <input value={pos[k]} onChange={(e) => setPos({ ...pos, [k]: e.target.value })} spellCheck={false} />
                </label>
              ))}
            </div>
            <div className="xyz">
              {(["rx", "ry", "rz"] as const).map((k) => (
                <label key={k}>
                  <b className={`ax-${k[1]}`}>∠{k[1].toUpperCase()}</b>
                  <input value={pos[k]} onChange={(e) => setPos({ ...pos, [k]: e.target.value })} spellCheck={false} />
                </label>
              ))}
            </div>
          </>
        )}
        <div className={`prim-check${errors.length ? " bad" : ""}`} role="status">
          {errors.length ? errors[0] : `${info}${area !== null ? ` · seção ${fmt(area)} mm²` : ""}`}
        </div>
        {err && <div className="prim-check bad">{err}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
