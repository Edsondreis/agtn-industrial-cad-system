#!/usr/bin/env python3
"""
FASE 5 — gera os DXF de cobertura de entidades com o ezdxf (biblioteca INDEPENDENTE do AGTN CAD) e o
JSON de referência com os valores lidos de volta pelo próprio ezdxf. O teste `modules/dxf/src/fase5.test.ts`
lê os mesmos arquivos com o leitor do AGTN e compara.

  R12   : LINE, POLYLINE (com bulge), ARC, CIRCLE, POINT, TEXT, INSERT/BLOCK, DIMENSION, sem $INSUNITS
  R2000 : as 13 entidades (+ LWPOLYLINE, ELLIPSE, SPLINE, MTEXT, HATCH), $INSUNITS=4 (mm), camadas com
          cor, coordenadas negativas e grandes (1e7), entidades não suportadas (3DFACE, RAY, XLINE)
  cm    : R2000 com $INSUNITS=5 (cm) — o leitor converte para mm (×10) e informa a origem

Rodar de novo só se a referência mudar:  python3 tests/dxf/make_fase5_fixtures.py
"""
import json
import math
import pathlib

import ezdxf

HERE = pathlib.Path(__file__).resolve().parent / "fixtures" / "fase5"
HERE.mkdir(parents=True, exist_ok=True)


def layers(doc):
    doc.layers.add("CORTE", color=1)
    doc.layers.add("DOBRA", color=3)
    doc.layers.add("TEXTO", color=5)
    doc.layers.add("COTA", color=2)


def common(doc, msp, *, big=True):
    msp.add_line((-150, -75), (250.5, 125.25), dxfattribs={"layer": "CORTE"})
    msp.add_circle((-40, -40), 12.5, dxfattribs={"layer": "CORTE"})
    msp.add_arc((60, -20), 30, 15, 200, dxfattribs={"layer": "DOBRA"})
    msp.add_point((-3.25, -4.75), dxfattribs={"layer": "0"})
    msp.add_text("PECA A-01 Ø12", dxfattribs={"layer": "TEXTO", "height": 3.5, "insert": (-100, 80)})
    p = msp.add_polyline2d([(0, 0), (100, 0), (100, 50), (0, 50)], close=True, dxfattribs={"layer": "CORTE"})
    p.vertices[1].dxf.bulge = 0.41421356237309503  # 90° no trecho 100,0 → 100,50
    blk = doc.blocks.new(name="FURO10")
    blk.add_circle((0, 0), 5)
    blk.add_line((-7, 0), (7, 0))
    msp.add_blockref("FURO10", (300, -200), dxfattribs={"layer": "CORTE", "rotation": 30, "xscale": 2, "yscale": 2})
    dim = msp.add_linear_dim(base=(0, -30), p1=(0, 0), p2=(100, 0), dxfattribs={"layer": "COTA"})
    dim.render()
    if big:
        msp.add_line((10_000_000, -10_000_000), (10_000_123.456, -9_999_900.5), dxfattribs={"layer": "CORTE"})


# --------------------------------------------------------------------- R12
d12 = ezdxf.new("R12")
layers(d12)
common(d12, d12.modelspace())
d12.saveas(HERE / "cobertura_r12.dxf")

# --------------------------------------------------------------------- R2000
d20 = ezdxf.new("R2000")
d20.header["$INSUNITS"] = 4
layers(d20)
m = d20.modelspace()
common(d20, m)
m.add_lwpolyline([(-200, -100, 0, 0, 0), (-120, -100, 0, 0, -0.5), (-120, -60, 0, 0, 0)], format="xyseb", close=False, dxfattribs={"layer": "DOBRA"})
m.add_ellipse((150, 150), major_axis=(50, 0), ratio=0.5, start_param=0, end_param=math.pi, dxfattribs={"layer": "CORTE"})
m.add_spline([(0, 200), (40, 260), (90, 220), (150, 280)], dxfattribs={"layer": "CORTE"})
m.add_mtext("LINHA 1\\PLINHA 2", dxfattribs={"layer": "TEXTO", "char_height": 2.5, "insert": (-100, 60)})
h = m.add_hatch(color=4, dxfattribs={"layer": "CORTE"})
h.set_pattern_fill("ANSI31", scale=1.0)
h.paths.add_polyline_path([(400, 0), (450, 0), (450, 40), (400, 40)], is_closed=True)
# não suportadas (devem ser contadas e avisadas, nunca simuladas)
m.add_3dface([(0, 0, 0), (10, 0, 0), (10, 10, 5), (0, 10, 5)])
m.add_ray((0, 0), (1, 1))
m.add_xline((5, 5), (1, 0))
d20.saveas(HERE / "cobertura_r2000.dxf")

# --------------------------------------------------------------------- cm
dcm = ezdxf.new("R2000")
dcm.header["$INSUNITS"] = 5
dcm.modelspace().add_line((-1, -2), (3.5, 4.25))
dcm.modelspace().add_circle((10, 10), 2.5)
dcm.saveas(HERE / "unidade_cm.dxf")


# --------------------------------------------------------------------- referência (relida pelo ezdxf)
def xy(v):
    return [float(v.x), float(v.y)]


def ref(path):
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    counts = {}
    for e in msp:
        counts[e.dxftype()] = counts.get(e.dxftype(), 0) + 1
    out = {
        "version": doc.dxfversion,
        "insunits": doc.header.get("$INSUNITS", 0),
        "counts": counts,
        "layers": {l.dxf.name: l.dxf.color for l in doc.layers if l.dxf.name not in ("Defpoints",)},
        "lines": [[*xy(e.dxf.start), *xy(e.dxf.end), e.dxf.layer] for e in msp.query("LINE")],
        "circles": [[*xy(e.dxf.center), e.dxf.radius, e.dxf.layer] for e in msp.query("CIRCLE")],
        "arcs": [[*xy(e.dxf.center), e.dxf.radius, e.dxf.start_angle, e.dxf.end_angle] for e in msp.query("ARC")],
        "points": [xy(e.dxf.location) for e in msp.query("POINT")],
        "texts": [e.dxf.text for e in msp.query("TEXT")],
        "inserts": [[e.dxf.name, *xy(e.dxf.insert), e.dxf.rotation, e.dxf.xscale] for e in msp.query("INSERT")],
    }
    return out


json.dump(
    {f: ref(HERE / f) for f in ("cobertura_r12.dxf", "cobertura_r2000.dxf", "unidade_cm.dxf")},
    open(HERE / "referencia_ezdxf.json", "w"),
    indent=1,
    ensure_ascii=False,
)
print("ok", sorted(p.name for p in HERE.iterdir()))
