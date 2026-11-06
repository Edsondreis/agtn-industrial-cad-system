import { useCallback, useEffect, useState } from "react";
import { CAD_VERSIONS, type AppPrefs, type CadVersion } from "../app/prefs";
import { dirName } from "../app/recents";
import {
  type ConvertJob,
  baseName,
  chooseDefaultApp,
  convertCad,
  findConverter,
  isTauri,
  openOdaDownload,
  pickExecutable,
  pickFolder,
  pickPaths,
  revealInFolder,
} from "../platform/platform";
import { Modal } from "./Dialogs";
import { Icon } from "./Icons";
import { toast } from "./toast";

/** Estado do conversor DWG (ODA File Converter): undefined = verificando. */
export function useConverter(odaPath: string) {
  const [path, setPath] = useState<string | null | undefined>(undefined);
  const check = useCallback(() => {
    setPath(undefined);
    findConverter(odaPath)
      .then(setPath)
      .catch(() => setPath(null));
  }, [odaPath]);
  useEffect(check, [check]);
  return { path, check };
}

/** Faixa com o estado do conversor DWG e as ações de instalar/localizar. */
export function ConverterStatus({ prefs, onChange, compact }: { prefs: AppPrefs; onChange: (p: AppPrefs) => void; compact?: boolean }) {
  const { path, check } = useConverter(prefs.odaPath);
  if (!isTauri()) return <div className="warnbox">DWG disponível apenas no aplicativo desktop (Windows).</div>;
  if (path === undefined) return <div className="infobox">Procurando o ODA File Converter…</div>;
  const locate = async () => {
    const exe = await pickExecutable();
    if (!exe) return;
    const ok = await findConverter(exe);
    if (!ok) {
      toast("Esse arquivo não é o ODAFileConverter.exe.", "error");
      return;
    }
    onChange({ ...prefs, odaPath: exe });
    toast("Conversor DWG configurado.", "ok");
  };
  if (path)
    return (
      <div className="okbox" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b>Conversor DWG pronto</b> — ODA File Converter
          {!compact && (
            <div className="note mono" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={path}>
              {path}
            </div>
          )}
        </span>
        {!compact && (
          <>
            <button className="btn" onClick={() => void locate()}>
              Alterar…
            </button>
            {prefs.odaPath && (
              <button className="btn" title="Voltar à detecção automática" onClick={() => onChange({ ...prefs, odaPath: "" })}>
                Automático
              </button>
            )}
          </>
        )}
      </div>
    );
  return (
    <div className="errbox">
      <b>ODA File Converter não encontrado.</b>
      <div className="note" style={{ margin: "4px 0 8px" }}>
        O DWG é um formato fechado da Autodesk. O AGTN Industrial CAD lê e grava DWG pelo <b>ODA File Converter</b>, programa gratuito da
        Open Design Alliance (o mesmo motor de BricsCAD e DraftSight). Instale uma vez — o AGTN CAD encontra sozinho.
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn primary" onClick={() => void openOdaDownload().catch((e) => toast(String(e), "error"))}>
          Baixar ODA File Converter (grátis)
        </button>
        <button className="btn" onClick={() => void locate()}>
          Localizar ODAFileConverter.exe…
        </button>
        <button className="btn" onClick={check}>
          Verificar de novo
        </button>
      </div>
    </div>
  );
}

/** Botões "Abrir com" do Windows para tornar o AGTN CAD o padrão de cada extensão. */
export function DefaultAppButtons() {
  const go = (ext: "dxf" | "dwg" | "agtncad") =>
    chooseDefaultApp(ext)
      .then(() => toast(`Escolha "AGTN Industrial CAD" e marque "Sempre usar este aplicativo" para .${ext}.`, "ok"))
      .catch((e) => toast(String(e), "error"));
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button className="btn" disabled={!isTauri()} onClick={() => void go("dwg")}>
        Padrão para .dwg
      </button>
      <button className="btn" disabled={!isTauri()} onClick={() => void go("dxf")}>
        Padrão para .dxf
      </button>
      <button className="btn" disabled={!isTauri()} onClick={() => void go("agtncad")}>
        Padrão para .agtncad
      </button>
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

/** CONVERSOR DWG ↔ DXF — vários arquivos de uma vez, pelo ODA File Converter. */
export function ConvertDialog({
  prefs,
  onPrefs,
  onClose,
  onOpen,
}: {
  prefs: AppPrefs;
  onPrefs: (p: AppPrefs) => void;
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const { path: conv } = useConverter(prefs.odaPath);
  const [rows, setRows] = useState<Row[]>([]);
  const [target, setTarget] = useState<Target>("auto");
  const [version, setVersion] = useState<CadVersion>(prefs.dwgVersion);
  const [folder, setFolder] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [running, setRunning] = useState(false);

  const add = async () => {
    const ps = await pickPaths("cad");
    if (!ps.length) return;
    setRows((r) => {
      const have = new Set(r.map((x) => x.input.toLowerCase()));
      return [...r, ...ps.filter((p) => !have.has(p.toLowerCase())).map((input) => ({ input, state: "pendente" as const }))];
    });
  };

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
          <span className="note">Os originais nunca são alterados. Conversão feita no seu computador, sem internet.</span>
          <button className="btn" disabled={running} onClick={onClose}>
            Fechar
          </button>
          <button className="btn primary" disabled={running || !conv || !pending} onClick={() => void run()}>
            {running ? "Convertendo…" : `Converter${pending ? ` (${pending})` : ""}`}
          </button>
        </>
      }
    >
      <ConverterStatus prefs={prefs} onChange={onPrefs} compact />
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
            <span>Pode selecionar vários de uma vez</span>
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
