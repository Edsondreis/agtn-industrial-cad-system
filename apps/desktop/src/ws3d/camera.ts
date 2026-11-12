import { Matrix4, Quaternion, Vector3 } from "three";

/**
 * Câmera CAD do AGTN 3D (Z para cima, frente = −Y, direita = +X).
 *
 * Estado mínimo e serializável: alvo, direção de vista (do alvo para o olho), vetor "para cima", tamanho da vista
 * (altura visível em mm, que define o zoom tanto na ortográfica quanto na perspectiva) e tipo de projeção.
 * Toda a matemática fica aqui, sem DOM — testada em Node.
 */
export interface CamState {
  readonly target: Vector3;
  /** unitário, do alvo para o olho */
  readonly dir: Vector3;
  /** unitário, perpendicular a `dir` */
  readonly up: Vector3;
  /** altura visível no plano do alvo (mm) */
  readonly height: number;
  readonly ortho: boolean;
}

export const FOV_DEG = 35;
const TAN_HALF = Math.tan((FOV_DEG * Math.PI) / 360);

export type StdView = "frente" | "tras" | "superior" | "inferior" | "esquerda" | "direita" | "iso";

/** Direção (alvo→olho) e "para cima" de cada vista padrão (projeção do 3º diedro, como SolidWorks/Fusion). */
export const STD_VIEWS: Record<StdView, { dir: [number, number, number]; up: [number, number, number]; label: string; short: string; key: string }> = {
  frente: { dir: [0, -1, 0], up: [0, 0, 1], label: "Frontal", short: "Frente", key: "1" },
  tras: { dir: [0, 1, 0], up: [0, 0, 1], label: "Traseira", short: "Trás", key: "2" },
  esquerda: { dir: [-1, 0, 0], up: [0, 0, 1], label: "Esquerda", short: "Esq.", key: "3" },
  direita: { dir: [1, 0, 0], up: [0, 0, 1], label: "Direita", short: "Dir.", key: "4" },
  superior: { dir: [0, 0, 1], up: [0, 1, 0], label: "Superior", short: "Sup.", key: "5" },
  inferior: { dir: [0, 0, -1], up: [0, -1, 0], label: "Inferior", short: "Inf.", key: "6" },
  iso: { dir: [1, -1, 1], up: [0, 0, 1], label: "Isométrica", short: "Iso", key: "7" },
};

const Z = new Vector3(0, 0, 1);

/** "Para cima" coerente para uma direção qualquer: projeção de +Z; se olhar ao longo de Z, usa a sugestão. */
export function upFor(dir: Vector3, hint?: Vector3): Vector3 {
  const d = dir.clone().normalize();
  if (Math.abs(d.dot(Z)) > 0.9999) {
    const h = (hint ?? new Vector3(0, d.z > 0 ? 1 : -1, 0)).clone();
    h.addScaledVector(d, -h.dot(d));
    if (h.lengthSq() < 1e-12) return new Vector3(0, 1, 0);
    return h.normalize();
  }
  return Z.clone().addScaledVector(d, -Z.dot(d)).normalize();
}

export function stdView(v: StdView, base: CamState): CamState {
  const s = STD_VIEWS[v];
  const dir = new Vector3(...s.dir).normalize();
  return { ...base, dir, up: new Vector3(...s.up).addScaledVector(dir, -new Vector3(...s.up).dot(dir)).normalize() };
}

/** Vista a partir de uma direção arbitrária (cantos e arestas do ViewCube). */
export function viewFromDir(d: [number, number, number], base: CamState): CamState {
  const dir = new Vector3(...d).normalize();
  // em cantos/arestas mantém Z para cima; em superior/inferior exatos usa a convenção das vistas padrão
  const hint = Math.abs(dir.z) > 0.9999 ? new Vector3(0, dir.z > 0 ? 1 : -1, 0) : undefined;
  return { ...base, dir, up: upFor(dir, hint) };
}

export const right = (c: CamState) => new Vector3().crossVectors(c.up, c.dir).normalize();

/** Distância do olho ao alvo na perspectiva para mostrar `height`. */
export const perspDistance = (height: number) => height / 2 / TAN_HALF;

/** Unidades de mundo por pixel no plano do alvo. */
export const worldPerPixel = (c: CamState, viewportH: number) => c.height / Math.max(1, viewportH);

/**
 * Órbita CAD em torno de um pivô (normalmente o ponto da peça sob o cursor no clique).
 * Horizontal gira em torno de +Z do mundo (mantém a peça "em pé"); vertical gira em torno do eixo direito da tela.
 */
