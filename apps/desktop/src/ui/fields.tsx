import { useEffect, useRef, useState } from "react";

/** Converte texto digitado em número aceitando vírgula ou ponto decimal. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Campo numérico que confirma com Enter/blur e reverte com Esc. */
export function NumField({
  value,
  onCommit,
  digits = 4,
  min,
  disabled,
  className,
  title,
}: {
  value: number;
  onCommit: (v: number) => void;
  digits?: number;
  min?: number;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))).replace(".", ",") : "");
  const [txt, setTxt] = useState(fmt(value));
  const [bad, setBad] = useState(false);
  /** o usuário digitou desde a última sincronização? (sem isso, um campo que perde o foco logo depois de o
   * valor mudar por fora — ex.: θ ↔ α — gravaria o texto antigo de volta) */
  const dirty = useRef(false);
  useEffect(() => {
    setTxt(fmt(value));
    setBad(false);
    dirty.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = () => {
    if (!dirty.current) {
      setTxt(fmt(value));
      setBad(false);
      return;
    }
    dirty.current = false;
    const v = parseNum(txt);
    if (v === null || (min !== undefined && v < min)) {
      setBad(true);
      return;
    }
    setBad(false);
    if (Math.abs(v - value) > 10 ** -(digits + 2) || !Number.isFinite(value)) onCommit(v);
    else setTxt(fmt(value));
  };
  return (
    <input
      className={`${className ?? ""}${bad ? " bad" : ""}`}
      value={txt}
      disabled={disabled}
      title={title}
      spellCheck={false}
      onChange={(e) => {
        dirty.current = true;
        setTxt(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          dirty.current = false;
          setTxt(fmt(value));
          setBad(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function TextField({ value, onCommit, disabled }: { value: string; onCommit: (v: string) => void; disabled?: boolean }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  return (
    <input
      value={txt}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => txt !== value && onCommit(txt)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setTxt(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
