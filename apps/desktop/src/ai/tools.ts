/**
 * AGTN AI ASSISTANT — ferramentas que operam o CAD DE VERDADE.
 *
 * Cada ferramenta chama as mesmas funções do aplicativo (documento, seleção, desfazer, motor SHEET METAL, motor 3D,
 * exportação). Nada aqui é um "segundo CAD": a IA só pede; o aplicativo calcula e grava. Toda alteração:
 *  - passa por prévia REAL (geometria calculada pelo motor) e só é aplicada depois da confirmação do usuário;
 *  - vira UMA transação com rótulo "IA: …", desfazível pelo Ctrl+Z / Editar → Desfazer;
 *  - confere, na hora de aplicar, se o desenho mudou desde a prévia (sem aplicar sobre estado velho).
 */
import type { Change } from "@agtn/document";
import type { ToolDef, ToolOutcome } from "@agtn/ai";
import {
  ENTITY_TYPE_LABEL,
  type Entity,
  type EntityType,
  type Vec2,
  closestOnEntity,
  dist,
  entityBox,
  entityLength,
  makeEntity,
  newId,
  polylineSignedArea,
  transformEntity,
  translation,
} from "@agtn/geometry";
import { type MeasureGrade, MEASURE_GRADE_LABEL, getModel, gradeBody } from "@agtn/model3d";
import type { GeometryCheck, MassProps } from "@agtn/solid";
import {
  type DimRef,
  PROFILE_DEFS,
  type ProfileKind,
  type ProfileParams,
  type SolveResult,
  buildProfileInput,
  flatPatternEntities,
  lookupK,
  sectionEntities,
  solveProfile,
} from "@agtn/sheetmetal";
import type { CadController } from "../cad/controller";
import { readSM } from "../sheetmetal/state";

/* ------------------------------------------------------------------ host ------------------------------------------------------------------ */

export interface BodyFacts3D {
  readonly props: MassProps;
  readonly topo: { solids: number; faces: number; edges: number; vertices: number };
  readonly check: GeometryCheck;
}

/** O que as ferramentas precisam do aplicativo (implementado no App; simulado nos testes). */
export interface AiHost {
  readonly ctl: CadController;
  /** área de trabalho atual (desenho, planificacao, modelo3d…) */
  workspace(): string;
  /** leva o usuário ao desenho e enquadra (depois de inserir algo) */
  showDrawing(): void;
  /** camadas de fabricação que faltam no desenho (CONTORNO_CORTE, LINHAS_DOBRA…) */
  fabLayerChanges(): Change[];
  /** abre a janela de salvar e grava o desenho em DXF; devolve o resultado REAL */
  exportDxf(): Promise<{ readonly ok: true; readonly path: string; readonly version: string } | { readonly ok: false; readonly error: string | null }>;
  /** abre a janela de impressão/PDF do aplicativo */
  openPlot(): void;
  /** fatos exatos dos corpos já carregados no motor 3D (null = motor não iniciado) */
  bodyFacts(ids: string[]): Promise<Record<string, BodyFacts3D> | null>;
}

/** Estado da conversa que pertence ao CAD (perfil em edição pela IA e o que ela inseriu). */
export interface ProfileDraft {
  params: ProfileParams;
  /** ids inseridos no desenho para a seção / planificação deste perfil */
  sectionIds: string[];
  flatIds: string[];
  /** K usado na última planificação e de onde veio */
  k: { value: number; source: string } | null;
}
export class AiSession {
  profile: ProfileDraft | null = null;
}

/* --------------------------------------------------------------- utilidades --------------------------------------------------------------- */

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const mm = (v: number) => `${r3(v).toLocaleString("pt-BR", { maximumFractionDigits: 3 })} mm`;
const ok = (data: unknown): ToolOutcome => ({ status: "ok", data });
const err = (message: string, data?: unknown): ToolOutcome => ({ status: "erro", message, data });
const ask = (question: string, data?: unknown): ToolOutcome => ({ status: "precisa_informacao", question, data });

type Box = { minX: number; minY: number; maxX: number; maxY: number };
function boxOf(list: readonly Entity[]): Box | null {
  let b: Box | null = null;
  for (const e of list) {
    const x = entityBox(e);
    if (![x.minX, x.minY, x.maxX, x.maxY].every(Number.isFinite)) continue;
    b = b ? { minX: Math.min(b.minX, x.minX), minY: Math.min(b.minY, x.minY), maxX: Math.max(b.maxX, x.maxX), maxY: Math.max(b.maxY, x.maxY) } : { ...x };
  }
  return b;
}

/** Ponto livre para inserir sem sobrepor: à direita do que já existe (+50 mm). */
function freeSpot(ctl: CadController, w: Box | null): Vec2 {
  const ext = ctl.doc.extents();
  if (!ext) return { x: 0, y: 0 };
  return { x: ext.maxX + 50 - (w?.minX ?? 0), y: ext.minY - (w?.minY ?? 0) };
}

/** Medidas exatas de uma entidade 2D (com o grau de exatidão). */
function metrics(e: Entity): Record<string, unknown> {
  const base = { tipo: ENTITY_TYPE_LABEL[e.type] ?? e.type, camada: e.layer };
  switch (e.type) {
    case "line":
      return { ...base, comprimento: r3(dist(e.a, e.b)), de: [r3(e.a.x), r3(e.a.y)], ate: [r3(e.b.x), r3(e.b.y)], grau: "exato" };
    case "circle":
      return { ...base, centro: [r3(e.c.x), r3(e.c.y)], raio: r3(e.r), diametro: r3(2 * e.r), perimetro: r3(2 * Math.PI * e.r), area: r3(Math.PI * e.r * e.r), grau: "exato" };
    case "arc":
      return { ...base, centro: [r3(e.c.x), r3(e.c.y)], raio: r3(e.r), comprimento: r3(entityLength(e)), grau: "exato" };
    case "polyline": {
      const area = e.closed ? Math.abs(polylineSignedArea(e.pts, e.bulges)) : null;
      return { ...base, vertices: e.pts.length, fechada: e.closed, comprimento: r3(entityLength(e)), ...(area !== null ? { area: r3(area) } : {}), grau: "exato" };
    }
    case "ellipse": {
      const full = Math.abs(Math.abs(e.t1 - e.t0) - 2 * Math.PI) < 1e-9;
      const a = Math.hypot(e.major.x, e.major.y), b = a * e.ratio;
      return { ...base, semi_eixo_maior: r3(a), semi_eixo_menor: r3(b), ...(full ? { area: r3(Math.PI * a * b) } : {}), comprimento: r3(entityLength(e)), grau: "exato (área); comprimento aproximado por segmentos" };
    }
    case "spline":
      return { ...base, comprimento: r3(entityLength(e)), grau: "aproximado (spline discretizada)" };
    case "point":
      return { ...base, ponto: [r3(e.p.x), r3(e.p.y)], grau: "exato" };
    case "text":
      return { ...base, texto: e.value.slice(0, 80), altura: r3(e.h) };
    default:
      return base;
  }
}

