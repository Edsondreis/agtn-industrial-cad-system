import { useMemo, useState } from "react";
import { type CamState, right, viewRotation } from "./camera";

type V3 = [number, number, number];

/** Faces do cubo: normal externa N, "direita" U e "para baixo" D como vistas de fora (det[U D N] = −1 → texto não espelhado). */
const FACES: { id: string; label: string; n: V3; u: V3; d: V3 }[] = [
  { id: "frente", label: "FRENTE", n: [0, -1, 0], u: [1, 0, 0], d: [0, 0, -1] },
  { id: "tras", label: "TRÁS", n: [0, 1, 0], u: [-1, 0, 0], d: [0, 0, -1] },
  { id: "direita", label: "DIREITA", n: [1, 0, 0], u: [0, 1, 0], d: [0, 0, -1] },
  { id: "esquerda", label: "ESQUERDA", n: [-1, 0, 0], u: [0, -1, 0], d: [0, 0, -1] },
  { id: "superior", label: "SUPERIOR", n: [0, 0, 1], u: [1, 0, 0], d: [0, -1, 0] },
  { id: "inferior", label: "INFERIOR", n: [0, 0, -1], u: [1, 0, 0], d: [0, 1, 0] },
];

const SIZE = 84; // aresta do cubo (px)
const H = SIZE / 2;
const CELL = [0.22, 0.56, 0.22]; // proporção das faixas: canto | centro | canto

const add = (...v: V3[]): V3 => v.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]);
const mul = (v: V3, k: number): V3 => [v[0] * k, v[1] * k, v[2] * k];
const dirKey = (d: V3) => d.map((x) => Math.sign(Math.round(x))).join(",");

/** matrix3d CSS (coluna-maior) de [U D N | centro]. */
function faceMatrix(u: V3, d: V3, n: V3, c: V3) {
  return `matrix3d(${u[0]},${u[1]},${u[2]},0,${d[0]},${d[1]},${d[2]},0,${n[0]},${n[1]},${n[2]},0,${c[0]},${c[1]},${c[2]},1)`;
}

const DIR_NAME: Record<string, string> = {
  "0,-1,0": "Frontal",
  "0,1,0": "Traseira",
  "1,0,0": "Direita",
  "-1,0,0": "Esquerda",
  "0,0,1": "Superior",
  "0,0,-1": "Inferior",
  "1,-1,1": "Isométrica",
};

/**
 * ViewCube do AGTN 3D. Gira junto com a câmera; clicar numa face, aresta ou canto leva a câmera para aquela
 * direção (animado). Também mostra o tríedro X/Y/Z e o botão de vista inicial.
 */
