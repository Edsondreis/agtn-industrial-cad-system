import { Vector3 } from "three";
import { STD_VIEWS, type StdView, eyeOf, fitSphere, initialCam, lerpCam, matchStdView, orbit, pan, right, stdView, viewFromDir, zoomAt } from "./camera";

const close = (a: Vector3, b: Vector3, eps = 1e-9) => expect(a.distanceTo(b)).toBeLessThan(eps);

describe("câmera CAD", () => {
  it("vistas padrão: direção, para-cima ortogonal e reconhecimento", () => {
    const base = initialCam();
    for (const v of Object.keys(STD_VIEWS) as StdView[]) {
      const c = stdView(v, base);
      expect(Math.abs(c.dir.dot(c.up))).toBeLessThan(1e-12);
      expect(c.up.length()).toBeCloseTo(1, 12);
      expect(matchStdView(c)).toBe(v);
    }
    // frontal: olho em −Y, X para a direita, Z para cima
    const f = stdView("frente", base);
    close(right(f), new Vector3(1, 0, 0));
    close(f.up, new Vector3(0, 0, 1));
    // superior: X para a direita, Y para cima
    const t = stdView("superior", base);
    close(right(t), new Vector3(1, 0, 0));
    close(t.up, new Vector3(0, 1, 0));
  });

  it("órbita em torno do pivô mantém a distância ao pivô e o horizonte nivelado", () => {
    const c0 = { ...stdView("iso", initialCam()), target: new Vector3(100, 50, 0) };
    const pivot = new Vector3(0, 0, 0);
    const c1 = orbit(c0, 120, -40, pivot);
    expect(c1.target.distanceTo(pivot)).toBeCloseTo(c0.target.distanceTo(pivot), 9);
    expect(Math.abs(right(c1).z)).toBeLessThan(1e-9); // eixo direito da tela horizontal
    expect(c1.up.z).toBeGreaterThan(0);
  });

  it("órbita vertical para no zênite, sem virar a imagem", () => {
    let c = stdView("frente", initialCam());
    for (let i = 0; i < 50; i++) c = orbit(c, 0, 80, c.target);
    expect(c.dir.z).toBeLessThanOrEqual(1 + 1e-12);
    expect(c.dir.z).toBeGreaterThan(0.999);
    let d = stdView("frente", initialCam());
    for (let i = 0; i < 50; i++) d = orbit(d, 0, -80, d.target);
    expect(d.dir.z).toBeLessThan(-0.999);
  });

  it("pan acompanha o cursor: 100 px numa vista de 400 mm em 800 px = 50 mm", () => {
    const c = { ...stdView("frente", initialCam()), height: 400 };
    const p = pan(c, 100, 0, 800);
    close(p.target, new Vector3(-50, 0, 0));
  });

  it("zoom no cursor: o ponto sob o cursor fica fixo", () => {
    const c = { ...stdView("frente", initialCam()), height: 200 };
    const aspect = 1.5;
    const ndc = { x: 0.5, y: -0.25 };
    const world = (cc: typeof c) => cc.target.clone().addScaledVector(right(cc), (ndc.x * cc.height * aspect) / 2).addScaledVector(cc.up, (ndc.y * cc.height) / 2);
    const before = world(c);
    const z = zoomAt(c, 0.5, ndc, aspect);
    expect(z.height).toBe(100);
    close(world(z), before, 1e-9);
  });

  it("enquadrar: altura cobre o diâmetro com margem, também em tela vertical", () => {
    const c = fitSphere(initialCam(), new Vector3(10, 20, 30), 100, 16 / 9, 1);
    expect(c.height).toBe(200);
    close(c.target, new Vector3(10, 20, 30));
    const v = fitSphere(initialCam(), new Vector3(), 100, 9 / 16, 1);
    expect(v.height * (9 / 16)).toBeCloseTo(200, 9); // largura visível = diâmetro
  });

  it("ViewCube: canto (1,−1,1) = isométrica; arestas mantêm Z para cima", () => {
    const iso = viewFromDir([1, -1, 1], initialCam());
    expect(matchStdView(iso)).toBe("iso");
    const edge = viewFromDir([1, 0, 1], initialCam());
    expect(Math.abs(right(edge).z)).toBeLessThan(1e-12);
    const top = viewFromDir([0, 0, 1], initialCam());
    close(top.up, new Vector3(0, 1, 0));
  });

  it("transição suave termina exatamente na vista pedida", () => {
    const a = stdView("iso", initialCam());
    const b = { ...stdView("superior", a), height: 50, target: new Vector3(5, 5, 5) };
    const m = lerpCam(a, b, 0.5);
    expect(Math.abs(m.dir.dot(m.up))).toBeLessThan(1e-9);
    const e = lerpCam(a, b, 1);
    close(e.dir, b.dir, 1e-9);
    close(e.up, b.up, 1e-9);
    expect(e.height).toBeCloseTo(50, 9);
  });

  it("olho da ortográfica fica fora da cena", () => {
    const c = { ...initialCam(), height: 10 };
    expect(eyeOf(c, 5000).distanceTo(c.target)).toBeGreaterThan(5000);
  });
});