/* --------------------------------------------------------------- contexto --------------------------------------------------------------- */

/** Retrato MÍNIMO do aplicativo enviado ao modelo a cada passo (sem nome de arquivo, pasta ou cliente). */
export function cadContext(h: AiHost, s: AiSession): unknown {
  const doc = h.ctl.doc;
  const counts: Partial<Record<EntityType, number>> = {};
  for (const e of doc.all()) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const sel = h.ctl.sel.entities();
  const ext = doc.extents();
  let corpos3d = 0;
  try {
    corpos3d = Object.values(getModel(doc).nodes).filter((n) => n.kind === "body").length;
  } catch {
    corpos3d = 0;
  }
  return {
    area_de_trabalho: h.workspace(),
    unidade: doc.settings.units,
    entidades: counts,
    total_entidades: doc.size,
    extensao: ext ? { x: [r3(ext.minX), r3(ext.maxX)], y: [r3(ext.minY), r3(ext.maxY)] } : null,
    camada_atual: doc.currentLayer,
    selecao: { quantidade: sel.length, tipos: [...new Set(sel.map((e) => e.type))] },
    pode_desfazer: doc.canUndo ? doc.undoLabel : null,
    corpos_3d: corpos3d,
    perfil_em_edicao_pela_ia: s.profile ? profileSummary(s.profile) : null,
  };
}

function profileSummary(p: ProfileDraft) {
  const def = PROFILE_DEFS[p.params.kind];
  return {
    tipo: def.name,
    espessura: p.params.T,
    medidas: Object.fromEntries(def.flangeLabels.map((l, i) => [l, `${p.params.dims[i].value} (${p.params.dims[i].ref})`])),
    dobras: p.params.bends.map((b) => ({ angulo: b.angleDeg, raio_interno: b.R })),
    comprimento: p.params.partLength,
    no_desenho: { secao: p.sectionIds.length > 0, planificacao: p.flatIds.length > 0 },
    fator_k: p.k,
  };
}

/* -------------------------------------------------------------- ferramentas -------------------------------------------------------------- */

const PROFILE_KINDS = Object.keys(PROFILE_DEFS) as ProfileKind[];
const KIND_HELP = PROFILE_KINDS.map((k) => `${k}: medidas na ordem [${PROFILE_DEFS[k].flangeLabels.join("; ")}]`).join(" | ");

/** Mudou o desenho desde a prévia? (a prévia vale para a revisão em que foi calculada) */
function stale(ctl: CadController, rev: number): ToolOutcome | null {
  return ctl.doc.revision !== rev ? err("O desenho mudou depois da prévia (outra edição aconteceu). Nada foi aplicado; peça de novo para eu recalcular.") : null;
}

/** Aplica uma transação "IA: …" e devolve o resultado real (ids, rótulo do desfazer). */
function commit(h: AiHost, label: string, changes: Change[], created: string[]): ToolOutcome {
  const tx = h.ctl.doc.commit(`IA: ${label}`, changes);
  if (!tx) return err("O documento recusou a alteração (nenhuma mudança efetiva).");
  h.ctl.refresh();
  return ok({ aplicado: true, transacao: tx.label, objetos_criados: created.length, desfazer_com: "Ctrl+Z / Editar → Desfazer" });
}

