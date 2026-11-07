import { useCallback, useEffect, useState } from "react";
import { CAD_VERSIONS, type CadVersion } from "../app/prefs";
import { dirName } from "../app/recents";
import {
  type ConvertJob,
  baseName,
  convertCad,
  isDefaultApp,
  isTauri,
  makeDefaultApp,
  isCadPath,
  pickFolder,
  pickPaths,
  setDropTarget,
  revealInFolder,
} from "../platform/platform";
import { Modal } from "./Dialogs";
import { Icon } from "./Icons";
import { toast } from "./toast";

/** Botões para tornar o AGTN Industrial CAD o programa padrão de .dwg e .dxf. */
export function DefaultAppButtons() {
  const [state, setState] = useState<Record<"dwg" | "dxf", boolean | null>>({ dwg: null, dxf: null });
  const refresh = useCallback(() => {
    void Promise.all((["dwg", "dxf"] as const).map(async (e) => [e, await isDefaultApp(e).catch(() => false)] as const)).then((r) =>
      setState(Object.fromEntries(r) as Record<"dwg" | "dxf", boolean>),
    );
  }, []);
  useEffect(refresh, [refresh]);
  const go = (ext: "dxf" | "dwg") =>
    makeDefaultApp(ext)
      .then((how) => {
        if (how === "direto") toast(`Arquivos .${ext} agora abrem no AGTN Industrial CAD.`, "ok");
        else toast(`O Windows pediu confirmação: escolha "AGTN Industrial CAD" e marque "Sempre usar este aplicativo".`, "warn");
        window.setTimeout(refresh, 600);
      })
      .catch((e) => toast(String(e), "error"));
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {(["dwg", "dxf"] as const).map((ext) =>
        state[ext] ? (
          <span key={ext} className="okbox" style={{ margin: 0, padding: "4px 10px" }}>
            ✓ .{ext} abre no AGTN CAD
          </span>
        ) : (
          <button key={ext} className="btn" disabled={!isTauri()} onClick={() => void go(ext)}>
            Tornar padrão para .{ext}
          </button>
        ),
      )}
    </div>
  );
}

type Target = "auto" | "DXF" | "DWG";
interface Row {
  input: string;
  state: "pendente" | "convertendo" | "ok" | "erro";
  output?: string;
  error?: string;
}

const extOf = (p: string) => (/\.dwg$/i.test(p) ? "DWG" : "DXF");
const sep = (p: string) => (p.includes("\\") ? "\\" : "/");

export function outputFor(input: string, target: Target, folder: string | null): { format: "DXF" | "DWG"; output: string } {
  const format: "DXF" | "DWG" = target === "auto" ? (extOf(input) === "DWG" ? "DXF" : "DWG") : target;
  const dir = folder ?? dirName(input);
  const stem = baseName(input).replace(/\.(dwg|dxf)$/i, "");
  let name = `${stem}.${format.toLowerCase()}`;
  // DXF→DXF / DWG→DWG (troca de versão) na mesma pasta: não sobrescreve o original
  if (extOf(input) === format && !folder) name = `${stem}_convertido.${format.toLowerCase()}`;
  return { format, output: `${dir}${sep(input)}${name}` };
}

