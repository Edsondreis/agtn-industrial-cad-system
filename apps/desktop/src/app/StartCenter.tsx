import { useEffect, useState, useSyncExternalStore } from "react";
import type { CadController } from "../cad/controller";
import { fileExists, isTauri, revealInFolder } from "../platform/platform";
import { Icon } from "../ui/Icons";
import { toast } from "../ui/toast";
import type { Workspace } from "../ui/Chrome";
import { APP_VERSION, type FileActions } from "./files";
import { type RecentItem, dirName, recents } from "./recents";

export type StartTarget = Workspace | "lasertext";

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today.getTime() - 86400000).toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `hoje, ${hm}`;
  if (yest) return `ontem, ${hm}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) + ` ${hm}`;
};

/** AGTN INDUSTRIAL CAD — START CENTER: tela inicial com novo projeto, abrir arquivo e recentes. */
export function StartCenter({
  ctl,
  files,
  leaving,
  onEnter,
  onPrefs,
  onAbout,
  onConvert,
  recovery,
  onRestore,
  onDiscardRecovery,
}: {
  ctl: CadController;
  files: FileActions;
  leaving: boolean;
  onEnter: (target: StartTarget) => void;
  onPrefs: () => void;
  onAbout: () => void;
  onConvert: () => void;
  recovery: { when: string; name: string } | null;
  onRestore: () => void;
  onDiscardRecovery: () => void;
}) {
  const list = useSyncExternalStore(
    (cb) => recents.subscribe(cb),
    () => recents.list(),
  );
  const [missing, setMissing] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!isTauri() || !list.length) return;
    let alive = true;
    Promise.all(list.map(async (r) => [r.path, await fileExists(r.path).catch(() => true)] as const)).then((res) => {
      if (alive) setMissing(new Set(res.filter(([, ok]) => !ok).map(([p]) => p)));
    });
    return () => {
      alive = false;
    };
  }, [list]);

  const doc = ctl.doc;
  const hasCurrent = doc.size > 0 || doc.dirty || files.file.path !== null;

  const startNew = async (target: StartTarget) => {
    if (await files.newDrawing()) onEnter(target);
  };
  const openFile = async () => {
    if (await files.open()) onEnter("desenho");
  };
  const openRecent = async (r: RecentItem) => {
    if (!isTauri()) {
      toast("Reabrir pelo caminho está disponível no aplicativo desktop.", "warn");
      return;
    }
    if (missing.has(r.path)) {
      toast(`Arquivo não encontrado: ${r.path}`, "error");
      return;
    }
    if (await files.openPath(r.path, true)) onEnter("desenho");
  };

  return (
    <div className={`start${leaving ? " leaving" : " fade-in"}`} role="dialog" aria-label="Start Center">
      <header className="start-h">
        <img src="/brand/agtn-logo-dark.svg" alt="AGTN Indústria Metalúrgica" />
        <div className="name">
          <b>AGTN INDUSTRIAL CAD</b>
          <span>Start Center</span>
        </div>
        <span className="ver" title="Versão instalada">
          v{APP_VERSION}
        </span>
      </header>

      <div className="start-b">
        <section className="start-col">
          {recovery && (
            <div className="infobox" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 6 }}>
                Desenho com alterações não salvas encontrado: <b>{recovery.name}</b>
                <div className="note">Gravado automaticamente em {new Date(recovery.when).toLocaleString("pt-BR")}.</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn primary" onClick={onRestore}>
                  Recuperar
                </button>
                <button className="btn" onClick={onDiscardRecovery}>
                  Descartar
                </button>
              </div>
            </div>
          )}
          {hasCurrent && (
            <button className="continue" onClick={() => onEnter("desenho")} title="Voltar ao desenho aberto">
              <Icon name="arrowR" />
              <span>
                Continuar <b>{files.file.name}</b>
                {doc.dirty && <span className="unsaved" style={{ marginLeft: 8 }}>não salvo</span>}
              </span>
            </button>
          )}
          <h3>Começar</h3>
          <button className="action primary" onClick={() => void startNew("desenho")}>
            <span className="ai">
              <Icon name="new" />
            </span>
            <span>
              <b>NOVO PROJETO</b>
              <span>Desenho 2D em branco, em milímetros</span>
            </span>
            <span className="kbd">Ctrl+N</span>
          </button>
          <div className="templates">
            <button onClick={() => void startNew("planificacao")} title="Novo projeto já na planificação de perfis e calandra">
              <Icon name="sheet" />
              Planificação de chapa
            </button>
            <button onClick={() => void startNew("pecas")} title="Novo projeto com a biblioteca de chapas aberta">
              <Icon name="parts" />
              Peça da biblioteca
            </button>
            <button onClick={() => void startNew("lasertext")} title="Novo projeto com o texto para laser aberto">
              <Icon name="text" />
              Texto para laser
            </button>
            <button onClick={() => void startNew("desenho")} title="Desenho 2D em branco">
              <Icon name="rect" />
              Desenho 2D
            </button>
          </div>
          <button className="action" onClick={() => void openFile()}>
            <span className="ai">
              <Icon name="open" />
            </span>
            <span>
              <b>ABRIR ARQUIVO</b>
              <span>Projeto AGTN (.agtncad), DWG ou DXF</span>
            </span>
            <span className="kbd">Ctrl+O</span>
          </button>
          <button className="action" onClick={onConvert}>
            <span className="ai">
              <Icon name="convert" />
            </span>
            <span>
              <b>CONVERTER DWG ↔ DXF</b>
              <span>Vários arquivos de uma vez, qualquer versão (R12 a 2018+)</span>
            </span>
          </button>
        </section>

        <section className="start-col" style={{ minWidth: 0 }}>
          <h3 style={{ display: "flex", alignItems: "center" }}>
            Recentes
            {list.length > 0 && (
              <button className="linkbtn" style={{ marginLeft: "auto", fontSize: 11, letterSpacing: 0, textTransform: "none" }} onClick={() => recents.clear()}>
                Limpar lista
              </button>
            )}
          </h3>
          {list.length === 0 ? (
            <div className="recent-empty">
              <Icon name="open" />
              <b>Nenhum projeto recente</b>
              <div>Os arquivos que você abrir ou salvar aparecem aqui.</div>
              <div style={{ marginTop: 14 }}>
                <button className="btn primary" onClick={() => void startNew("desenho")}>
                  Criar o primeiro projeto
                </button>
              </div>
            </div>
          ) : (
            <div className="recent-list" role="list">
              {list.map((r) => {
                const gone = missing.has(r.path);
                return (
                  <div
                    key={r.path}
                    role="listitem"
                    tabIndex={0}
                    className={`recent${gone ? " missing" : ""}`}
                    title={gone ? `Não encontrado: ${r.path}` : r.path}
                    onClick={() => void openRecent(r)}
                    onKeyDown={(e) => e.key === "Enter" && void openRecent(r)}
                  >
                    <span className={`ty ${r.kind === "agtncad" ? "agtn" : r.kind}`}>{r.kind === "agtncad" ? "AGTN" : r.kind.toUpperCase()}</span>
                    <span className="nm">
                      <b>{r.name}</b>
                      <span>
                        {gone ? "arquivo não encontrado — " : ""}
                        {dirName(r.path)}
                      </span>
                    </span>
                    <span className="dt">{fmtDate(r.lastOpened)}</span>
                    <span className="acts" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="ibtn"
                        title="Abrir local do arquivo"
                        disabled={gone || !isTauri()}
                        onClick={() => revealInFolder(r.path).catch((e) => toast(String(e), "error"))}
                      >
                        <Icon name="folder" />
                      </button>
                      <button className="ibtn" title="Remover da lista (não apaga o arquivo)" onClick={() => recents.remove(r.path)}>
                        <Icon name="close" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <footer className="start-f">
        <span>AGTN Industrial CAD v{APP_VERSION}</span>
        <span>·</span>
        <span>Desenvolvido pela AGTN — Indústria Metalúrgica</span>
        <span className="spacer" />
        <button className="linkbtn" onClick={onPrefs}>
          Preferências
        </button>
        <button className="linkbtn" onClick={onAbout}>
          Sobre
        </button>
      </footer>
    </div>
  );
}