function solve(params: ProfileParams): { r: SolveResult | null; error: string | null } {
  try {
    const r = solveProfile(buildProfileInput(params));
    if (!r.ok) return { r, error: r.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ") || "perfil inválido" };
    return { r, error: null };
  } catch (e) {
    return { r: null, error: String((e as Error)?.message ?? e) };
  }
}

export function createCadTools(h: AiHost, s: AiSession): ToolDef[] {
  const ctl = h.ctl;
  const doc = ctl.doc;

  const tools: ToolDef[] = [
    /* ------------------------------------------------ leitura ------------------------------------------------ */
    {
      name: "ler_documento",
      description: "Resumo do desenho aberto: quantidade de objetos por tipo, extensão, camadas, seleção, unidade, desfazer disponível, perfil que a IA está editando e corpos 3D.",
      risk: "leitura",
      parameters: { type: "object", properties: {} },
      run: () => ok({ ...(cadContext(h, s) as object), camadas: doc.layers.map((l) => l.name).slice(0, 60) }),
    },
    {
      name: "ler_selecao",
      description: "Medidas EXATAS dos objetos selecionados no desenho (comprimento, raio, diâmetro, área de contorno fechado). Até 50 objetos.",
      risk: "leitura",
      parameters: { type: "object", properties: {} },
      run: () => {
        const sel = ctl.sel.entities();
        if (!sel.length) return ask("Não há nada selecionado no desenho. Selecione os objetos e peça de novo.");
        const box = boxOf(sel);
        return ok({
          quantidade: sel.length,
          objetos: sel.slice(0, 50).map(metrics),
          extensao_da_selecao: box ? { largura: r3(box.maxX - box.minX), altura: r3(box.maxY - box.minY) } : null,
          comprimento_total: r3(sel.reduce((a, e) => a + entityLength(e), 0)),
        });
      },
    },
    {
      name: "medir_distancia",
      description:
        "Distância exata. Ou entre dois pontos informados (x1,y1,x2,y2 em mm), ou, sem coordenadas, entre os DOIS objetos selecionados (menor distância). Nunca estime: se faltarem pontos, pergunte.",
      risk: "leitura",
      parameters: { type: "object", properties: { x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" } } },
      run: (a) => {
        const nums = ["x1", "y1", "x2", "y2"].map((k) => a[k]);
        if (nums.every((v) => typeof v === "number")) {
          const [x1, y1, x2, y2] = nums as number[];
          const d = Math.hypot(x2 - x1, y2 - y1);
          return ok({ distancia: r3(d), dx: r3(x2 - x1), dy: r3(y2 - y1), angulo_graus: r3((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI), grau: "exato" });
        }
        if (nums.some((v) => typeof v === "number")) return ask("Faltam coordenadas: informe x1, y1, x2 e y2 (mm), ou selecione dois objetos.");
        const sel = ctl.sel.entities();
        if (sel.length !== 2) return ask(`Selecione exatamente dois objetos (há ${sel.length}) ou informe as coordenadas dos dois pontos.`);
        const [e1, e2] = sel;
        if (e1.type === "point" && e2.type === "point") {
          const d = dist(e1.p, e2.p);
          return ok({ distancia: r3(d), dx: r3(e2.p.x - e1.p.x), dy: r3(e2.p.y - e1.p.y), grau: "exato" });
        }
        // menor distância por refinamento alternado (exata para linhas/arcos/círculos/polilinhas)
        let p = e1.type === "point" ? e1.p : closestOnEntity(entityBox(e2).minX !== undefined ? { x: (entityBox(e2).minX + entityBox(e2).maxX) / 2, y: (entityBox(e2).minY + entityBox(e2).maxY) / 2 } : { x: 0, y: 0 }, e1);
        let q = closestOnEntity(p, e2);
        for (let i = 0; i < 60; i++) {
          const p2 = e1.type === "point" ? e1.p : closestOnEntity(q, e1);
          const q2 = closestOnEntity(p2, e2);
          if (dist(p2, p) < 1e-12 && dist(q2, q) < 1e-12) break;
          p = p2;
          q = q2;
        }
        const approx = [e1, e2].some((e) => e.type === "spline" || e.type === "ellipse");
        return ok({ distancia: r3(dist(p, q)), ponto_1: [r3(p.x), r3(p.y)], ponto_2: [r3(q.x), r3(q.y)], grau: approx ? "aproximado (curva discretizada)" : "exato" });
      },
    },
    {
      name: "calcular_area",
      description: "Área EXATA dos contornos fechados selecionados (círculo, polilinha fechada com arcos, elipse completa). Informa os que não são fechados.",
      risk: "leitura",
      parameters: { type: "object", properties: {} },
      run: () => {
        const sel = ctl.sel.entities();
        if (!sel.length) return ask("Selecione os contornos fechados e peça de novo.");
        const itens: { tipo: string; area: number }[] = [];
        const ignorados: string[] = [];
        for (const e of sel) {
          const m = metrics(e) as { area?: number; tipo: string };
          if (typeof m.area === "number") itens.push({ tipo: m.tipo, area: m.area });
          else ignorados.push(m.tipo);
        }
        if (!itens.length) return err("Nenhum contorno fechado na seleção (linhas, arcos e polilinhas abertas não têm área).", { ignorados });
        return ok({ itens, area_total: r3(itens.reduce((a, b) => a + b.area, 0)), unidade: "mm²", ignorados, grau: "exato" });
      },
    },
    {
      name: "info_solidos_3d",
      description:
        "Volume, área, dimensões (caixa) e topologia EXATOS (B-rep) dos sólidos do modelo 3D, com o grau da medida (exato / invalido / nao_verificado / nao_calculavel) e o motivo quando não é exato. Use para 'qual o volume', 'mostre as dimensões' e 'por que esta geometria está com erro'.",
      risk: "leitura",
      parameters: { type: "object", properties: { nome: { type: "string", description: "filtra pelo nome do corpo (opcional)", maxLength: 120 } } },
      run: async (a) => {
        let model;
        try {
          model = getModel(doc);
        } catch {
          return err("Não foi possível ler o modelo 3D do projeto.");
        }
        const bodies = Object.values(model.nodes).filter((n) => n.kind === "body" && (!a.nome || n.name.toLowerCase().includes(String(a.nome).toLowerCase())));
        if (!bodies.length) return err(a.nome ? `Nenhum corpo 3D com o nome "${String(a.nome)}".` : "O projeto não tem sólidos 3D.");
        const facts = await h.bodyFacts(bodies.map((b) => b.id));
        if (!facts) return err("O motor 3D não está carregado. Abra a aba 3D para o motor ler os sólidos e peça de novo.");
        const out = bodies.slice(0, 40).map((b) => {
          const f = facts[b.id];
          if (!f) return { nome: b.name, grau: "nao_calculavel" as MeasureGrade, motivo: "corpo não carregado no motor (abra a aba 3D)" };
          const grade = gradeBody({ props: f.props, topo: f.topo, valid: f.check.shapeValid, check: f.check });
          const exact = grade === "exato";
          const bb = f.props.bbox;
          return {
            nome: b.name,
            grau: grade,
            grau_texto: MEASURE_GRADE_LABEL[grade],
            ...(exact
              ? { volume_mm3: r3(f.props.volume), area_mm2: r3(f.props.area), dimensoes: { x: r3(bb.max.x - bb.min.x), y: r3(bb.max.y - bb.min.y), z: r3(bb.max.z - bb.min.z) } }
              : { valores: "não apresentados: geometria não validada" }),
            topologia: f.topo,
            ...(exact
              ? {}
              : {
                  motivo: [
                    !f.check.shapeValid && "verificador de forma do motor reprovou",
                    !f.check.volumeOk && "volume incoerente com a área (superfície sobreposta ou sólido do avesso)",
                    ...f.check.faces.map((x) => `face nº ${x.index + 1} (${x.surface}): ${x.reason === "invalida" ? "inválida" : `aresta fora da superfície, desvio ${r3(x.deviation ?? NaN)} mm`}`),
                  ].filter(Boolean),
                }),
          };
        });
        return ok({ corpos: out, observacao: "medidas do B-rep; só valem para engenharia/fabricação quando grau = exato" });
      },
    },

    /* ------------------------------------------------ chapa (SHEET METAL) ------------------------------------------------ */
    {
      name: "criar_perfil_chapa",
      description: `Prepara um perfil de chapa dobrada pelo motor AGTN SHEET METAL e mostra a SEÇÃO como prévia; só insere no desenho depois que o usuário confirmar. Tipos e ordem das medidas: ${KIND_HELP}. Ex.: perfil U de alma 200 e abas 75 → tipo U, medidas [75, 200, 75]. raio_interno é obrigatório (pergunte se o usuário não disse). angulo_graus padrão 90 (ângulo de dobra). referencia: "externa" (padrão) ou "interna".`,
      risk: "previa",
      parameters: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: PROFILE_KINDS },
          espessura: { type: "number", exclusiveMinimum: 0, maximum: 50, description: "mm" },
          medidas: { type: "array", items: { type: "number", exclusiveMinimum: 0, maximum: 20000 }, minItems: 2, maxItems: 8, description: "mm, na ordem do tipo" },
          raio_interno: { type: "number", minimum: 0, maximum: 500, description: "raio interno de dobra (mm)" },
          angulo_graus: { type: "number", exclusiveMinimum: 0, maximum: 180 },
          referencia: { type: "string", enum: ["externa", "interna"] },
          comprimento: { type: "number", exclusiveMinimum: 0, maximum: 20000, description: "comprimento da peça (mm), usado na planificação" },
        },
        required: ["tipo", "espessura", "medidas"],
      },
      run: (a) => {
        const kind = a.tipo as ProfileKind;
        const def = PROFILE_DEFS[kind];
        const dims = a.medidas as number[];
        if (dims.length !== def.flangeLabels.length)
          return ask(`O ${def.name} precisa de ${def.flangeLabels.length} medidas, na ordem: ${def.flangeLabels.join("; ")}. Recebi ${dims.length}. Quais são?`);
        if (typeof a.raio_interno !== "number") return ask(`Qual o raio interno de dobra do ${def.name} (mm)? Ex.: igual à espessura (${a.espessura} mm).`);
        const base = def.defaults();
        const table = readSM(doc).kTables[0];
        const params: ProfileParams = {
          kind,
          T: a.espessura as number,
          partLength: typeof a.comprimento === "number" ? a.comprimento : base.partLength,
          dims: dims.map((v) => ({ value: v, ref: (a.referencia as DimRef) ?? "externa" })),
          bends: base.bends.map((b) => ({ ...b, angleDeg: typeof a.angulo_graus === "number" ? a.angulo_graus : b.angleDeg, R: a.raio_interno as number, K: 0.5, kSource: "manual" as const, kRuleId: null })),
          fab: { material: "aco_carbono", process: "ar", toolName: "", vOpening: null, punchRadius: null, kTableId: table?.id ?? "" },
        };
        const { r, error } = solve(params);
        if (!r || error) return err(`O motor de chapas recusou o perfil: ${error}`);
        const ents = sectionEntities(r);
        const box = boxOf(ents);
        const rev = doc.revision;
        const replacing = s.profile ? [...s.profile.sectionIds, ...s.profile.flatIds].filter((id) => doc.has(id)) : [];
        const details = [
          ...def.flangeLabels.map((l, i) => `${l}: ${mm(dims[i])} (${params.dims[i].ref})`),
          `Espessura: ${mm(params.T)} · raio interno ${mm(params.bends[0].R)} · dobra ${params.bends[0].angleDeg}°`,
          ...r.flanges.map((f) => `${f.label}: externa ${mm(f.lengthExt)} · interna ${mm(f.lengthInt)} · reto ${mm(f.flat)}`),
          box ? `Seção: ${mm(box.maxX - box.minX)} × ${mm(box.maxY - box.minY)}` : "",
          "Fator K: ainda não definido (será pedido na planificação).",
          ...r.issues.filter((i) => i.level === "warning").map((i) => `Aviso: ${i.message}`),
        ].filter(Boolean);
        return {
          status: "previa",
          data: { tipo: def.name, abas: r.flanges.map((f) => ({ aba: f.label, externa: r3(f.lengthExt), interna: r3(f.lengthInt) })), avisos: r.issues.map((i) => i.message) },
          preview: {
            title: `Criar ${def.name} — seção no desenho`,
            details,
            destructive: false,
            visual: { entities: ents },
            apply: () => {
              const st = stale(ctl, rev);
              if (st) return st;
              const at = freeSpot(ctl, box);
              const placed = ents.map((e) => ({ ...transformEntity(e, translation(at.x, at.y)), id: newId() }) as Entity);
              s.profile = { params, sectionIds: placed.map((e) => e.id), flatIds: [], k: null };
              void replacing; // perfil anterior continua no desenho (criar não substitui)
              const res = commit(h, `Seção ${def.name}`, [...h.fabLayerChanges(), ...doc.addChanges(placed)], placed.map((e) => e.id));
              h.showDrawing();
              return res;
            },
          },
        };
      },
    },
    {
      name: "editar_perfil_chapa",
      description:
        "Altera o perfil que a IA criou nesta conversa (espessura, medidas, raio, ângulo, comprimento, referência). Recalcula pelo motor; se o perfil já está no desenho, mostra prévia de SUBSTITUIÇÃO e só troca os objetos após confirmação.",
      risk: "previa",
      parameters: {
        type: "object",
        properties: {
          espessura: { type: "number", exclusiveMinimum: 0, maximum: 50 },
          medidas: { type: "array", items: { type: "number", exclusiveMinimum: 0, maximum: 20000 }, minItems: 2, maxItems: 8 },
          raio_interno: { type: "number", minimum: 0, maximum: 500 },
          angulo_graus: { type: "number", exclusiveMinimum: 0, maximum: 180 },
          referencia: { type: "string", enum: ["externa", "interna"] },
          comprimento: { type: "number", exclusiveMinimum: 0, maximum: 20000 },
        },
      },
      run: (a) => {
        const p = s.profile;
        if (!p) return err("Nenhum perfil criado pela IA nesta conversa. Peça para criar um perfil primeiro (ex.: perfil U 75×200×75, espessura 6, raio 6).");
        const def = PROFILE_DEFS[p.params.kind];
        const next: ProfileParams = structuredClone(p.params);
        const changes: string[] = [];
        if (typeof a.espessura === "number") (changes.push(`espessura ${next.T} → ${a.espessura} mm`), (next.T = a.espessura));
        if (Array.isArray(a.medidas)) {
          const m = a.medidas as number[];
          if (m.length !== def.flangeLabels.length) return ask(`O ${def.name} tem ${def.flangeLabels.length} medidas (${def.flangeLabels.join("; ")}). Informe todas.`);
          changes.push(`medidas ${next.dims.map((d) => d.value).join("×")} → ${m.join("×")}`);
          next.dims = m.map((v, i) => ({ value: v, ref: next.dims[i].ref }));
        }
        if (typeof a.referencia === "string") (changes.push(`referência → ${a.referencia}`), (next.dims = next.dims.map((d) => ({ ...d, ref: a.referencia as DimRef }))));
        if (typeof a.raio_interno === "number") (changes.push(`raio ${next.bends[0].R} → ${a.raio_interno} mm`), (next.bends = next.bends.map((b) => ({ ...b, R: a.raio_interno as number }))));
        if (typeof a.angulo_graus === "number") (changes.push(`ângulo ${next.bends[0].angleDeg}° → ${a.angulo_graus}°`), (next.bends = next.bends.map((b) => ({ ...b, angleDeg: a.angulo_graus as number }))));
        if (typeof a.comprimento === "number") (changes.push(`comprimento ${next.partLength} → ${a.comprimento} mm`), (next.partLength = a.comprimento));
        if (!changes.length) return ask("O que devo alterar no perfil? (espessura, medidas, raio, ângulo, comprimento ou referência)");
        const { r, error } = solve(next);
        if (!r || error) return err(`O motor de chapas recusou a alteração: ${error}. O perfil continua como estava.`);
        const inDoc = [...p.sectionIds, ...p.flatIds].filter((id) => doc.has(id));
        const resumo = { alteracoes: changes, abas: r.flanges.map((f) => ({ aba: f.label, externa: r3(f.lengthExt), interna: r3(f.lengthInt) })) };
        if (!inDoc.length) {
          // nada no desenho ainda: só o rascunho da conversa muda (o documento não é tocado)
          s.profile = { ...p, params: next, sectionIds: [], flatIds: [], k: null };
          return ok({ ...resumo, observacao: "perfil atualizado (ainda não está no desenho)" });
        }
        // substituir no desenho: seção (e planificação, se existir — exige K, reaproveita o último K confirmado)
        const sec = sectionEntities(r);
        let flat: Entity[] = [];
        if (p.flatIds.some((id) => doc.has(id))) {
          if (!p.k) return ask("A planificação no desenho precisa ser refeita e o fator K não está confirmado. Qual K usar (ou uso o da tabela do projeto)?");
          const withK = { ...next, bends: next.bends.map((b) => ({ ...b, K: p.k!.value })) };
          const rk = solve(withK);
          if (!rk.r || rk.error) return err(`Planificação recusada pelo motor: ${rk.error}`);
          flat = flatPatternEntities(rk.r, { dims: true, notes: true, bendRegions: true, title: `PERFIL ${next.kind} ${next.dims.map((d) => d.value).join("x")} #${next.T}` });
        }
        const old = inDoc.map((id) => doc.get(id)!).filter(Boolean);
        const anchor = boxOf(old.filter((e) => p.sectionIds.includes(e.id))) ?? boxOf(old);
        const secBox = boxOf(sec);
        const rev = doc.revision;
        return {
          status: "previa",
          data: resumo,
          preview: {
            title: `Alterar o ${def.name} no desenho (${changes.join("; ")})`,
            details: [
              ...changes.map((c) => `Mudança: ${c}`),
              ...r.flanges.map((f) => `${f.label}: externa ${mm(f.lengthExt)} · interna ${mm(f.lengthInt)}`),
              `Substitui ${old.length} objeto(s) já desenhados por ${sec.length + flat.length} novo(s).`,
              flat.length && p.k ? `Planificação refeita com K = ${p.k.value} (${p.k.source}).` : "",
            ].filter(Boolean),
            destructive: true,
            visual: { entities: [...sec, ...flat] },
            apply: () => {
              const st = stale(ctl, rev);
              if (st) return st;
              const dx = anchor && secBox ? anchor.minX - secBox.minX : 0;
              const dy = anchor && secBox ? anchor.minY - secBox.minY : 0;
              const ns = sec.map((e) => ({ ...transformEntity(e, translation(dx, dy)), id: newId() }) as Entity);
              const fb = boxOf(flat);
              const fx = fb ? (boxOf(ns)?.maxX ?? 0) + 50 - fb.minX : 0;
              const nf = flat.map((e) => ({ ...transformEntity(e, translation(fx, dy)), id: newId() }) as Entity);
              const res = commit(h, `Alterar ${def.name}`, [...doc.removeChanges(old.map((e) => e.id)), ...h.fabLayerChanges(), ...doc.addChanges([...ns, ...nf])], [...ns, ...nf].map((e) => e.id));
              if (res.status === "ok") s.profile = { params: next, sectionIds: ns.map((e) => e.id), flatIds: nf.map((e) => e.id), k: p.k };
              return res;
            },
          },
        };
      },
    },
    {
      name: "gerar_planificacao",
      description:
        "Gera a planificação (blank com linhas de dobra, cotas e regiões de dobra) do perfil criado pela IA, pelo motor AGTN SHEET METAL. EXIGE fator K: informe fator_k (0 a 1) ou usar_k_do_projeto=true (tabela K do projeto). Se o usuário não disse qual, pergunte antes. Precisa do comprimento da peça.",
      risk: "previa",
      parameters: {
        type: "object",
        properties: {
          fator_k: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          usar_k_do_projeto: { type: "boolean" },
          comprimento: { type: "number", exclusiveMinimum: 0, maximum: 20000 },
        },
      },
      run: (a) => {
        const p = s.profile;
        if (!p) return err("Nenhum perfil criado pela IA nesta conversa. Crie o perfil primeiro.");
        const def = PROFILE_DEFS[p.params.kind];
        let K: number;
        let source: string;
        if (typeof a.fator_k === "number") {
          K = a.fator_k;
          source = "informado pelo usuário";
        } else if (a.usar_k_do_projeto === true) {
          const sm = readSM(doc);
          const table = sm.kTables.find((t) => t.id === p.params.fab.kTableId) ?? sm.kTables[0];
          const rule = table ? lookupK(table, { material: p.params.fab.material, process: p.params.fab.process, T: p.params.T, R: p.params.bends[0].R }) : null;
          if (!rule) return ask(`A tabela K do projeto não tem regra para espessura ${p.params.T} mm e raio ${p.params.bends[0].R} mm. Qual fator K devo usar?`);
          K = rule.k;
          source = `tabela do projeto "${table.name}" (${rule.source})`;
        } else {
          const sm = readSM(doc);
          return ask("Antes de gerar a planificação preciso do fator K: informe o valor ou autorize usar o configurado no projeto.", { tabela_do_projeto: sm.kTables[0]?.name ?? null });
        }
        const L = typeof a.comprimento === "number" ? a.comprimento : p.params.partLength;
        if (!(L > 0)) return ask("Qual o comprimento da peça (mm)?");
        const params: ProfileParams = { ...p.params, partLength: L, bends: p.params.bends.map((b) => ({ ...b, K, kSource: "manual" })) };
        const { r, error } = solve(params);
        if (!r || error) return err(`O motor recusou a planificação: ${error}`);
        const title = `PERFIL ${params.kind.replace("_", " ")} ${params.dims.map((d) => d.value).join("x")} #${params.T}`;
        const ents = flatPatternEntities(r, { dims: true, notes: true, bendRegions: true, title });
        const box = boxOf(ents);
        const replacing = p.flatIds.filter((id) => doc.has(id));
        const rev = doc.revision;
        return {
          status: "previa",
          data: { largura_desenvolvida: r3(r.developedLength), comprimento: L, fator_k: K, origem_k: source, dobras: r.bends.map((b) => ({ dobra: b.label, linha_mm: r3(b.xLine), BA: r3(b.BA), BD: r3(b.BD) })) },
          preview: {
            title: `Planificação do ${def.name}${replacing.length ? " (substitui a anterior)" : ""}`,
            details: [
              `Blank: ${mm(r.developedLength)} × ${mm(L)} · espessura ${mm(params.T)}`,
              `Fator K = ${K} (${source})`,
              ...r.bends.map((b) => `${b.label}: linha a ${mm(b.xLine)} · BA ${mm(b.BA)} · BD ${mm(b.BD)}`),
              ...r.issues.filter((i) => i.level === "warning").map((i) => `Aviso: ${i.message}`),
            ],
            destructive: replacing.length > 0,
            visual: { entities: ents },
            apply: () => {
              const st = stale(ctl, rev);
              if (st) return st;
              const secBox = boxOf(p.sectionIds.map((id) => doc.get(id)).filter((e): e is Entity => !!e));
              const at = secBox && box ? { x: secBox.maxX + 50 - box.minX, y: secBox.minY - box.minY } : freeSpot(ctl, box);
              const placed = ents.map((e) => ({ ...transformEntity(e, translation(at.x, at.y)), id: newId() }) as Entity);
              const res = commit(h, `Planificação ${def.name}`, [...doc.removeChanges(replacing), ...h.fabLayerChanges(), ...doc.addChanges(placed)], placed.map((e) => e.id));
              if (res.status === "ok") s.profile = { ...p, params, flatIds: placed.map((e) => e.id), k: { value: K, source } };
              h.showDrawing();
              return res;
            },
          },
        };
      },
    },

    /* ------------------------------------------------ desenho 2D ------------------------------------------------ */
    {
      name: "criar_chapa_retangular",
      description: "Desenha uma chapa retangular (contorno fechado) no desenho 2D, na camada de corte. Opcional: raio de canto e posição do canto inferior esquerdo. Prévia + confirmação.",
      risk: "previa",
      parameters: {
        type: "object",
        properties: {
          largura: { type: "number", exclusiveMinimum: 0, maximum: 50000 },
          altura: { type: "number", exclusiveMinimum: 0, maximum: 50000 },
          raio_canto: { type: "number", minimum: 0, maximum: 5000 },
          x: { type: "number" },
          y: { type: "number" },
          camada: { type: "string", maxLength: 64 },
        },
        required: ["largura", "altura"],
      },
      run: (a) => {
        const W = a.largura as number, H = a.altura as number, R = (a.raio_canto as number) ?? 0;
        if (R * 2 > Math.min(W, H) + 1e-9) return err(`Raio de canto ${R} mm não cabe numa chapa ${W} × ${H} mm (máximo ${Math.min(W, H) / 2} mm).`);
        const b = Math.tan(Math.PI / 8); // bulge de 90°
        const pts: Vec2[] = R > 0
          ? [{ x: R, y: 0 }, { x: W - R, y: 0 }, { x: W, y: R }, { x: W, y: H - R }, { x: W - R, y: H }, { x: R, y: H }, { x: 0, y: H - R }, { x: 0, y: R }]
          : [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
        const bulges = R > 0 ? [0, b, 0, b, 0, b, 0, b] : [0, 0, 0, 0];
        const layer = (a.camada as string) || "CONTORNO_CORTE";
        const shape = makeEntity({ type: "polyline", pts, bulges, closed: true }, layer);
        const area = Math.abs(polylineSignedArea(pts, bulges));
        const given = typeof a.x === "number" && typeof a.y === "number";
        const rev = doc.revision;
        return {
          status: "previa",
          data: { largura: W, altura: H, raio_canto: R, area_mm2: r3(area), perimetro_mm: r3(entityLength(shape)) },
          preview: {
            title: `Chapa ${mm(W)} × ${mm(H)}${R ? ` (cantos R${R})` : ""}`,
            details: [`Área ${r3(area).toLocaleString("pt-BR")} mm² · perímetro ${mm(entityLength(shape))}`, `Camada ${layer}`, given ? `Canto inferior esquerdo em (${a.x}; ${a.y})` : "Posição: livre, à direita do desenho"],
            destructive: false,
            visual: { entities: [shape] },
            apply: () => {
              const st = stale(ctl, rev);
              if (st) return st;
              const at = given ? { x: a.x as number, y: a.y as number } : freeSpot(ctl, { minX: 0, minY: 0, maxX: W, maxY: H });
              const placed = { ...transformEntity(shape, translation(at.x, at.y)), id: newId() } as Entity;
              const layerCh = doc.layer(layer) ? [] : layer === "CONTORNO_CORTE" ? h.fabLayerChanges() : [doc.layerAddChange({ name: layer, color: 7, lineweight: 0.25, linetype: "CONTINUOUS", visible: true, locked: false })];
              const res = commit(h, `Chapa ${W}×${H}`, [...layerCh, ...doc.addChanges([placed])], [placed.id]);
              h.showDrawing();
              return res.status === "ok" ? ok({ ...(res.data as object), posicao: [r3(at.x), r3(at.y)] }) : res;
            },
          },
        };
      },
    },
    {
      name: "criar_folha_a4",
      description: "Cria um formato A4 (moldura com margens NBR 10068: 25 mm à esquerda, 7 mm nas demais) com legenda (título, escala, data, unidade) em escala de desenho. Prévia + confirmação.",
      risk: "previa",
      parameters: {
        type: "object",
        properties: {
          orientacao: { type: "string", enum: ["paisagem", "retrato"] },
          escala: { type: "number", exclusiveMinimum: 0, maximum: 1000, description: "denominador: 1 = 1:1, 5 = 1:5" },
          titulo: { type: "string", maxLength: 80 },
          envolver_selecao: { type: "boolean", description: "centralizar a folha sobre a seleção" },
        },
      },
      run: (a) => {
        const land = a.orientacao !== "retrato";
        const s0 = (a.escala as number) ?? 1;
        const W = (land ? 297 : 210) * s0, H = (land ? 210 : 297) * s0;
        const L = 25 * s0, m = 7 * s0;
        const title = ((a.titulo as string) || "DESENHO").toUpperCase();
        const layer = "FORMATO";
        const rect = (x0: number, y0: number, x1: number, y1: number) => makeEntity({ type: "polyline", pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], bulges: [0, 0, 0, 0], closed: true }, layer);
        const text = (x: number, y: number, h0: number, value: string) => makeEntity({ type: "text", p: { x, y }, h: h0 * s0, rot: 0, value, halign: 0 }, layer);
        const lw = 178 * s0, lh = 32 * s0; // legenda 178 mm (NBR 10582)
        const lx = W - m - lw, ly = m;
        const date = new Date().toLocaleDateString("pt-BR");
        const ents: Entity[] = [
          rect(0, 0, W, H),
          rect(L, m, W - m, H - m),
          rect(lx, ly, W - m, ly + lh),
          makeEntity({ type: "line", a: { x: lx, y: ly + 16 * s0 }, b: { x: W - m, y: ly + 16 * s0 } }, layer),
          makeEntity({ type: "line", a: { x: lx + 118 * s0, y: ly }, b: { x: lx + 118 * s0, y: ly + 16 * s0 } }, layer),
          text(lx + 3 * s0, ly + 24 * s0, 5, "AGTN METALÚRGICA"),
          text(lx + 3 * s0, ly + 18.5 * s0, 3.5, title),
          text(lx + 3 * s0, ly + 9 * s0, 2.5, `ESCALA 1:${s0}   UNIDADE mm   FOLHA A4`),
          text(lx + 3 * s0, ly + 3 * s0, 2.5, `DATA ${date}`),
          text(lx + 121 * s0, ly + 9 * s0, 2.5, "DESENHO:"),
          text(lx + 121 * s0, ly + 3 * s0, 2.5, "VERIFICADO:"),
        ];
        const sel = a.envolver_selecao ? boxOf(ctl.sel.entities()) : null;
        if (a.envolver_selecao && !sel) return ask("Não há seleção para envolver. Selecione as vistas ou peça sem envolver.");
        const usable = { w: W - L - m, h: H - 2 * m - lh };
        if (sel && (sel.maxX - sel.minX > usable.w || sel.maxY - sel.minY > usable.h))
          return ask(`A seleção (${mm(sel.maxX - sel.minX)} × ${mm(sel.maxY - sel.minY)}) não cabe na área útil do A4 em 1:${s0} (${mm(usable.w)} × ${mm(usable.h)}). Qual escala usar?`);
        const rev = doc.revision;
        return {
          status: "previa",
          data: { formato: `A4 ${land ? "paisagem" : "retrato"}`, escala: `1:${s0}`, tamanho_no_desenho: [r3(W), r3(H)] },
          preview: {
            title: `Folha A4 ${land ? "paisagem" : "retrato"}, escala 1:${s0}`,
            details: [`Tamanho no desenho: ${mm(W)} × ${mm(H)} (A4 real × ${s0})`, "Margens NBR 10068 (25 / 7 mm) e legenda 178 mm (NBR 10582)", `Título: ${title}`, sel ? "Centralizada sobre a seleção" : "Posição: livre, à direita do desenho"],
            destructive: false,
            visual: { entities: ents },
            apply: () => {
              const st = stale(ctl, rev);
              if (st) return st;
              const at = sel
                ? { x: (sel.minX + sel.maxX) / 2 - (L + usable.w / 2), y: (sel.minY + sel.maxY) / 2 - (m + lh + usable.h / 2) }
                : freeSpot(ctl, { minX: 0, minY: 0, maxX: W, maxY: H });
              const placed = ents.map((e) => ({ ...transformEntity(e, translation(at.x, at.y)), id: newId() }) as Entity);
              const layerCh = doc.layer(layer) ? [] : [doc.layerAddChange({ name: layer, color: 7, lineweight: 0.5, linetype: "CONTINUOUS", visible: true, locked: false })];
              const res = commit(h, `Folha A4 1:${s0}`, [...layerCh, ...doc.addChanges(placed)], placed.map((e) => e.id));
              h.showDrawing();
              return res;
            },
          },
        };
      },
    },
    {
      name: "mover_selecao",
      description: "Move os objetos selecionados por um deslocamento dx, dy (mm). Altera geometria existente: prévia + confirmação.",
      risk: "previa",
      parameters: { type: "object", properties: { dx: { type: "number" }, dy: { type: "number" } }, required: ["dx", "dy"] },
      run: (a) => {
        const sel = ctl.sel.entities().filter((e) => doc.isEditable(e));
        if (!sel.length) return ask("Selecione os objetos a mover (camadas travadas não contam).");
        const dx = a.dx as number, dy = a.dy as number;
        if (dx === 0 && dy === 0) return err("Deslocamento nulo: nada a mover.");
        const moved = sel.map((e) => transformEntity(e, translation(dx, dy)));
        const rev = doc.revision;
        return {
          status: "previa",
          data: { objetos: sel.length, dx, dy },
          preview: {
            title: `Mover ${sel.length} objeto(s) (${dx}; ${dy}) mm`,
            details: [`Distância ${mm(Math.hypot(dx, dy))}`, ...sel.slice(0, 6).map((e) => `${ENTITY_TYPE_LABEL[e.type]} — camada ${e.layer}`)],
            destructive: true,
            visual: { entities: moved },
            apply: () => {
              const st = stale(ctl, rev);
              if (st) return st;
              return commit(h, `Mover ${sel.length} objeto(s)`, doc.updateChanges(moved), []);
            },
          },
        };
      },
    },
    {
      name: "apagar_selecao",
      description: "Apaga os objetos selecionados. Destrutivo: prévia + confirmação (desfazível pelo Ctrl+Z).",
      risk: "previa",
      parameters: { type: "object", properties: {} },
      run: () => {
        const sel = ctl.sel.entities().filter((e) => doc.isEditable(e));
        if (!sel.length) return ask("Nada selecionado para apagar.");
        const rev = doc.revision;
        const ids = sel.map((e) => e.id);
        const byType: Record<string, number> = {};
        for (const e of sel) byType[ENTITY_TYPE_LABEL[e.type]] = (byType[ENTITY_TYPE_LABEL[e.type]] ?? 0) + 1;
        return {
          status: "previa",
          data: { objetos: sel.length, por_tipo: byType },
          preview: {
            title: `APAGAR ${sel.length} objeto(s)`,
            details: Object.entries(byType).map(([k, v]) => `${v} × ${k}`),
            destructive: true,
            visual: { entities: sel },
            apply: () => {
              const st = stale(ctl, rev);
              if (st) return st;
              const res = commit(h, `Apagar ${ids.length} objeto(s)`, doc.removeChanges(ids), []);
              if (res.status === "ok") ctl.sel.clear();
              return res;
            },
          },
        };
      },
    },

    /* ------------------------------------------------ saída ------------------------------------------------ */
    {
      name: "exportar_dxf",
      description: "Exporta o desenho em DXF. Abre a janela de salvar do Windows (o usuário escolhe o local; a janela pede confirmação se for substituir arquivo). Prévia + confirmação antes de abrir.",
      risk: "previa",
      parameters: { type: "object", properties: {} },
      run: () => {
        if (doc.size === 0) return err("O desenho está vazio: nada para exportar.");
        return {
          status: "previa",
          data: { objetos: doc.size },
          preview: {
            title: "Exportar o desenho em DXF",
            details: [`${doc.size} objeto(s), todas as camadas visíveis`, "Você escolhe o local na janela de salvar; se o arquivo existir, o Windows pede confirmação para substituir."],
            destructive: false,
            apply: async () => {
              const r = await h.exportDxf();
              if (r.ok) return ok({ exportado: true, arquivo: r.path.split(/[\\/]/).pop(), versao_dxf: r.version });
              return r.error ? err(`Falha ao exportar: ${r.error}`) : err("Exportação cancelada na janela de salvar: nenhum arquivo foi gravado.");
            },
          },
        };
      },
    },
    {
      name: "exportar_pdf",
      description: "Abre a janela de Imprimir / PDF do aplicativo com o desenho (o usuário escolhe folha, escala e onde salvar). Prévia + confirmação.",
      risk: "previa",
      parameters: { type: "object", properties: {} },
      run: () => {
        if (doc.size === 0) return err("O desenho está vazio: nada para imprimir.");
        return {
          status: "previa",
          preview: {
            title: "Abrir Imprimir / PDF",
            details: ["Abre a janela de impressão do AGTN; o PDF só é gravado quando você concluir nela."],
            destructive: false,
            apply: () => {
              h.openPlot();
              return ok({ janela_aberta: true, observacao: "o arquivo PDF só existe depois que o usuário concluir na janela de impressão" });
            },
          },
        };
      },
    },
    {
      name: "desfazer_ultima_operacao",
      description: "Desfaz a última operação do desenho (a mesma do Ctrl+Z). Reversível com Refazer.",
      risk: "direta_reversivel",
      parameters: { type: "object", properties: {} },
      run: () => {
        if (!doc.canUndo) return err("Não há operação para desfazer.");
        const label = doc.undoLabel;
        ctl.undo();
        return ok({ desfeito: label, pode_refazer: doc.canRedo });
      },
    },
    {
      name: "enquadrar_desenho",
      description: "Zoom para mostrar todo o desenho (zoom extensão).",
      risk: "direta_reversivel",
      parameters: { type: "object", properties: {} },
      run: () => {
        h.showDrawing();
        ctl.zoomExtents();
        return ok({ enquadrado: true });
      },
    },
  ];
  return tools;
}
