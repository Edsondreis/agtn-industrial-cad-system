import type { Tool, ToolHost } from "./tools/base";
import { ArcTool, CircleTool, LineTool, PointTool, PolygonTool, PolylineTool, RectTool, TextTool } from "./tools/draw";
import {
  ChamferTool,
  CopyTool,
  EraseTool,
  ExplodeTool,
  ExtendTool,
  FilletTool,
  JoinTool,
  MirrorTool,
  MoveTool,
  OffsetTool,
  RotateTool,
  ScaleTool,
  StretchTool,
  TrimTool,
} from "./tools/modify";
import { DimAlignedTool, DimAngularTool, DimDiameterTool, DimLinearTool, DimRadialTool, DistTool, ZoomTool } from "./tools/annotate";

export type ToolFactory = (h: ToolHost) => Tool;

export interface CommandDef {
  id: string;
  label: string;
  /** apelidos aceitos na linha de comando (o primeiro é o atalho exibido) */
  aliases: string[];
  group: "draw" | "modify" | "annotate" | "measure" | "view";
  tool: ToolFactory;
  hint: string;
}

/**
 * Comandos com ferramenta interativa. Atalhos seguem a convenção consagrada em CAD 2D
 * (L, C, REC, PL, M, CO, RO, O, TR, EX, E, Z...) e não conflitam com Ctrl+Z/Ctrl+Y/Ctrl+S,
 * pois letras só são enviadas à linha de comando (confirmadas com Enter/Espaço).
 */
