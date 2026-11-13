import { dependentsOf } from "@agtn/model3d";
import { type Feature, type FeatureStatus, FEATURE_LABEL } from "@agtn/solid";
import { STATUS_LABEL, solve } from "@agtn/sketch";
import { TextField } from "../../ui/fields";
import { Icon } from "../../ui/Icons";
import type { FeatAction } from "../Tree3D";
import { featureIcon, featureSummary } from "./partUi";

/** Propriedades da operação selecionada na árvore da peça. */
export function FeatureProps({
  features,
  feature,
  status,
  index,
  rollback,
  onRename,
  onAct,
  onDelete,
}: {
  features: readonly Feature[];
  feature: Feature;
  status: FeatureStatus | undefined;
  index: number;
  rollback: number | null;
  onRename: (name: string) => void;
  onAct: (a: FeatAction) => void;
  onDelete: (cascade: boolean) => void;
}) {
  const deps = dependentsOf(features, feature.id).map((id) => features.find((f) => f.id === id)!);
  const state = feature.suppressed
    ? "Suprimida"
    : rollback !== null && index >= rollback
      ? "Recuada (não avaliada)"
      : status?.state === "error"
        ? "Com erro"
        : status?.state === "dependency_error"
          ? "Não avaliada (dependência com erro)"
          : status?.state === "suppressed"
            ? "Suprimida (junto com a operação de origem)"
            : status
              ? "OK"
              : "Aguardando regeneração";
  const sk = feature.t === "sketch" ? solve(feature.sketch, { skipConflictSearch: true }) : null;
  return (
    <div className="p3">
      <section>
        <h4>
          <span className="fp-ico">
            <Icon name={featureIcon(feature)} />
          </span>{" "}
          {FEATURE_LABEL[feature.t]} <small>· operação {index + 1} de {features.length}</small>
        </h4>
        <div className="p3-row edit">
          <span className="k">Nome</span>
          <span className="v">
            <TextField value={feature.name} onCommit={onRename} />
          </span>
        </div>
        <div className="p3-row">
          <span className="k">Parâmetros</span>
          <span className="v">{featureSummary(feature)}</span>
        </div>
        <div className="p3-row">
          <span className="k">Estado</span>
          <span className={`v fp-state ${status?.state ?? ""}`}>{state}</span>
        </div>
        {status?.state === "ok" && (
          <div className="p3-row">
            <span className="k">Regeneração</span>
            <span className="v">
              {Math.round(status.ms)}
              <i>ms</i>
            </span>
          </div>
        )}
        {sk && (
          <div className="p3-row">
            <span className="k">Definição</span>
            <span className={`v sk-def ${sk.status}`}>
              {STATUS_LABEL[sk.status]}
              {sk.status === "under" ? ` · ${sk.dof} GL` : ""}
            </span>
          </div>
        )}
        {status?.error && <div className={`fp-err${status.state === "dependency_error" ? " dep" : status.state === "suppressed" ? " info" : ""}`}>{status.error}</div>}
        {status?.warning && <div className="fp-err warn">{status.warning}</div>}
      </section>
      <section className="fp-acts">
        <button className="btn primary" onClick={() => onAct("edit")}>
          <Icon name="edit3d" /> Editar
        </button>
        <button className="btn" onClick={() => onAct("suppress")}>
          <Icon name="suppress" /> {feature.suppressed ? "Reativar" : "Suprimir"}
        </button>
        <button className="btn" onClick={() => onAct("rollback")}>
          <Icon name="rollback" /> Recuar aqui
        </button>
        <button className="btn" onClick={() => onDelete(false)} disabled={deps.length > 0} title={deps.length ? `Usada por: ${deps.map((d) => d.name).join(", ")}` : "Excluir (Delete)"}>
          <Icon name="trash" /> Excluir
        </button>
        {deps.length > 0 && (
          <button className="btn danger" onClick={() => onDelete(true)}>
            Excluir com {deps.length} dependente(s)
          </button>
        )}
      </section>
      {deps.length > 0 && (
        <section>
          <h4>Usada por</h4>
          {deps.map((d) => (
            <div key={d.id} className="fp-dep">
              <Icon name={featureIcon(d)} /> {d.name}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
