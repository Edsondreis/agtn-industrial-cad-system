import { BEND_PROCESS_OPTIONS, MATERIAL_OPTIONS } from "./sheetUi";
import type { FeatureDraft } from "@agtn/solid";
import { NumField } from "../../ui/fields";

/**
 * Campos das operações de chapa. ÂNGULO: o modelo guarda só θ = ângulo de dobra (deflexão; 90° = "L");
 * o campo mostra θ e α = 180° − θ (ângulo interno) lado a lado — digitar em qualquer um atualiza o outro.
 */
type Of<K extends FeatureDraft["t"]> = Extract<FeatureDraft, { t: K }>;

const Row = ({ k, children, title }: { k: string; children: React.ReactNode; title?: string }) => (
  <div className="p3-row edit" title={title}>
    <span className="k">{k}</span>
    <span className="v">{children}</span>
  </div>
);
const Unit = ({ v, set, unit = "mm", min, field }: { v: number; set: (x: number) => void; unit?: string; min?: number; field?: string }) => (
  <span className="unit-in" data-field={field}>
    <NumField value={v} onCommit={set} min={min} />
    <i>{unit}</i>
  </span>
);
const n2 = (v: number) => String(Number(v.toFixed(4))).replace(".", ",");

export function AngleField({ theta, set, label = "Ângulo" }: { theta: number; set: (theta: number) => void; label?: string }) {
  return (
    <Row k={label} title="θ = ângulo de dobra (deflexão; chapa plana 0°, L reto 90°). α = ângulo interno entre as abas = 180° − θ.">
      <span className="sh-ang">
        <span className="unit-in" data-field="theta">
          <i>θ</i>
          <NumField value={theta} onCommit={(v) => set(v)} min={0} />
          <i>°</i>
        </span>
        <span className="unit-in" data-field="alpha">
          <i>α</i>
          <NumField value={180 - theta} onCommit={(v) => set(180 - v)} min={0} />
          <i>°</i>
        </span>
      </span>
    </Row>
  );
}

/** R e K: vazio = padrão da peça (K da tabela material × processo × R/T, com a origem). */
export function RKFields({ R, K, set }: { R: number | null; K: number | null; set: (p: { R?: number | null; K?: number | null }) => void }) {
  return (
    <>
      <Row k="Raio interno">
        <label className="fd-check">
          <input type="checkbox" checked={R === null} onChange={(e) => set({ R: e.target.checked ? null : 2 })} /> padrão
        </label>
        {R !== null && <Unit v={R} set={(v) => set({ R: v })} min={0} field="R" />}
      </Row>
      <Row k="Fator K">
        <label className="fd-check">
          <input type="checkbox" checked={K === null} onChange={(e) => set({ K: e.target.checked ? null : 0.33 })} /> padrão
        </label>
        {K !== null && <Unit v={K} set={(v) => set({ K: v })} unit="" min={0} field="K" />}
      </Row>
    </>
  );
}

export function SideRef({ side, refm, set, sideLabel = "Sentido" }: { side: "cima" | "baixo"; refm?: "externa" | "interna"; set: (p: { side?: "cima" | "baixo"; ref?: "externa" | "interna" }) => void; sideLabel?: string }) {
  return (
    <>
      <Row k={sideLabel}>
        <div className="fd-seg" role="radiogroup">
          {(["cima", "baixo"] as const).map((s) => (
            <button key={s} className={side === s ? "on" : ""} onClick={() => set({ side: s })} data-side={s}>
              {s === "cima" ? "Para cima" : "Para baixo"}
            </button>
          ))}
        </div>
      </Row>
      {refm && (
        <Row k="Medida" title="Até o vértice virtual externo (padrão AGTN) ou interno.">
          <div className="fd-seg" role="radiogroup">
            {(["externa", "interna"] as const).map((r) => (
              <button key={r} className={refm === r ? "on" : ""} onClick={() => set({ ref: r })} data-ref={r}>
                {r === "externa" ? "Externa" : "Interna"}
              </button>
            ))}
          </div>
        </Row>
      )}
    </>
  );
}