export function ViewCube({ cam, onDir, onHome, onRoll }: { cam: CamState; onDir: (d: V3) => void; onHome: () => void; onRoll: (deg: number) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const rot = viewRotation(cam);
  const r = right(cam);
  // tela CSS: x direita, y para baixo, z para o observador → S·V com S = diag(1,−1,1)
  const m = [rot[0], -rot[3], rot[6], 0, rot[1], -rot[4], rot[7], 0, rot[2], -rot[5], rot[8], 0, 0, 0, 0, 1];
  const cube = `matrix3d(${m.join(",")})`;

  const cells = useMemo(() => {
    const out: { key: string; face: string; style: React.CSSProperties; dir: V3; kind: "face" | "edge" | "corner"; label?: string }[] = [];
    for (const f of FACES) {
      let y0 = -H;
      for (let j = 0; j < 3; j++) {
        let x0 = -H;
        const hgt = CELL[j] * SIZE;
        for (let i = 0; i < 3; i++) {
          const wid = CELL[i] * SIZE;
          const si = i - 1;
          const sj = j - 1;
          const dir = add(f.n, mul(f.u, si), mul(f.d, sj));
          const kind = si === 0 && sj === 0 ? "face" : si !== 0 && sj !== 0 ? "corner" : "edge";
          const center = add(mul(f.n, H), mul(f.u, x0 + wid / 2), mul(f.d, y0 + hgt / 2));
          out.push({
            key: `${f.id}-${i}${j}`,
            face: f.id,
            dir,
            kind,
            label: kind === "face" ? f.label : undefined,
            style: { width: wid, height: hgt, marginLeft: -wid / 2, marginTop: -hgt / 2, transform: faceMatrix(f.u, f.d, f.n, center) },
          });
          x0 += wid;
        }
        y0 += hgt;
      }
    }
    return out;
  }, []);

  // tríedro: projeção dos eixos do mundo na tela
  const axes: { k: string; c: string; v: V3 }[] = [
    { k: "X", c: "#e06060", v: [1, 0, 0] },
    { k: "Y", c: "#5fbf72", v: [0, 1, 0] },
    { k: "Z", c: "#5b9cf0", v: [0, 0, 1] },
  ];
  const tri = axes
    .map((a) => ({ ...a, x: a.v[0] * r.x + a.v[1] * r.y + a.v[2] * r.z, y: -(a.v[0] * cam.up.x + a.v[1] * cam.up.y + a.v[2] * cam.up.z), z: a.v[0] * cam.dir.x + a.v[1] * cam.dir.y + a.v[2] * cam.dir.z }))
    .sort((a, b) => a.z - b.z);

  // vista alinhada a uma face: setas para as faces vizinhas (como no ViewCube dos CADs comerciais)
  const aligned = [cam.dir.x, cam.dir.y, cam.dir.z].filter((v) => Math.abs(Math.abs(v) - 1) < 1e-6).length === 1;
  const snapAxis = (v: { x: number; y: number; z: number }): V3 => {
    const a = [v.x, v.y, v.z];
    const i = a.reduce((bi, x, k) => (Math.abs(x) > Math.abs(a[bi]) ? k : bi), 0);
    const out: V3 = [0, 0, 0];
    out[i] = Math.sign(a[i]);
    return out;
  };
  const arrows: { k: string; d: V3; label: string }[] = aligned
    ? [
        { k: "up", d: snapAxis(cam.up), label: "Girar para a face de cima" },
        { k: "down", d: snapAxis({ x: -cam.up.x, y: -cam.up.y, z: -cam.up.z }), label: "Girar para a face de baixo" },
        { k: "left", d: snapAxis({ x: -r.x, y: -r.y, z: -r.z }), label: "Girar para a face da esquerda" },
        { k: "right", d: snapAxis(r), label: "Girar para a face da direita" },
      ]
    : [];

  return (
    <>
      <div className="vc" aria-label="ViewCube — clique numa face, aresta ou canto para mudar a vista">
        <div className="vc-stage">
          <div className="vc-cube" style={{ transform: cube }}>
            {cells.map((c) => (
              <div
                key={c.key}
                className={`vc-cell ${c.kind}${hover === dirKey(c.dir) ? " hot" : ""}`}
                style={c.style}
                title={DIR_NAME[dirKey(c.dir)] ?? (c.kind === "corner" ? "Vista de canto" : "Vista de aresta")}
                data-dir={dirKey(c.dir)}
                onMouseEnter={() => setHover(dirKey(c.dir))}
                onMouseLeave={() => setHover(null)}
                onClick={() => onDir(c.dir)}
              >
                {c.label && <span>{c.label}</span>}
              </div>
            ))}
          </div>
        </div>
        {arrows.map((a) => (
          <button key={a.k} className={`vc-arrow ${a.k}`} title={`${a.label} (${DIR_NAME[a.d.join(",")] ?? ""})`} data-dir={a.d.join(",")} onClick={() => onDir(a.d)}>
            <svg viewBox="0 0 10 10">
              <path d="M5 1.5L9 8H1z" />
            </svg>
          </button>
        ))}
        <button className="vc-home" title="Vista inicial (isométrica) — tecla 7 / Home" onClick={onHome}>
          <svg viewBox="0 0 24 24">
            <path d="M4 11l8-7 8 7 M6 9.5V20h12V9.5" />
          </svg>
        </button>
        <button className="vc-roll l" title="Girar a vista 90° (anti-horário)" onClick={() => onRoll(90)}>
          ⟲
        </button>
        <button className="vc-roll r" title="Girar a vista 90° (horário)" onClick={() => onRoll(-90)}>
          ⟳
        </button>
      </div>
      <svg className="triad" viewBox="-40 -40 80 80" aria-label="Eixos X, Y, Z">
        {tri.map((a) => (
          <g key={a.k} opacity={a.z < -0.2 ? 0.55 : 1}>
            <line x1={0} y1={0} x2={a.x * 26} y2={a.y * 26} stroke={a.c} strokeWidth={2.2} strokeLinecap="round" />
            <text x={a.x * 34} y={a.y * 34 + 4} fill={a.c} fontSize={11} fontWeight={700} textAnchor="middle">
              {a.k}
            </text>
          </g>
        ))}
        <circle r={2.5} fill="#cfd6df" />
      </svg>
    </>
  );
}
