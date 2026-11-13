import type { Layer } from "@agtn/document";
import type { DxfImportReport } from "@agtn/dxf";
import { type EntityType, ENTITY_TYPE_LABEL } from "@agtn/geometry";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { COMMANDS } from "../cad/commands";
import type { CadController } from "../cad/controller";
import { APP_VERSION } from "../app/files";
import type { AppPrefs } from "../app/prefs";
import { NumField } from "./fields";
import { Icon } from "./Icons";

export function Modal({ title, onClose, children, footer, width }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Esc fecha a janela mesmo sem foco dentro dela (comportamento padrão de diálogos do Windows)
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={width ? { width } : undefined}>
        <div className="modal-h">
          {title}
          <div className="spacer" />
          <button className="ibtn" onClick={onClose} title="Fechar">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Sobre" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>OK</button>}>
      <div className="about">
        <img src="/brand/agtn-logo-dark.svg" alt="AGTN Indústria Metalúrgica" style={{ width: 260, display: "block", margin: "0 auto 14px" }} />
        <div className="t1">
          AGTN <span>INDUSTRIAL CAD</span>
        </div>
        <div className="t2">Software de engenharia industrial</div>
        <div className="t3">Desenvolvido pela AGTN.</div>
        <div className="note" style={{ marginTop: 14 }}>
          Versão {APP_VERSION} · CAD 2D · Planificação e calandra · Biblioteca de chapas · Texto laser · DXF · DWG
        </div>
        <div className="note">Estruturas metálicas · Fabricação industrial · Corte a laser · Dobra CNC</div>
        <details className="note" style={{ marginTop: 14, textAlign: "left" }}>
          <summary style={{ cursor: "pointer", textAlign: "center" }}>Componentes de terceiros</summary>
          <p style={{ marginTop: 8 }}>
            Conversor DWG ↔ DXF: <b>acadrust</b> 0.6.8 — Mozilla Public License 2.0 (código-fonte em github.com/hakanaktt/acadrust),
            usado sem modificação. Inclui código adaptado do <b>ACadSharp</b> — MIT License, Copyright (c) 2021 Albert Domenech:
            Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
            files, to deal in the Software without restriction, subject to the inclusion of the copyright notice and this permission
            notice. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
          </p>
        </details>
      </div>
    </Modal>
  );
}

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const extra: [string, string][] = [
    ["Ctrl+Z / Ctrl+Y", "Desfazer / Refazer"],
    ["Ctrl+S / Ctrl+O / Ctrl+N", "Salvar / Abrir / Novo"],
    ["Ctrl+A", "Selecionar tudo"],
    ["Ctrl+P / PLOT / PDF", "Imprimir ou salvar PDF"],
    ["Arrastar arquivo para a janela", "Abrir (vários arquivos: conversor DWG ↔ DXF)"],
    ["Delete", "Apagar seleção"],
    ["Esc", "Cancelar comando / limpar seleção"],
    ["Enter / Espaço / Botão direito", "Confirmar / repetir último comando"],
    ["F3 / F7 / F8 / F9 / F10", "OSNAP / Grade / Ortho / Snap / Polar"],
    ["Shift (segurado)", "Ignora snap a objetos temporariamente"],
    ["Roda do mouse", "Zoom no cursor"],
    ["Botão do meio (arrastar)", "Pan"],
    ["Duplo clique do meio", "Zoom extensão"],
    ["x,y", "Coordenada absoluta"],
    ["@dx,dy", "Coordenada relativa"],
    ["@dist<ângulo", "Coordenada polar relativa"],
    ["número", "Distância direta na direção do cursor"],
    ["T", "Texto para laser (vira geometria de corte)"],
    ["SM / PLANIFICACAO", "Planificação de chapas e calandra"],
    ["PECAS", "Biblioteca de chapas pré-definidas"],
    ["LA", "Camadas"],
  ];
  return (
    <Modal title="Comandos e atalhos" onClose={onClose} width={760} footer={<button className="btn primary" onClick={onClose}>Fechar</button>}>
      <div className="shortcuts">
        {COMMANDS.map((c) => (
          <div key={c.id}>
            <span className="k">{c.aliases[0]}</span>
            <span>
              {c.label} <span className="note">— {c.hint}</span>
            </span>
          </div>
        ))}
        {extra.map(([k, v]) => (
          <div key={k}>
            <span className="k">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <p className="note">Separador decimal na linha de comando: ponto (a vírgula separa X,Y). Nos painéis, vírgula ou ponto.</p>
    </Modal>
  );
}

export function DxfReportDialog({ report, onClose }: { report: DxfImportReport; onClose: () => void }) {
  const unsup = Object.entries(report.unsupported);
  return (
    <Modal title="Relatório de importação DXF" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>OK</button>}>
      <div className="kv">
        <span className="k">Versão</span>
        <span className="mono">{report.version}</span>
        <span className="k">Codificação</span>
        <span className="mono">{report.encoding}</span>
        <span className="k">Unidade</span>
        <span>
          {report.unitSource === "INSUNITS" ? `Declarada no arquivo (fator ${report.unitFactor} → mm)` : "Não declarada — interpretado como milímetros"}
        </span>
      </div>
      <h4>Importado</h4>
      <div className="kv">
        {Object.entries(report.counts).map(([k, n]) => (
          <span key={k} style={{ display: "contents" }}>
            <span className="k">{k}</span>
            <span className="mono">{n}</span>
          </span>
        ))}
      </div>
      {unsup.length ? (
        <div className="warnbox">
          <b>Não suportado (não importado):</b>
          <div className="kv" style={{ marginTop: 4 }}>
            {unsup.map(([k, n]) => (
              <span key={k} style={{ display: "contents" }}>
                <span className="k">{k}</span>
                <span className="mono">{n}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="okbox">Todas as entidades do arquivo foram interpretadas.</div>
      )}
      {report.warnings.map((w) => (
        <div key={w} className="warnbox">
          {w}
        </div>
      ))}
    </Modal>
  );
}

export function SelectByTypeDialog({ ctl, onClose }: { ctl: CadController; onClose: () => void }) {
  const types = Object.keys(ENTITY_TYPE_LABEL) as EntityType[];
  const counts = new Map<EntityType, number>();
  for (const e of ctl.doc.all()) if (ctl.doc.isEditable(e)) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const [on, setOn] = useState<Set<EntityType>>(new Set());
  return (
    <Modal
      title="Selecionar por tipo"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn primary"
            disabled={!on.size}
            onClick={() => {
              ctl.sel.selectByType([...on]);
              ctl.message(`${ctl.sel.size} objeto(s) selecionado(s).`);
              onClose();
            }}
          >
            Selecionar
          </button>
        </>
      }
    >
      {types.map((t) => (
        <label key={t} className="chk">
          <input
            type="checkbox"
            checked={on.has(t)}
            disabled={!counts.get(t)}
            onChange={(e) => {
              const s = new Set(on);
              if (e.target.checked) s.add(t);
              else s.delete(t);
              setOn(s);
            }}
          />
          {ENTITY_TYPE_LABEL[t]} <span className="note">({counts.get(t) ?? 0})</span>
        </label>
      ))}
    </Modal>
  );
}

export function DrawingSettingsDialog({ ctl, onClose }: { ctl: CadController; onClose: () => void }) {
  const s = ctl.doc.settings;
  const u = ctl.unitToMM;
  const set = (patch: Partial<typeof s>, label = "Configurações do desenho") => ctl.commit(label, [ctl.doc.settingsChange(patch)]);
  const ds = s.dimStyle;
  const setDim = (p: Partial<typeof ds>) => set({ dimStyle: { ...ds, ...p } }, "Estilo de cota");
  return (
    <Modal title="Configurações do desenho" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Fechar</button>}>
      <div className="props" style={{ gridTemplateColumns: "190px 140px" }}>
        <div className="sec">Grade e snap ({s.units})</div>
        <div className="k">Espaçamento da grade</div>
        <NumField value={s.gridSpacing / u} min={1e-6} onCommit={(v) => set({ gridSpacing: v * u })} />
        <div className="k">Passo do snap (F9)</div>
        <NumField value={s.snapSpacing / u} min={1e-6} onCommit={(v) => set({ snapSpacing: v * u })} />
        <div className="k">Escala de tipos de linha</div>
        <NumField value={s.ltScale} min={1e-6} onCommit={(v) => set({ ltScale: v })} />
        <div className="k">Altura padrão de texto</div>
        <NumField value={s.textHeight / u} min={1e-6} onCommit={(v) => set({ textHeight: v * u })} />
        <div className="sec">Cotas</div>
        <div className="k">Altura do texto</div>
        <NumField value={ds.textHeight / u} min={1e-6} onCommit={(v) => setDim({ textHeight: v * u })} />
        <div className="k">Casas decimais</div>
        <NumField value={ds.precision} digits={0} min={0} onCommit={(v) => setDim({ precision: Math.min(8, Math.round(v)) })} />
        <div className="k">Tamanho da seta</div>
        <NumField value={ds.arrowSize / u} min={0} onCommit={(v) => setDim({ arrowSize: v * u })} />
        <div className="k">Tipo de seta</div>
        <select value={ds.arrowType} onChange={(e) => setDim({ arrowType: e.target.value as typeof ds.arrowType })}>
          <option value="closed">Fechada preenchida</option>
          <option value="open">Aberta</option>
          <option value="tick">Traço oblíquo</option>
        </select>
        <div className="k">Afastamento da linha auxiliar</div>
        <NumField value={ds.extOffset / u} min={0} onCommit={(v) => setDim({ extOffset: v * u })} />
        <div className="k">Prolongamento da auxiliar</div>
        <NumField value={ds.extBeyond / u} min={0} onCommit={(v) => setDim({ extBeyond: v * u })} />
        <div className="k">Afastamento do texto</div>
        <NumField value={ds.textGap / u} min={0} onCommit={(v) => setDim({ textGap: v * u })} />
        <div className="k">Separador decimal</div>
        <select value={ds.decimalSeparator} onChange={(e) => setDim({ decimalSeparator: e.target.value as "," | "." })}>
          <option value=",">Vírgula (12,50)</option>
          <option value=".">Ponto (12.50)</option>
        </select>
        <div className="k">Sufixo</div>
        <input defaultValue={ds.suffix} onBlur={(e) => setDim({ suffix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
      </div>
    </Modal>
  );
}

export function ExportDxfDialog({
  layers,
  onExport,
  onClose,
  initialFormat = "dxf",
  dwgVersion,
  dxfVersion = "R12",
}: {
  layers: readonly Layer[];
  onExport: (layers: string[], format: "dxf" | "dwg", dxfVersion: "R12" | "R2000") => void;
  onClose: () => void;
  initialFormat?: "dxf" | "dwg";
  dwgVersion: string;
  dxfVersion?: "R12" | "R2000";
}) {
  const [on, setOn] = useState<Set<string>>(new Set(layers.map((l) => l.name)));
  const [kind, setKind] = useState<"R12" | "R2000" | "dwg">(initialFormat === "dwg" ? "dwg" : dxfVersion);
  const format = kind === "dwg" ? "dwg" : "dxf";
  return (
    <Modal
      title={format === "dwg" ? "Exportar DWG" : "Exportar DXF"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!on.size} onClick={() => onExport([...on], format, kind === "R2000" ? "R2000" : "R12")}>
            Exportar
          </button>
        </>
      }
    >
      <div className="sm-row" style={{ gridTemplateColumns: "80px 1fr" }}>
        <span className="k">Formato</span>
        <div className="seg" style={{ justifySelf: "start" }}>
          <button className={kind === "R12" ? "on" : ""} onClick={() => setKind("R12")}>
            DXF R12
          </button>
          <button className={kind === "R2000" ? "on" : ""} onClick={() => setKind("R2000")}>
            DXF 2000
          </button>
          <button className={kind === "dwg" ? "on" : ""} onClick={() => setKind("dwg")}>
            DWG
          </button>
        </div>
      </div>
      <p className="note">
        {kind === "dwg"
          ? `DWG ${dwgVersion.replace("ACAD", "")} gravado pelo conversor do AGTN CAD (versão em Preferências), coordenadas em milímetros; elipse, spline e hachura nativas; cotas como geometria.`
          : kind === "R2000"
            ? "DXF 2000 (AC1015): guarda elipse, spline, hachura, texto de várias linhas, unidade (mm) e espessura de linha. Cotas como geometria."
            : "DXF R12 (AC1009): o mais aceito por máquinas e CAM de corte. Elipse/spline viram polilinhas, hachura vira linhas; não guarda unidade nem espessura de linha."}
      </p>
      <h4>Camadas</h4>
      {layers.map((l) => (
        <label key={l.name} className="chk">
          <input
            type="checkbox"
            checked={on.has(l.name)}
            onChange={(e) => {
              const s = new Set(on);
              if (e.target.checked) s.add(l.name);
              else s.delete(l.name);
              setOn(s);
            }}
          />
          <span className="mono">{l.name}</span>
          {!l.visible && <span className="note">(oculta)</span>}
        </label>
      ))}
    </Modal>
  );
}

export function RecoveryDialog({ when, name, onRestore, onDiscard }: { when: string; name: string; onRestore: () => void; onDiscard: () => void }) {
  return (
    <Modal
      title="Recuperação de desenho"
      onClose={onDiscard}
      footer={
        <>
          <button className="btn" onClick={onDiscard}>
            Descartar
          </button>
          <button className="btn primary" onClick={onRestore}>
            Recuperar
          </button>
        </>
      }
    >
      <p>
        Foi encontrado um desenho com alterações não salvas: <b>{name}</b>
      </p>
      <p className="note">Gravado automaticamente em {new Date(when).toLocaleString("pt-BR")}.</p>
    </Modal>
  );
}

export function PrefsDialog({
  prefs,
  onChange,
  onClose,
  recentCount,
  onClearRecents,
  dwgSection,
}: {
  prefs: AppPrefs;
  onChange: (p: AppPrefs) => void;
  onClose: () => void;
  recentCount: number;
  onClearRecents: () => void;
  dwgSection?: ReactNode;
}) {
  return (
    <Modal title="Preferências" width={620} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Fechar</button>}>
      <label className="chk">
        <input type="checkbox" checked={prefs.showStartCenter} onChange={(e) => onChange({ ...prefs, showStartCenter: e.target.checked })} />
        Mostrar o Start Center ao iniciar
      </label>
      <div className="sm-row" style={{ marginTop: 10, gridTemplateColumns: "1fr 180px" }}>
        <span className="k">Unidade de novos projetos</span>
        <select value={prefs.defaultUnits} onChange={(e) => onChange({ ...prefs, defaultUnits: e.target.value as AppPrefs["defaultUnits"] })}>
          <option value="mm">Milímetros (mm)</option>
          <option value="cm">Centímetros (cm)</option>
          <option value="m">Metros (m)</option>
        </select>
      </div>
      <div className="sm-row" style={{ gridTemplateColumns: "1fr 180px" }}>
        <span className="k">Arquivos recentes ({recentCount})</span>
        <button className="btn" disabled={!recentCount} onClick={onClearRecents}>
          Limpar lista
        </button>
      </div>
      {dwgSection}
      <div className="sm-row" style={{ gridTemplateColumns: "1fr 180px" }} title="Folga g dos alívios de dobra automáticos: largura w = T + g, profundidade d = SB + g. Parâmetro inicial da AGTN, editável em cada alívio — não é norma de fabricação.">
        <span className="k">Chapa 3D · folga do alívio (mm)</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={prefs.reliefGap}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0) onChange({ ...prefs, reliefGap: v });
          }}
          data-pref="reliefGap"
        />
      </div>
      <div className="sm-row" style={{ gridTemplateColumns: "1fr 180px" }}>
        <span className="k">Chapa 3D · DXF da planificação</span>
        <select value={prefs.sheetDxfVersion} onChange={(e) => onChange({ ...prefs, sheetDxfVersion: e.target.value as AppPrefs["sheetDxfVersion"] })} data-pref="sheetDxfVersion">
          <option value="R2000">R2000 (unidade mm gravada) — padrão</option>
          <option value="R12">R12 (compatibilidade máxima com CAM)</option>
        </select>
      </div>
      <p className="note">As preferências ficam salvas neste computador. Configurações do desenho (grade, cotas) ficam em Ferramentas → Configurações do desenho.</p>
    </Modal>
  );
}
