#!/usr/bin/env python3
"""
Gera tests/dxf/fixtures/curvas.dxf + curvas.expected.json com o ezdxf (biblioteca independente).

O JSON guarda a geometria calculada pelo PRÓPRIO ezdxf (pontos das curvas, área e comprimento total
dos traços de cada hachura) para o teste do leitor do AGTN CAD comparar. Rodar de novo só se o
arquivo de referência precisar mudar:  python3 tests/dxf/make_curves_fixture.py
"""
import json
import math
import pathlib

import ezdxf
from ezdxf import path as ezpath
from ezdxf.render import hatching

HERE = pathlib.Path(__file__).resolve().parent / "fixtures"
HERE.mkdir(exist_ok=True)

doc = ezdxf.new("R2018", setup=True)
doc.header["$INSUNITS"] = 4
msp = doc.modelspace()

msp.add_ellipse((100, 50), major_axis=(40, 30), ratio=0.4, dxfattribs={"layer": "ELIPSE"})
msp.add_ellipse((300, 50), major_axis=(0, 25), ratio=0.6, start_param=0.3, end_param=4.0, dxfattribs={"layer": "ELIPSE"})
fit = [(0, 200), (40, 260), (90, 220), (150, 280), (210, 210)]
msp.add_spline(fit, dxfattribs={"layer": "SPLINE"})
msp.add_open_spline([(300, 200), (330, 280), (380, 180), (420, 260), (460, 200)], degree=3, dxfattribs={"layer": "SPLINE"})
msp.add_rational_spline([(500, 200), (540, 280), (600, 200)], weights=[1, 0.7071067811865476, 1], degree=2, dxfattribs={"layer": "SPLINE"})

# 1) ANSI31 com contorno de polilinha (arco por bulge) e furo circular
h1 = msp.add_hatch(color=1, dxfattribs={"layer": "HACH"})
h1.set_pattern_fill("ANSI31", scale=2.0, angle=0)
h1.paths.add_polyline_path([(0, 400, 0), (200, 400, 0.5), (200, 500, 0), (0, 500, 0)], is_closed=True, flags=1)
e = h1.paths.add_edge_path(flags=16)
e.add_arc((60, 450), 20, 0, 360, ccw=True)

# 2) NET com arestas: linha, arco anti-horário, linha, arco horário
h2 = msp.add_hatch(color=3, dxfattribs={"layer": "HACH"})
h2.set_pattern_fill("NET", scale=1.5, angle=15)
p = h2.paths.add_edge_path(flags=1)
p.add_line((300, 400), (400, 400))
p.add_arc((400, 430), 30, -90, 90, ccw=True)
p.add_line((400, 460), (300, 460))
p.add_arc((300, 430), 30, 90, 270, ccw=False)

# 3) sólida com aresta elíptica
h3 = msp.add_hatch(color=5, dxfattribs={"layer": "HACH"})
h3.set_solid_fill(color=5)
q = h3.paths.add_edge_path(flags=1)
q.add_line((500, 400), (600, 400))
q.add_ellipse((550, 400), major_axis=(50, 0), ratio=0.5, start_angle=0, end_angle=180, ccw=True)

# 4) DASH com aresta spline
h4 = msp.add_hatch(color=2, dxfattribs={"layer": "HACH"})
h4.set_pattern_fill("DASH", scale=1.0, angle=30)
r = h4.paths.add_edge_path(flags=1)
r.add_line((700, 400), (800, 400))
r.add_spline(fit_points=[(800, 400), (790, 450), (750, 480), (700, 400)], control_points=None)
# aresta spline só com fit points não é desenhada por todos; usar pontos de controle explícitos
r.edges.pop()
r.add_spline(control_points=[(800, 400), (810, 470), (720, 500), (700, 400)], knot_values=[0, 0, 0, 0, 1, 1, 1, 1], degree=3)

m = msp.add_mtext("LINHA 1\\PSEGUNDA LINHA\\P{\\H2;tres}", dxfattribs={"layer": "TEXTO", "char_height": 5, "insert": (0, 700)})
m.dxf.attachment_point = 1
m2 = msp.add_mtext("CENTRO\\PMEIO", dxfattribs={"layer": "TEXTO", "char_height": 4, "insert": (300, 700)})
m2.dxf.attachment_point = 5

doc.saveas(HERE / "curvas.dxf")

def poly_area(poly):
    a = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i - 1]
        x2, y2 = poly[i]
        a += x1 * y2 - x2 * y1
    return a / 2

def inside(pt, poly):
    x, y = pt
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c

exp = {"ellipses": [], "splines": [], "hatches": []}
doc2 = ezdxf.readfile(HERE / "curvas.dxf")
for ent in doc2.modelspace():
    t = ent.dxftype()
    if t == "ELLIPSE":
        ct = ent.construction_tool()
        exp["ellipses"].append([[v.x, v.y] for v in ct.flattening(0.001)])
    elif t == "SPLINE":
        exp["splines"].append([[v.x, v.y] for v in ent.construction_tool().flattening(0.001)])
    elif t == "HATCH":
        polys = []
        for pth in ezpath.from_hatch(ent):
            polys.append([[v.x, v.y] for v in pth.flattening(0.001)])
        area = 0.0
        for i, poly in enumerate(polys):
            depth = sum(1 for j, o in enumerate(polys) if j != i and inside(poly[0], o))
            area += (1 if depth % 2 == 0 else -1) * abs(poly_area(poly))
        total = 0.0
        if ent.has_pattern_fill:
            for a, b in hatching.hatch_entity(ent):
                total += math.dist((a.x, a.y), (b.x, b.y))
        exp["hatches"].append({"solid": bool(ent.dxf.solid_fill), "area": area, "patternLength": total, "pattern": ent.dxf.pattern_name})
(HERE / "curvas.expected.json").write_text(json.dumps(exp))
print({k: len(v) for k, v in exp.items()}, [h["area"] for h in exp["hatches"]], [h["patternLength"] for h in exp["hatches"]])
