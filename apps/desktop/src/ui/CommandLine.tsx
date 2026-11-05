import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CadController } from "../cad/controller";
import { useCtl } from "./hooks";

export interface CommandLineHandle {
  focus(): void;
}

/** Linha de comando inferior no estilo CAD tradicional. */
export const CommandLine = forwardRef<CommandLineHandle, { ctl: CadController; showHistory: boolean }>(function CommandLine(
  { ctl, showHistory },
  ref,
) {
  useCtl(ctl, "state");
  useCtl(ctl, "log");
  const [text, setText] = useState("");
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus({ preventScroll: true }) }), []);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [ctl.log.length]);

  const submit = () => {
    const t = text;
    setText("");
    setHi(-1);
    if (t.trim()) setHist((h) => [...h.slice(-49), t]);
    ctl.submit(t);
  };

  return (
    <div className="cmdline">
      {showHistory && (
        <div className="cmd-hist" ref={box}>
          {ctl.log.slice(-60).map((l, i) => (
            <div key={i} className={l.level}>
              {l.level === "cmd" ? "› " : ""}
              {l.text}
            </div>
          ))}
        </div>
      )}
      <div className="cmd-in" onMouseDown={() => input.current?.focus()}>
        <span className="pr">{ctl.prompt}</span>
        <input
          ref={input}
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-label="Linha de comando"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            const raw = ctl.tool?.wantsRawText();
            if (e.key === "Enter" || (e.key === " " && !raw)) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setText("");
              ctl.cancel();
            } else if (e.key === "ArrowUp" && hist.length) {
              e.preventDefault();
              const n = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1);
              setHi(n);
              setText(hist[n]);
            } else if (e.key === "ArrowDown" && hi >= 0) {
              e.preventDefault();
              const n = hi + 1;
              if (n >= hist.length) {
                setHi(-1);
                setText("");
              } else {
                setHi(n);
                setText(hist[n]);
              }
            } else if (e.key === "Delete" && !text && ctl.sel.size && !ctl.tool) {
              e.preventDefault();
              ctl.eraseSelection();
            }
          }}
        />
      </div>
    </div>
  );
});