export function BaseFields({ d, set }: { d: Of<"sheetBase">; set: (p: Partial<Of<"sheetBase">>) => void }) {
  return (
    <>
      <Row k="Espessura T">
        <Unit v={d.T} set={(v) => set({ T: v })} min={0} field="T" />
      </Row>
      <Row k="Material">
        <select value={d.material} onChange={(e) => set({ material: e.target.value })} data-field="material">
          {MATERIAL_OPTIONS.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Row>
      <Row k="Processo">
        <select value={d.process} onChange={(e) => set({ process: e.target.value })} data-field="process">
          {BEND_PROCESS_OPTIONS.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Row>
      <Row k="Raio interno">
        <Unit v={d.R} set={(v) => set({ R: v })} min={0} field="R" />
      </Row>
      <Row k="Fator K">
        <label className="fd-check">
          <input type="checkbox" checked={d.K === null} onChange={(e) => set({ K: e.target.checked ? null : 0.33 })} /> da tabela
        </label>
        {d.K !== null && <Unit v={d.K} set={(v) => set({ K: v })} unit="" min={0} field="K" />}
      </Row>
      <SideRef side={d.side} refm={d.ref} set={(p) => set(p)} sideLabel="Material" />
      <div className="fd-note">Contorno fechado só de retas; círculos/contornos internos viram furos. Medidas até o vértice virtual (referência acima).</div>
    </>
  );
}

export function FlangeFields({ d, set }: { d: Of<"sheetFlange">; set: (p: Partial<Of<"sheetFlange">>) => void }) {
  return (
    <>
      <Row k="Comprimento">
        <Unit v={d.length} set={(v) => set({ length: v })} min={0} field="length" />
      </Row>
      <AngleField theta={d.deflectionDeg} set={(v) => set({ deflectionDeg: v })} />
      <SideRef side={d.side} refm={d.ref} set={(p) => set(p)} />
      <RKFields R={d.R} K={d.K} set={(p) => set(p as Partial<Of<"sheetFlange">>)} />
      <Row k="Posição do material" title="Onde fica a aba em relação à aresta escolhida (desloca a linha de molde δ para fora da aresta).">
        <select value={d.position ?? "dentro"} onChange={(e) => set({ position: e.target.value as NonNullable<Of<"sheetFlange">["position"]> })} data-field="position">
          <option value="dentro">Material por dentro (δ = 0)</option>
          <option value="fora">Material por fora (δ = T)</option>
          <option value="dobra_fora">Dobra por fora (δ = recuo SB)</option>
        </select>
      </Row>
      <Row k="Recuo início" title="Distância do início da aresta (canto de molde) até onde a dobra começa. 0 = aresta inteira.">
        <Unit v={d.offsetStart ?? 0} set={(v) => set({ offsetStart: v })} min={0} field="offsetStart" />
      </Row>
      <Row k="Recuo fim" title="Distância do fim da aresta até onde a dobra termina. 0 = aresta inteira.">
        <Unit v={d.offsetEnd ?? 0} set={(v) => set({ offsetEnd: v })} min={0} field="offsetEnd" />
      </Row>
      {(d.offsetStart ?? 0) + (d.offsetEnd ?? 0) > 0 && (d.position ?? "dentro") !== "dobra_fora" && (
        <div className="fd-note">Dobra parcial: sem alívio de dobra há risco de rasgo nas pontas da faixa.</div>
      )}
      {d.edges.length > 1 && <div className="fd-note">Várias arestas: cantos entre abas vizinhas ficam abertos (detectados no painel Chapa; fechamento na operação Canto).</div>}
    </>
  );
}

export function ContourFields({ d, set }: { d: Of<"sheetContour">; set: (p: Partial<Of<"sheetContour">>) => void }) {
  const seg = (i: number, p: Partial<Of<"sheetContour">["segments"][number]>) => set({ segments: d.segments.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  // ids estáveis: antes de inserir/remover, cada segmento recebe o id que já tinha (sem id = posição, ETAPA 1)
  const norm = () => d.segments.map((s, i) => ({ ...s, id: s.id ?? String(i + 1) }));
  const nextId = (segs: readonly { id?: string }[]) => {
    const ids = new Set(segs.map((s) => s.id));
    let k = 1;
    while (ids.has(`s${k}`)) k++;
    return `s${k}`;
  };
  return (
    <>
      <SideRef side="cima" refm={d.ref} set={(p) => p.ref && set({ ref: p.ref })} sideLabel="—" />
      <div className="fd-list sh-segs">
        <div className="fd-list-h">
          Perfil (seção constante) — segmento = dobra antes + comprimento
          <button
            className="lnk"
            onClick={() => {
              const n = norm();
              set({ segments: [...n, { id: nextId(n), length: 20, deflectionDeg: 90, side: "cima", R: null, K: null }] });
            }}
            data-testid="seg-add"
          >
            + segmento
          </button>
        </div>
        {d.segments.map((s, i) => (
          <div key={s.id ?? i} className="sh-seg" data-seg={i}>
            <b>{i + 1}</b>
            <Unit v={s.length} set={(v) => seg(i, { length: v })} min={0} field={`len${i}`} />
            <span className="unit-in">
              <i>θ</i>
              <NumField value={s.deflectionDeg} onCommit={(v) => seg(i, { deflectionDeg: v })} min={0} />
              <i>° · α {n2(180 - s.deflectionDeg)}°</i>
            </span>
            <select value={s.side} onChange={(e) => seg(i, { side: e.target.value as "cima" | "baixo" })}>
              <option value="cima">cima</option>
              <option value="baixo">baixo</option>
            </select>
            {d.segments.length > 1 && (
              <button className="lnk" onClick={() => set({ segments: norm().filter((_, k) => k !== i) })} title="Remover segmento (as abas ligadas aos outros segmentos continuam neles)">
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="fd-note">ETAPA 1: perfil aberto ao longo de UMA aresta reta, calculado pelo motor de perfis (mesmas fórmulas do 2D).</div>
    </>
  );
}

export function BendLineFields({ d, set, lines, flanges }: { d: Of<"sheetBendLine">; set: (p: Partial<Of<"sheetBendLine">>) => void; lines: readonly string[]; flanges: readonly { id: string; label: string }[] }) {
  return (
    <>
      <Row k="Linha de dobra">
        <select value={d.line} onChange={(e) => set({ line: e.target.value })} data-field="line">
          {!lines.length && <option value="">— sem linhas —</option>}
          {lines.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      <FlangeSelect v={d.flange} flanges={flanges} set={(v) => set({ flange: v })} />
      <AngleField theta={d.deflectionDeg} set={(v) => set({ deflectionDeg: v })} />
      <SideRef side={d.side} refm={d.ref} set={(p) => set(p)} />
      <Row k="Lado fixo">
        <div className="fd-seg" role="radiogroup">
          {(["esq", "dir"] as const).map((s) => (
            <button key={s} className={d.fixed === s ? "on" : ""} onClick={() => set({ fixed: s })} data-fixed={s}>
              {s === "esq" ? "Esquerda" : "Direita"}
            </button>
          ))}
        </div>
      </Row>
      <RKFields R={d.R} K={d.K} set={(p) => set(p as Partial<Of<"sheetBendLine">>)} />
      <div className="fd-note">A linha é o centro da região de dobra na planificação. Esboço sobre a face da aba; ETAPA 1: só na base (ou parte de outra dobra por linha).</div>
    </>
  );
}

export function FlangeSelect({ v, flanges, set }: { v: string; flanges: readonly { id: string; label: string }[]; set: (id: string) => void }) {
  return (
    <Row k="Aba">
      <select value={v} onChange={(e) => set(e.target.value)} data-field="flange">
        {!flanges.some((f) => f.id === v) && <option value={v}>{v || "—"}</option>}
        {flanges.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

/** Alívio de dobra: operação própria (não é recorte). Lista as dobras da peça; só as de faixa parcial aceitam. */
export function ReliefFields({
  d,
  set,
  bends,
}: {
  d: Of<"sheetRelief">;
  set: (p: Partial<Of<"sheetRelief">>) => void;
  bends: readonly { id: string; label: string; partial: boolean; relief?: { w: number; d: number } | null }[];
}) {
  const on = new Set(d.bends);
  return (
    <>
      <Row k="Tipo">
        <div className="fd-seg" role="radiogroup">
          {(["retangular", "oblongo", "lagrima"] as const).map((k) => (
            <button key={k} className={d.kind === k ? "on" : ""} onClick={() => set({ kind: k })} data-kind={k}>
              {{ retangular: "Retangular", oblongo: "Oblongo", lagrima: "Lágrima" }[k]}
            </button>
          ))}
        </div>
      </Row>
      <Row k="Folga g" title="Folga inicial AGTN (Preferências); editável aqui.">
        <Unit v={d.gap} set={(v) => set({ gap: v })} min={0} field="gap" />
      </Row>
      <Row k="Largura">
        <label className="fd-check">
          <input type="checkbox" checked={d.width === null} onChange={(e) => set({ width: e.target.checked ? null : 2.5 })} /> auto (T + g)
        </label>
        {d.width !== null && <Unit v={d.width} set={(v) => set({ width: v })} min={0} field="width" />}
      </Row>
      <Row k="Profundidade">
        <label className="fd-check">
          <input type="checkbox" checked={d.depth === null} onChange={(e) => set({ depth: e.target.checked ? null : 6 })} /> auto (SB + g)
        </label>
        {d.depth !== null && <Unit v={d.depth} set={(v) => set({ depth: v })} min={0} field="depth" />}
      </Row>
      <div className="fd-list">
        <div className="fd-list-h">Dobras com ponta dentro da aresta</div>
        {!bends.some((b) => b.partial) && <div className="fd-note">Nenhuma dobra parcial — use Recuo início/fim na aba para a dobra terminar dentro da aresta.</div>}
        {bends
          .filter((b) => b.partial || on.has(b.id))
          .map((b) => (
            <label key={b.id} className="fd-check" data-bend={b.id}>
              <input
                type="checkbox"
                checked={on.has(b.id)}
                onChange={(e) => {
                  const x = new Set(on);
                  if (e.target.checked) x.add(b.id);
                  else x.delete(b.id);
                  set({ bends: bends.filter((q) => x.has(q.id)).map((q) => q.id) });
                }}
              />
              {b.label}
              {b.relief ? ` · alívio ${n2(b.relief.w)} × ${n2(b.relief.d)} mm` : ""}
            </label>
          ))}
      </div>
      <div className="fd-note">Entalhe na aba-pai ao lado de cada ponta da faixa, do vértice virtual até passar a linha de tangência por g. Recalculado quando T, R ou θ mudam.</div>
    </>
  );
}

/** Fechamento de canto (ETAPA 2.3): cantos detectados entre abas vizinhas; mesmas regras da bandeja 2D. */
export function CornerFields({
  d,
  set,
  corners,
}: {
  d: Of<"sheetCorner">;
  set: (p: Partial<Of<"sheetCorner">>) => void;
  corners: readonly { id: string; label: string; angleDeg: number; kind: string }[];
}) {
  const on = new Set(d.corners);
  const KINDS = [
    ["sobreposto", "Sobreposto"],
    ["encosto", "Encosto"],
    ["esquadria", "Esquadria"],
    ["aberto", "Aberto"],
  ] as const;
  return (
    <>
      <Row k="Tipo">
        <div className="fd-seg" role="radiogroup">
          {KINDS.map(([k, l]) => (
            <button key={k} className={d.kind === k ? "on" : ""} onClick={() => set({ kind: k })} data-corner-kind={k}>
              {l}
            </button>
          ))}
        </div>
      </Row>
      <Row k="Folga g" title="Folga de solda no canto, medida ao longo da aba (esquadria: g/2 de cada lado). Encosto e esquadria pedem g > 0.">
        <Unit v={d.gap} set={(v) => set({ gap: v })} min={0} field="gap" />
      </Row>
      {(d.kind === "sobreposto" || d.kind === "encosto") && (
        <Row k="Aba que fecha" title="A aba que vai até a face externa da vizinha (cobre o topo da outra).">
          <select value={d.closer} onChange={(e) => set({ closer: e.target.value as "a" | "b" })} data-field="closer">
            <option value="a">1ª aba do canto</option>
            <option value="b">2ª aba do canto</option>
          </select>
        </Row>
      )}
      <Row k="Alívio de canto" title="Retangular: o vazio que sobra entre as faixas de dobra. Redondo atravessaria as dobras (sem representação exata — bloqueado).">
        <select value={d.relief} onChange={(e) => set({ relief: e.target.value as "retangular" | "redondo" })} data-field="cornerRelief">
          <option value="retangular">Retangular (entre as faixas)</option>
          <option value="redondo">Redondo (bloqueado no 3D)</option>
        </select>
      </Row>
      <div className="fd-list">
        <div className="fd-list-h">Cantos detectados (1ª × 2ª aba)</div>
        {!corners.length && <div className="fd-note">Nenhum canto entre abas de borda vizinhas — crie abas em duas arestas que se encontram, sem recuo no canto.</div>}
        {corners.map((c) => (
          <label key={c.id} className="fd-check" data-corner={c.id}>
            <input
              type="checkbox"
              checked={on.has(c.id)}
              onChange={(e) => {
                const x = new Set(on);
                if (e.target.checked) x.add(c.id);
                else x.delete(c.id);
                set({ corners: corners.filter((q) => x.has(q.id)).map((q) => q.id) });
              }}
            />
            {c.label} · {n2(c.angleDeg)}° · {c.kind}
          </label>
        ))}
      </div>
      <div className="fd-note">O lado de cada aba no canto vira a interseção com o plano da outra (exato para qualquer θ). A dobra fica do tamanho da faixa.</div>
    </>
  );
}