export function orbit(c: CamState, dxPx: number, dyPx: number, pivot: Vector3, speed = 0.006): CamState {
  const yaw = new Quaternion().setFromAxisAngle(Z, -dxPx * speed);
  const r = right(c);
  // vertical: limita a elevação a ±90° (passar do zênite inverteria a imagem)
  const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
  const elev = Math.asin(clamp1(c.dir.z));
  const lim = Math.PI / 2;
  // d(dir)/dâng = r × dir = −up → a elevação cai quando o ângulo cresce (o "para cima" é sempre mantido em +Z)
  const sgn = c.up.z < 0 ? 1 : -1;
  let pitchAng = -dyPx * speed;
  const want = Math.max(-lim, Math.min(lim, elev + sgn * pitchAng));
  pitchAng = (want - elev) * sgn;
  const pitch = new Quaternion().setFromAxisAngle(r, pitchAng);
  const q = new Quaternion().multiplyQuaternions(yaw, pitch);
  const dir = c.dir.clone().applyQuaternion(q).normalize();
  let up = c.up.clone().applyQuaternion(q);
  up.addScaledVector(dir, -up.dot(dir));
  up = up.lengthSq() < 1e-12 ? upFor(dir) : up.normalize();
  // em vistas oblíquas mantém o horizonte nivelado (Z sempre "para cima" na tela)
  if (Math.abs(dir.z) < 0.999) {
    const lv = upFor(dir);
    if (lv.dot(up) > 0) up = lv;
  }
  const target = pivot.clone().add(c.target.clone().sub(pivot).applyQuaternion(q));
  return { ...c, dir, up, target };
}

/** Pan: arrasta a cena junto com o cursor (pixels de tela → mm no plano do alvo). */
export function pan(c: CamState, dxPx: number, dyPx: number, viewportH: number): CamState {
  const k = worldPerPixel(c, viewportH);
  const t = c.target.clone().addScaledVector(right(c), -dxPx * k).addScaledVector(c.up, dyPx * k);
  return { ...c, target: t };
}

/**
 * Zoom mantendo fixo o ponto sob o cursor. `ndc` = posição do cursor em coordenadas normalizadas (−1..1).
 * `factor` < 1 aproxima. Limites evitam perder a cena (0,001 mm a 1000 km).
 */
export function zoomAt(c: CamState, factor: number, ndc: { x: number; y: number }, aspect: number): CamState {
  const h = Math.min(1e9, Math.max(1e-3, c.height * factor));
  const f = h / c.height;
  // ponto do plano do alvo sob o cursor fica parado
  const off = right(c).multiplyScalar((ndc.x * c.height * aspect) / 2).addScaledVector(c.up, (ndc.y * c.height) / 2);
  const target = c.target.clone().add(off.multiplyScalar(1 - f));
  return { ...c, height: h, target };
}

/** Enquadra uma esfera envolvente (centro, raio) mantendo a direção de vista. */
export function fitSphere(c: CamState, center: Vector3, radius: number, aspect: number, margin = 1.12): CamState {
  const r = Math.max(radius, 1e-3) * margin;
  const h = aspect >= 1 ? 2 * r : (2 * r) / aspect;
  return { ...c, target: center.clone(), height: h };
}

/** Posição do olho (perspectiva: na distância que mostra `height`; ortográfica: afastado para não cortar a cena). */
export function eyeOf(c: CamState, sceneRadius: number): Vector3 {
  const d = c.ortho ? Math.max(sceneRadius * 4, c.height * 4, 100) : perspDistance(c.height);
  return c.target.clone().addScaledVector(c.dir, d);
}

/** Interpolação suave entre duas vistas (rotação pelo caminho mais curto). t ∈ [0,1]. */
export function lerpCam(a: CamState, b: CamState, t: number): CamState {
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // ease-in-out cúbico
  const qa = basisQuat(a);
  const qb = basisQuat(b);
  const q = qa.clone().slerp(qb, e);
  const m = new Matrix4().makeRotationFromQuaternion(q);
  const dir = new Vector3().setFromMatrixColumn(m, 2).normalize();
  const up = new Vector3().setFromMatrixColumn(m, 1).normalize();
  return {
    target: a.target.clone().lerp(b.target, e),
    dir,
    up,
    height: Math.exp(Math.log(a.height) + (Math.log(b.height) - Math.log(a.height)) * e),
    ortho: t < 1 ? a.ortho : b.ortho,
  };
}

function basisQuat(c: CamState): Quaternion {
  const m = new Matrix4().makeBasis(right(c), c.up, c.dir);
  return new Quaternion().setFromRotationMatrix(m);
}

/** Matriz 3×3 mundo→vista (linhas = direita, cima, dir) — usada pelo ViewCube. */
export function viewRotation(c: CamState): number[] {
  const r = right(c);
  return [r.x, r.y, r.z, c.up.x, c.up.y, c.up.z, c.dir.x, c.dir.y, c.dir.z];
}

export const initialCam = (): CamState => {
  const base: CamState = { target: new Vector3(0, 0, 0), dir: new Vector3(0, -1, 0), up: new Vector3(0, 0, 1), height: 400, ortho: true };
  return stdView("iso", base);
};

/** Nome da vista padrão se a câmera estiver alinhada a uma (para a barra de status). */
export function matchStdView(c: CamState): StdView | null {
  for (const [k, v] of Object.entries(STD_VIEWS) as [StdView, (typeof STD_VIEWS)[StdView]][]) {
    if (new Vector3(...v.dir).normalize().dot(c.dir) > 0.99999) return k;
  }
  return null;
}
