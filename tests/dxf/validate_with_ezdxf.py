#!/usr/bin/env python3
"""
Validação independente dos DXF gerados pelo AGTN CAD usando o ezdxf (leitor/auditor DXF de terceiros).

Uso:
    npm test                       # gera tests/output/*.dxf
    pip install ezdxf
    python3 tests/dxf/validate_with_ezdxf.py

Verifica: leitura sem erros, auditoria sem erros, camadas esperadas, contorno de corte fechado
e dimensões da planificação.
"""
import pathlib
import sys

import ezdxf
from ezdxf import recover

OUT = pathlib.Path(__file__).resolve().parents[1] / "output"


def check(path: pathlib.Path) -> bool:
    doc, auditor = recover.readfile(str(path))
    ok = not auditor.has_errors
    msp = doc.modelspace()
    kinds = {}
    for e in msp:
        kinds[e.dxftype()] = kinds.get(e.dxftype(), 0) + 1
    print(f"\n{path.name}: versão={doc.dxfversion} entidades={kinds}")
    print(f"  camadas: {[l.dxf.name for l in doc.layers]}")
    if auditor.has_errors:
        for err in auditor.errors:
            print("  ERRO:", err.message)
    if path.name.startswith("planificacao"):
        cut = [e for e in msp if e.dxf.layer == "CONTORNO_CORTE"]
        assert len(cut) == 1, "deve existir exatamente um contorno de corte"
        pl = cut[0]
        assert pl.dxftype() == "POLYLINE" and pl.is_closed, "contorno deve ser POLYLINE fechada"
        xs = [v.dxf.location.x for v in pl.vertices]
        ys = [v.dxf.location.y for v in pl.vertices]
        print(f"  contorno: {max(xs) - min(xs):.6f} x {max(ys) - min(ys):.6f} mm (fechado)")
        bends = [e for e in msp if e.dxf.layer == "LINHAS_DOBRA"]
        print(f"  linhas de dobra: {[round(b.dxf.start.x, 6) for b in bends]}")
        assert all(b.dxftype() == "LINE" for b in bends)
    if path.name.startswith("chapa3d_"):
        # ETAPA 2.6: DXF direto da planificação da chapa 3D
        layers = {l.dxf.name for l in doc.layers}
        for need in ("CUT_OUTER", "CUT_INNER", "BEND_UP", "BEND_DOWN", "BEND_MARK", "BEND_REGION", "REFERENCE"):
            assert need in layers, f"camada {need} ausente"
        outer = [e for e in msp if e.dxf.layer == "CUT_OUTER"]
        assert len(outer) == 1, "deve existir exatamente um contorno externo"
        pl = outer[0]
        closed = pl.closed if pl.dxftype() == "LWPOLYLINE" else pl.is_closed
        assert closed, "contorno externo deve ser fechado"
        pts = list(pl.get_points("xy")) if pl.dxftype() == "LWPOLYLINE" else [(v.dxf.location.x, v.dxf.location.y) for v in pl.vertices]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        assert abs(min(xs)) < 1e-9 and abs(min(ys)) < 1e-9, "origem no canto do blank"
        inner = [e for e in msp if e.dxf.layer == "CUT_INNER"]
        for e in inner:
            if e.dxftype() in ("LWPOLYLINE", "POLYLINE"):
                assert (e.closed if e.dxftype() == "LWPOLYLINE" else e.is_closed), "contorno interno aberto"
        if "R2000" in path.name:
            assert doc.header.get("$INSUNITS") == 4, "R2000 deve ter $INSUNITS = 4 (mm)"
        bends = [e for e in msp if e.dxf.layer in ("BEND_UP", "BEND_DOWN")]
        assert all(b.dxftype() == "LINE" for b in bends)
        print(f"  chapa 3D: blank {max(xs):.6f} x {max(ys):.6f} mm · internos {len(inner)} · dobras {len(bends)} · INSUNITS {doc.header.get('$INSUNITS')}")
    return ok


def main() -> int:
    files = sorted(OUT.glob("*.dxf"))
    if not files:
        print("Nenhum DXF em tests/output — rode `npm test` antes.")
        return 1
    print(f"ezdxf {ezdxf.__version__}")
    results = [check(f) for f in files]
    if all(results):
        print("\nOK: todos os arquivos passaram na auditoria do ezdxf.")
        return 0
    print("\nFALHA: há erros de auditoria.")
    return 2


if __name__ == "__main__":
    sys.exit(main())