/** CONVERSOR DWG ↔ DXF — vários arquivos de uma vez, motor próprio (sem programas externos). */
export function ConvertDialog({
  defaultVersion,
  onClose,
  onOpen,
  initialPaths = [],
}: {
  defaultVersion: CadVersion;
  onClose: () => void;
  onOpen: (path: string) => void;
  /** arquivos já soltos na janela */
  initialPaths?: string[];
}) {
  const [rows, setRows] = useState<Row[]>(() => [...new Set(initialPaths.filter(isCadPath))].map((input) => ({ input, state: "pendente" as const })));
  const [target, setTarget] = useState<Target>("auto");
  const [version, setVersion] = useState<CadVersion>(defaultVersion);
  const [folder, setFolder] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);

  const addPaths = useCallback((ps: string[]) => {
    const cad = ps.filter(isCadPath);
    if (cad.length < ps.length) toast(`${ps.length - cad.length} arquivo(s) ignorado(s): o conversor aceita só .dwg e .dxf.`, "warn");
    if (!cad.length) return;
    setRows((r) => {
      const have = new Set(r.map((x) => x.input.toLowerCase()));
      return [...r, ...cad.filter((p) => !have.has(p.toLowerCase())).map((input) => ({ input, state: "pendente" as const }))];
    });
  }, []);
  const add = async () => addPaths(await pickPaths("cad"));
  // enquanto o conversor está aberto, arquivos soltos na janela entram na lista
  useEffect(() => {
    setDropTarget(addPaths);
    return () => setDropTarget(null);
  }, [addPaths]);

  const run = async () => {
    const todo = rows.filter((r) => r.state !== "ok");
    if (!todo.length) return;
    setRunning(true);
    setRows((rs) => rs.map((r) => (r.state === "ok" ? r : { ...r, state: "convertendo", error: undefined })));
    const groups: Record<"DXF" | "DWG", ConvertJob[]> = { DXF: [], DWG: [] };
    for (const r of todo) {
      const o = outputFor(r.input, target, folder);
      groups[o.format].push({ input: r.input, output: o.output });
    }
    let ok = 0;
    let fail = 0;
    try {
      for (const f of ["DXF", "DWG"] as const) {
        if (!groups[f].length) continue;
        const res = await convertCad(groups[f], f, version, overwrite);
        ok += res.filter((x) => x.ok).length;
        fail += res.filter((x) => !x.ok).length;
        setRows((rs) =>
          rs.map((r) => {
            const hit = res.find((x) => x.input === r.input);
            return hit ? { ...r, state: hit.ok ? "ok" : "erro", output: hit.output, error: hit.error ?? undefined } : r;
          }),
        );
      }
      toast(fail ? `${ok} convertido(s), ${fail} com erro.` : `${ok} arquivo(s) convertido(s).`, fail ? "warn" : "ok");
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.state === "convertendo" ? { ...r, state: "erro", error: String(e instanceof Error ? e.message : e) } : r)));
      toast(String(e instanceof Error ? e.message : e), "error");
    } finally {
      setRunning(false);
    }
  };

  const pending = rows.filter((r) => r.state !== "ok").length;
  return (
    <Modal
      title="Converter DWG ↔ DXF"
      width={760}
      onClose={() => !running && onClose()}
      footer={
        <>
          <span className="note">Conversor próprio do AGTN CAD — no seu computador, sem internet. Os originais nunca são alterados.</span>
          <button className="btn" disabled={running} onClick={onClose}>
            Fechar
          </button>
          <button className="btn primary" disabled={running || !pending} onClick={() => void run()}>
            {running ? "Convertendo…" : `Converter${pending ? ` (${pending})` : ""}`}
          </button>
        </>
      }
    >
      {!isTauri() && <div className="warnbox">Conversão disponível no aplicativo desktop (Windows).</div>}
      <div className="conv-opts">
        <div className="sm-row" style={{ gridTemplateColumns: "110px 1fr" }}>
          <span className="k">Converter para</span>
          <div className="seg" style={{ justifySelf: "start" }}>
            {(
              [
                ["auto", "Inverter (DWG→DXF · DXF→DWG)"],
                ["DXF", "DXF"],
                ["DWG", "DWG"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={target === k ? "on" : ""} onClick={() => setTarget(k)} disabled={running}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="sm-row" style={{ gridTemplateColumns: "110px 1fr" }}>
          <span className="k">Versão</span>
          <select value={version} disabled={running} onChange={(e) => setVersion(e.target.value as CadVersion)}>
            {CAD_VERSIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm-row" style={{ gridTemplateColumns: "110px 1fr auto auto" }}>
          <span className="k">Salvar em</span>
          <span className="mono note" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={folder ?? ""}>
            {folder ?? "Mesma pasta de cada arquivo"}
          </span>
          <button className="btn" disabled={running} onClick={() => void pickFolder().then((f) => f && setFolder(f))}>
            Escolher pasta…
          </button>
          <button className="btn" disabled={running || !folder} onClick={() => setFolder(null)}>
            Mesma pasta
          </button>
        </div>
        <label className="chk">
          <input type="checkbox" checked={overwrite} disabled={running} onChange={(e) => setOverwrite(e.target.checked)} />
          Substituir arquivos de destino que já existem
        </label>
      </div>

      <div className="conv-list" role="list">
        {rows.length === 0 ? (
          <button className="conv-empty" onClick={() => void add()} disabled={!isTauri()}>
            <Icon name="convert" />
            <b>Adicionar arquivos DWG ou DXF</b>
            <span>Clique para escolher ou arraste os arquivos para cá — vários de uma vez</span>
          </button>
        ) : (
          rows.map((r) => {
            const o = outputFor(r.input, target, folder);
            return (
              <div key={r.input} role="listitem" className={`conv-row ${r.state}`}>
                <span className={`ty ${extOf(r.input).toLowerCase()}`}>{extOf(r.input)}</span>
                <span className="nm">
                  <b title={r.input}>{baseName(r.input)}</b>
                  <span title={r.error ?? r.output ?? o.output}>
                    {r.state === "erro"
                      ? r.error
                      : r.state === "ok"
                        ? `✓ ${baseName(r.output!)}`
                        : r.state === "convertendo"
                          ? "convertendo…"
                          : `→ ${baseName(o.output)}`}
                  </span>
                </span>
                <span className="acts">
                  {r.state === "ok" && r.output && (
                    <>
                      {/\.(dxf|dwg)$/i.test(r.output) && (
                        <button className="btn" onClick={() => onOpen(r.output!)}>
                          Abrir
                        </button>
                      )}
                      <button className="ibtn" title="Abrir local do arquivo" onClick={() => revealInFolder(r.output!).catch((e) => toast(String(e), "error"))}>
                        <Icon name="folder" />
                      </button>
                    </>
                  )}
                  <button
                    className="ibtn"
                    title="Remover da lista"
                    disabled={running}
                    onClick={() => setRows((rs) => rs.filter((x) => x.input !== r.input))}
                  >
                    <Icon name="close" />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button className="btn" disabled={running} onClick={() => void add()}>
            Adicionar arquivos…
          </button>
          <button className="btn" disabled={running} onClick={() => setRows([])}>
            Limpar lista
          </button>
        </div>
      )}
    </Modal>
  );
}