export const COMMANDS: CommandDef[] = [
  { id: "LINE", label: "Linha", aliases: ["L", "LINE", "LINHA"], group: "draw", tool: (h) => new LineTool(h), hint: "Segmentos de reta encadeados" },
  { id: "PLINE", label: "Polilinha", aliases: ["PL", "PLINE", "POLILINHA"], group: "draw", tool: (h) => new PolylineTool(h), hint: "Polilinha com trechos retos e em arco" },
  { id: "RECTANG", label: "Retângulo", aliases: ["REC", "RECTANG", "RETANGULO"], group: "draw", tool: (h) => new RectTool(h), hint: "Retângulo por dois cantos" },
  { id: "CIRCLE", label: "Círculo", aliases: ["C", "CIRCLE", "CIRCULO"], group: "draw", tool: (h) => new CircleTool(h), hint: "Centro + raio/diâmetro, ou 3 pontos" },
  { id: "ARC", label: "Arco", aliases: ["A", "ARC", "ARCO"], group: "draw", tool: (h) => new ArcTool(h), hint: "3 pontos ou centro/início/fim" },
  { id: "POLYGON", label: "Polígono", aliases: ["POL", "POLYGON", "POLIGONO"], group: "draw", tool: (h) => new PolygonTool(h), hint: "Polígono regular inscrito/circunscrito" },
  { id: "POINT", label: "Ponto", aliases: ["PO", "POINT", "PONTO"], group: "draw", tool: (h) => new PointTool(h), hint: "Ponto de referência" },
  { id: "TEXT", label: "Texto de anotação", aliases: ["DT", "TEXT", "TA"], group: "annotate", tool: (h) => new TextTool(h), hint: "Texto de anotação (não é corte)" },
  { id: "MOVE", label: "Mover", aliases: ["M", "MOVE", "MOVER"], group: "modify", tool: (h) => new MoveTool(h), hint: "Desloca objetos" },
  { id: "COPY", label: "Copiar", aliases: ["CO", "CP", "COPY", "COPIAR"], group: "modify", tool: (h) => new CopyTool(h), hint: "Cópias múltiplas" },
  { id: "ROTATE", label: "Rotacionar", aliases: ["RO", "ROTATE", "ROTACIONAR"], group: "modify", tool: (h) => new RotateTool(h), hint: "Rotação em torno de um ponto" },
  { id: "SCALE", label: "Escala", aliases: ["SC", "SCALE", "ESCALA"], group: "modify", tool: (h) => new ScaleTool(h), hint: "Escala uniforme (fator ou referência)" },
  { id: "MIRROR", label: "Espelhar", aliases: ["MI", "MIRROR", "ESPELHAR"], group: "modify", tool: (h) => new MirrorTool(h), hint: "Espelho por eixo" },
  { id: "OFFSET", label: "Offset", aliases: ["O", "OFFSET"], group: "modify", tool: (h) => new OffsetTool(h), hint: "Cópia paralela a distância" },
  { id: "TRIM", label: "Trim", aliases: ["TR", "TRIM", "APARAR"], group: "modify", tool: (h) => new TrimTool(h), hint: "Apara trechos entre interseções" },
  { id: "EXTEND", label: "Extend", aliases: ["EX", "EXTEND", "ESTENDER"], group: "modify", tool: (h) => new ExtendTool(h), hint: "Estende até o limite mais próximo" },
  { id: "FILLET", label: "Fillet", aliases: ["F", "FILLET", "CONCORDAR"], group: "modify", tool: (h) => new FilletTool(h), hint: "Concordância com raio entre linhas" },
  { id: "CHAMFER", label: "Chanfro", aliases: ["CHA", "CHAMFER", "CHANFRO"], group: "modify", tool: (h) => new ChamferTool(h), hint: "Chanfro por duas distâncias" },
  { id: "STRETCH", label: "Stretch", aliases: ["S", "STRETCH", "ESTICAR"], group: "modify", tool: (h) => new StretchTool(h), hint: "Estica pontos dentro de janela de cruzamento" },
  { id: "EXPLODE", label: "Explodir", aliases: ["X", "EXPLODE", "EXPLODIR"], group: "modify", tool: (h) => new ExplodeTool(h), hint: "Decompõe polilinhas e cotas" },
  { id: "JOIN", label: "Unir", aliases: ["J", "JOIN", "UNIR"], group: "modify", tool: (h) => new JoinTool(h), hint: "Une linhas/arcos encadeados em polilinha" },
  { id: "ERASE", label: "Apagar", aliases: ["E", "ERASE", "APAGAR"], group: "modify", tool: (h) => new EraseTool(h), hint: "Exclui objetos (tecla Delete)" },
  { id: "DIMLINEAR", label: "Cota linear", aliases: ["DLI", "DIMLINEAR"], group: "annotate", tool: (h) => new DimLinearTool(h), hint: "Horizontal/vertical (H/V)" },
  { id: "DIMALIGNED", label: "Cota alinhada", aliases: ["DAL", "DIMALIGNED", "DIM"], group: "annotate", tool: (h) => new DimAlignedTool(h), hint: "Paralela aos pontos" },
  { id: "DIMANGULAR", label: "Cota angular", aliases: ["DAN", "DIMANGULAR"], group: "annotate", tool: (h) => new DimAngularTool(h), hint: "Ângulo entre duas linhas" },
  { id: "DIMRADIUS", label: "Cota de raio", aliases: ["DRA", "DIMRADIUS"], group: "annotate", tool: (h) => new DimRadialTool(h), hint: "Raio de arco/círculo" },
  { id: "DIMDIAMETER", label: "Cota de diâmetro", aliases: ["DDI", "DIMDIAMETER"], group: "annotate", tool: (h) => new DimDiameterTool(h), hint: "Diâmetro de arco/círculo" },
  { id: "DIST", label: "Medir distância", aliases: ["DI", "DIST", "MEDIR"], group: "measure", tool: (h) => new DistTool(h), hint: "Distância, ΔX, ΔY e ângulo" },
  { id: "ZOOM", label: "Zoom", aliases: ["Z", "ZOOM"], group: "view", tool: (h) => new ZoomTool(h), hint: "Extensão, janela ou fator" },
];

const BY_ALIAS = new Map<string, CommandDef>();
for (const c of COMMANDS) for (const a of c.aliases) BY_ALIAS.set(a, c);

export const findCommand = (word: string): CommandDef | undefined => BY_ALIAS.get(word.toUpperCase());
export const commandById = (id: string): CommandDef | undefined => COMMANDS.find((c) => c.id === id);
