import { LINETYPES, LINEWEIGHTS_MM } from "@agtn/document";
import {
  type Entity,
  ENTITY_TYPE_LABEL,
  type Vec2,
  HATCH_PATTERNS,
  ccwSweep,
  deg2rad,
  dimensionValue,
  ellipseSweep,
  hatchArea,
  hatchLoopPolygon,
  hatchPatternByName,
  isFullEllipse,
  patternLines,
  entityLength,
  formatNumber,
  polylineSignedArea,
  rad2deg,
} from "@agtn/geometry";
import type { ReactElement } from "react";
import type { CadController } from "../cad/controller";
import { AciPicker } from "./AciPicker";
import { NumField, TextField } from "./fields";
import { useCtl } from "./hooks";

/** Painel de propriedades do(s) objeto(s) selecionado(s) com edição numérica direta. */
export function PropertiesPanel({ ctl }: { ctl: CadController }) {
  useCtl(ctl, "state");
  const ents = ctl.sel.entities();
  const u = ctl.unitToMM;
  const upd = (label: string, list: Entity[]) => ctl.commit(label, ctl.doc.updateChanges(list));
  const L = (mm: number) => mm / u;

  if (!ents.length)
    return (
      <div className="panel-b">
        <div className="props">
          <div className="k">Camada atual</div>
          <div className="ro">{ctl.doc.currentLayer}</div>
          <div className="k">Unidade</div>
          <div className="ro">{ctl.doc.settings.units}</div>
          <div className="k">Objetos</div>
          <div className="ro">{ctl.doc.size}</div>
        </div>
        <div className="empty">Nenhum objeto selecionado. Clique em um objeto ou arraste uma janela (→ janela, ← cruzamento).</div>
      </div>
    );

  const first = ents[0];
  const same = <K extends keyof Entity>(k: K) => (ents.every((e) => e[k] === first[k]) ? first[k] : undefined);
  const layerVal = same("layer");
  const colorVal = ents.every((e) => e.color === first.color) ? first.color : undefined;
  const ltVal = same("linetype");
  const lwVal = same("lineweight");
  const byType = new Map<string, number>();
  for (const e of ents) byType.set(ENTITY_TYPE_LABEL[e.type], (byType.get(ENTITY_TYPE_LABEL[e.type]) ?? 0) + 1);

  const ptRow = (label: string, p: Vec2, set: (p: Vec2) => Entity) => (
    <>
      <div className="k">{label}</div>
      <div className="xy">
        <NumField value={L(p.x)} onCommit={(v) => upd(`Editar ${label}`, [set({ x: v * u, y: p.y })])} />
        <NumField value={L(p.y)} onCommit={(v) => upd(`Editar ${label}`, [set({ x: p.x, y: v * u })])} />
      </div>
    </>
  );

  return (
    <div className="panel-b">
      <div className="props">
        <div className="k">Seleção</div>
        <div className="ro">{[...byType].map(([k, n]) => `${n} ${k}`).join(", ")}</div>
        <div className="sec">Geral</div>
        <div className="k">Camada</div>
        <select
          value={layerVal ?? ""}
          onChange={(e) => upd("Mover para camada", ents.map((x) => ({ ...x, layer: e.target.value })))}
        >
          {layerVal === undefined && <option value="">(várias)</option>}
          {ctl.doc.layers.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
        <div className="k">Cor</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AciPicker value={colorVal ?? null} allowByLayer onChange={(c) => upd("Alterar cor", ents.map((x) => ({ ...x, color: c })))} />
          <span className="note">{colorVal === undefined ? "(várias)" : colorVal == null ? "Por camada" : `ACI ${colorVal}`}</span>
        </div>
        <div className="k">Tipo de linha</div>
        <select value={ltVal === undefined ? "*" : (ltVal ?? "")} onChange={(e) => upd("Tipo de linha", ents.map((x) => ({ ...x, linetype: e.target.value || null })))}>
          {ltVal === undefined && <option value="*">(vários)</option>}
          <option value="">Por camada</option>
          {LINETYPES.map((l) => (
            <option key={l.name} value={l.name}>
              {l.description}
            </option>
          ))}
        </select>
        <div className="k">Espessura</div>
        <select
          value={lwVal === undefined ? "*" : lwVal == null ? "" : String(lwVal)}
          onChange={(e) => upd("Espessura de linha", ents.map((x) => ({ ...x, lineweight: e.target.value === "" ? null : Number(e.target.value) })))}
        >
          {lwVal === undefined && <option value="*">(várias)</option>}
          <option value="">Por camada</option>
          {LINEWEIGHTS_MM.map((w) => (
            <option key={w} value={w}>
              {formatNumber(w, 2, ",")} mm
            </option>
          ))}
        </select>
        {ents.length === 1 && <Geometry e={first} ctl={ctl} ptRow={ptRow} upd={upd} />}
        {ents.length > 1 && (
          <>
            <div className="sec">Medidas</div>
            <div className="k">Comprimento total</div>
            <div className="ro">{ctl.fmtLen(ents.reduce((s, e) => s + entityLength(e), 0))}</div>
          </>
        )}
      </div>
    </div>
  );
}

function Geometry({
  e,
  ctl,
  ptRow,
  upd,
}: {
  e: Entity;
  ctl: CadController;
  ptRow: (label: string, p: Vec2, set: (p: Vec2) => Entity) => ReactElement;
  upd: (label: string, list: Entity[]) => void;
}) {
  const u = ctl.unitToMM;
  const area = (a: number) => formatNumber(Math.abs(a) / (u * u), 4, ",") + ` ${ctl.doc.settings.units}²`;
  switch (e.type) {
    case "line": {
      const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      const ang = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x);
      return (
        <>
          <div className="sec">Geometria — Linha</div>
          {ptRow("Início X, Y", e.a, (p) => ({ ...e, a: p }))}
          {ptRow("Fim X, Y", e.b, (p) => ({ ...e, b: p }))}
          <div className="k">Comprimento</div>
          <NumField
            value={len / u}
            min={1e-9}
            onCommit={(v) => upd("Comprimento", [{ ...e, b: { x: e.a.x + Math.cos(ang) * v * u, y: e.a.y + Math.sin(ang) * v * u } }])}
          />
          <div className="k">Ângulo (°)</div>
          <NumField value={rad2deg(ang)} onCommit={(v) => upd("Ângulo", [{ ...e, b: { x: e.a.x + Math.cos(deg2rad(v)) * len, y: e.a.y + Math.sin(deg2rad(v)) * len } }])} />
          <div className="k">ΔX / ΔY</div>
          <div className="ro">
            {ctl.fmtLen(e.b.x - e.a.x)} / {ctl.fmtLen(e.b.y - e.a.y)}
          </div>
        </>
      );
    }
    case "circle":
      return (
        <>
          <div className="sec">Geometria — Círculo</div>
          {ptRow("Centro X, Y", e.c, (p) => ({ ...e, c: p }))}
          <div className="k">Raio</div>
          <NumField value={e.r / u} min={1e-9} onCommit={(v) => upd("Raio", [{ ...e, r: v * u }])} />
          <div className="k">Diâmetro</div>
          <NumField value={(2 * e.r) / u} min={1e-9} onCommit={(v) => upd("Diâmetro", [{ ...e, r: (v * u) / 2 }])} />
          <div className="k">Perímetro</div>
          <div className="ro">{ctl.fmtLen(entityLength(e))}</div>
          <div className="k">Área</div>
          <div className="ro">{area(Math.PI * e.r * e.r)}</div>
        </>
      );
    case "arc":
      return (
        <>
          <div className="sec">Geometria — Arco</div>
          {ptRow("Centro X, Y", e.c, (p) => ({ ...e, c: p }))}
          <div className="k">Raio</div>
          <NumField value={e.r / u} min={1e-9} onCommit={(v) => upd("Raio", [{ ...e, r: v * u }])} />
          <div className="k">Ângulo inicial</div>
          <NumField value={rad2deg(e.a0)} onCommit={(v) => upd("Ângulo inicial", [{ ...e, a0: deg2rad(v) }])} />
          <div className="k">Ângulo final</div>
          <NumField value={rad2deg(e.a1)} onCommit={(v) => upd("Ângulo final", [{ ...e, a1: deg2rad(v) }])} />
          <div className="k">Ângulo incluído</div>
          <div className="ro">{formatNumber(rad2deg(ccwSweep(e.a0, e.a1)), 4, ",")}°</div>
          <div className="k">Comprimento</div>
          <div className="ro">{ctl.fmtLen(entityLength(e))}</div>
        </>
      );
    case "polyline":
      return (
        <>
          <div className="sec">Geometria — Polilinha</div>
          <div className="k">Vértices</div>
          <div className="ro">{e.pts.length}</div>
          <div className="k">Fechada</div>
          <select value={e.closed ? "1" : "0"} onChange={(ev) => upd("Fechar polilinha", [{ ...e, closed: ev.target.value === "1" }])}>
            <option value="0">Não</option>
            <option value="1">Sim</option>
          </select>
          <div className="k">Comprimento</div>
          <div className="ro">{ctl.fmtLen(entityLength(e))}</div>
          {e.closed && (
            <>
              <div className="k">Área</div>
              <div className="ro">{area(polylineSignedArea(e.pts, e.bulges))}</div>
            </>
          )}
          {e.pts.slice(0, 40).map((p, i) =>
            ptRow(`Vértice ${i + 1}`, p, (q) => {
              const pts = e.pts.slice();
              pts[i] = q;
              return { ...e, pts };
            }),
          )}
          {e.pts.length > 40 && <div className="note" style={{ gridColumn: "1 / -1" }}>… {e.pts.length - 40} vértices adicionais</div>}
        </>
      );
    case "point":
      return (
        <>
          <div className="sec">Geometria — Ponto</div>
          {ptRow("Posição X, Y", e.p, (p) => ({ ...e, p }))}
        </>
      );
    case "text":
      return (
        <>
          <div className="sec">Texto</div>
          <div className="k">Conteúdo</div>
          <TextField value={e.value} onCommit={(v) => upd("Texto", [{ ...e, value: v }])} />
          {ptRow("Inserção X, Y", e.p, (p) => ({ ...e, p }))}
          <div className="k">Altura</div>
          <NumField value={e.h / u} min={1e-6} onCommit={(v) => upd("Altura do texto", [{ ...e, h: v * u }])} />
          <div className="k">Rotação (°)</div>
          <NumField value={rad2deg(e.rot)} onCommit={(v) => upd("Rotação do texto", [{ ...e, rot: deg2rad(v) }])} />
        </>
      );
    case "ellipse": {
      const a = Math.hypot(e.major.x, e.major.y);
      const rot = Math.atan2(e.major.y, e.major.x);
      const full = isFullEllipse(e);
      return (
        <>
          <div className="sec">Geometria — {full ? "Elipse" : "Arco elíptico"}</div>
          {ptRow("Centro X, Y", e.c, (p) => ({ ...e, c: p }))}
          <div className="k">Semieixo maior</div>
          <NumField
            value={a / u}
            min={1e-9}
            onCommit={(v) => {
              const na = v * u;
              const b = a * e.ratio;
              if (b > na) return;
              upd("Semieixo maior", [{ ...e, major: { x: Math.cos(rot) * na, y: Math.sin(rot) * na }, ratio: b / na }]);
            }}
          />
          <div className="k">Semieixo menor</div>
          <NumField value={(a * e.ratio) / u} min={1e-9} onCommit={(v) => v * u <= a && upd("Semieixo menor", [{ ...e, ratio: (v * u) / a }])} />
          <div className="k">Rotação (°)</div>
          <NumField value={rad2deg(rot)} onCommit={(v) => upd("Rotação da elipse", [{ ...e, major: { x: Math.cos(deg2rad(v)) * a, y: Math.sin(deg2rad(v)) * a } }])} />
          {!full && (
            <>
              <div className="k">Parâmetro inicial (°)</div>
              <div className="ro">{formatNumber(rad2deg(e.t0), 4, ",")}°</div>
              <div className="k">Varredura (°)</div>
              <div className="ro">{formatNumber(rad2deg(ellipseSweep(e)), 4, ",")}°</div>
            </>
          )}
          <div className="k">{full ? "Perímetro" : "Comprimento"}</div>
          <div className="ro">{ctl.fmtLen(entityLength(e))}</div>
          {full && (
            <>
              <div className="k">Área</div>
              <div className="ro">{area(Math.PI * a * a * e.ratio)}</div>
            </>
          )}
        </>
      );
    }
    case "spline":
      return (
        <>
          <div className="sec">Geometria — Spline</div>
          <div className="k">Grau</div>
          <div className="ro">{e.degree}</div>
          <div className="k">Pontos de controle</div>
          <div className="ro">{e.ctrl.length}</div>
          <div className="k">Racional (NURBS)</div>
          <div className="ro">{e.weights && e.weights.some((w) => Math.abs(w - 1) > 1e-12) ? "Sim" : "Não"}</div>
          <div className="k">Fechado</div>
          <div className="ro">{e.closed ? "Sim" : "Não"}</div>
          <div className="k">Comprimento</div>
          <div className="ro">{ctl.fmtLen(entityLength(e))}</div>
        </>
      );
    case "hatch": {
      const regen = (name: string, ang: number, sc: number) => {
        const def = hatchPatternByName(name);
        if (!def) return;
        upd("Hachura", [{ ...e, pattern: def.name, solid: def.name === "SOLID", patternAngle: ang, patternScale: sc, lines: patternLines(def, ang, sc) }]);
      };
      const known = !!hatchPatternByName(e.pattern);
      return (
        <>
          <div className="sec">Hachura</div>
          <div className="k">Padrão</div>
          <select value={known ? e.pattern.toUpperCase() : ""} onChange={(ev) => regen(ev.target.value, e.patternAngle, e.patternScale || 1)}>
            {!known && <option value="">{e.pattern} (do arquivo)</option>}
            {HATCH_PATTERNS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.label}
              </option>
            ))}
          </select>
          {!e.solid && (
            <>
              <div className="k">Escala</div>
              <NumField value={e.patternScale || 1} min={1e-6} onCommit={(v) => known && regen(e.pattern, e.patternAngle, v)} />
              <div className="k">Ângulo (°)</div>
              <NumField value={rad2deg(e.patternAngle)} onCommit={(v) => known && regen(e.pattern, deg2rad(v), e.patternScale || 1)} />
            </>
          )}
          <div className="k">Contornos</div>
          <div className="ro">{e.loops.length}</div>
          <div className="k">Área</div>
          <div className="ro">{area(hatchArea(e.loops.map(hatchLoopPolygon), e.loops))}</div>
        </>
      );
    }
    case "dimension":
      return (
        <>
          <div className="sec">Cota</div>
          <div className="k">Tipo</div>
          <div className="ro">{{ aligned: "Alinhada", linear: "Linear", radius: "Raio", diameter: "Diâmetro", angular: "Angular" }[e.kind]}</div>
          <div className="k">Valor medido</div>
          <div className="ro">{e.kind === "angular" ? `${formatNumber(dimensionValue(e), 4, ",")}°` : ctl.fmtLen(dimensionValue(e))}</div>
          <div className="k">Associativa</div>
          <div className="ro">{e.assoc ? "Sim" : "Não"}</div>
          <div className="k">Texto (&lt;&gt; = valor)</div>
          <TextField value={e.textOverride ?? ""} onCommit={(v) => upd("Texto da cota", [{ ...e, textOverride: v.trim() ? v : null }])} />
          <div className="k">Escala da cota</div>
          <NumField value={e.dimScale ?? 1} min={0.01} onCommit={(v) => upd("Escala da cota", [{ ...e, dimScale: v }])} />
          {ptRow("Posição X, Y", e.loc, (p) => ({ ...e, loc: p }))}
        </>
      );
  }
}
