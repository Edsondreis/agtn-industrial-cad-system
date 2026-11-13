"""FASE 4 · ETAPA 4 — auditoria automática dos 20 DXF de referência (leitor independente: ezdxf).

Gera os arquivos com `npx vitest run modules/sheet3d/src/industrial` (vão para tests/output/industrial/) e depois:
    python3 tests/industrial/auditoria_dxf.py
Saída: tests/output/industrial/auditoria_dxf.json e .md

ISTO NÃO É HOMOLOGAÇÃO EM CAD/CAM: confere a estrutura do arquivo com outro leitor. A abertura no ZWCAD, no AutoCAD e no
CAM do laser continua obrigatória (fichas em tests/industrial/FICHA_CAD.md e FICHA_CAM_LASER.md).
"""
import glob, json, math, os, sys
from collections import Counter
import ezdxf
from ezdxf import recover

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR = os.path.join(ROOT, "tests", "output", "industrial")
RES = json.load(open(os.path.join(DIR, "resultados.json"), encoding="utf-8"))
BY_ID = {r["id"]: r for r in RES}
CUT = {"CUT_OUTER", "CUT_INNER"}
EXPECT_LAYERS = {"CUT_OUTER", "CUT_INNER", "BEND_UP", "BEND_DOWN", "BEND_MARK", "BEND_REGION", "REFERENCE"}
TOL = 1e-6


def xy(v):
    return (float(v[0]), float(v[1]))


def pts_of(e):
    t = e.dxftype()
    if t == "LINE":
        return [xy(e.dxf.start), xy(e.dxf.end)]
    if t == "LWPOLYLINE":
        return [(p[0], p[1]) for p in e.get_points("xy")]
    if t == "POLYLINE":
        return [(v.dxf.location[0], v.dxf.location[1]) for v in e.vertices]
    if t == "CIRCLE":
        c, r = e.dxf.center, e.dxf.radius
        return [(c[0] - r, c[1] - r), (c[0] + r, c[1] + r)]
    if t in ("TEXT", "MTEXT"):
        return [xy(e.dxf.insert)]
    return []


def sig(e):
    t = e.dxftype()
    r = lambda v: round(v, 6)
    if t == "LINE":
        a, b = sorted([tuple(map(r, xy(e.dxf.start))), tuple(map(r, xy(e.dxf.end)))])
        return (t, e.dxf.layer, a, b)
    if t == "CIRCLE":
        return (t, e.dxf.layer, tuple(map(r, xy(e.dxf.center))), r(e.dxf.radius))
    if t in ("LWPOLYLINE", "POLYLINE"):
        ps = tuple(tuple(map(r, p)) for p in pts_of(e))
        return (t, e.dxf.layer, ps)
    return (t, e.dxf.layer, id(e))


def poly_segments(e):
    """segmentos de polilinha: comprimento de cada trecho (micro-segmento) e se fecha"""
    ps = pts_of(e)
    closed = e.is_closed
    segs = list(zip(ps, ps[1:] + ([ps[0]] if closed else [])))
    return [math.dist(a, b) for a, b in segs], closed


rows = []
for f in sorted(glob.glob(os.path.join(DIR, "*.dxf"))):
    name = os.path.basename(f)
    pid = name.rsplit("_R", 1)[0]
    ref = BY_ID.get(pid, {})
    doc, aud = recover.readfile(f)
    msp = list(doc.modelspace())
    layers = Counter(e.dxf.layer for e in msp)
    types = Counter(e.dxftype() for e in msp)
    cut = [e for e in msp if e.dxf.layer in CUT]
    open_cut = [e for e in cut if e.dxftype() in ("LWPOLYLINE", "POLYLINE") and not e.is_closed]
    loose_cut = [e for e in cut if e.dxftype() not in ("LWPOLYLINE", "POLYLINE", "CIRCLE")]
    micro = 0
    for e in cut:
        if e.dxftype() in ("LWPOLYLINE", "POLYLINE"):
            ls, _ = poly_segments(e)
            micro += sum(1 for x in ls if x < 1e-4)
    sigs = Counter(sig(e) for e in msp)
    dup = sum(n - 1 for n in sigs.values() if n > 1)
    allp = [p for e in cut for p in pts_of(e)]
    xs, ys = [p[0] for p in allp], [p[1] for p in allp]
    ext = (min(xs), min(ys), max(xs), max(ys)) if allp else None
    w, h = (ext[2] - ext[0], ext[3] - ext[1]) if ext else (None, None)
    bw, bh = ref.get("blank", [None, None])
    texts = [(e.dxf.layer, e.dxf.text if e.dxftype() == "TEXT" else e.text) for e in msp if e.dxftype() in ("TEXT", "MTEXT")]
    bend_lines = sum(layers[l] for l in ("BEND_UP", "BEND_DOWN"))
    exp_bend = sum(b["trechosLinha"] for b in ref.get("dobrasTabela", []))
    chk = {
        "estrutura_ezdxf_sem_erro": len(aud.errors) == 0 and len(aud.fixes) == 0,
        "unidade_mm": (doc.header.get("$INSUNITS") == 4) if doc.dxfversion != "AC1009" else None,
        "origem_no_canto_do_blank": bool(ext) and abs(ext[0]) < TOL and abs(ext[1]) < TOL,
        "escala_1_1_blank": bool(ext) and bw is not None and abs(w - bw) < TOL and abs(h - bh) < TOL,
        "um_contorno_externo": layers["CUT_OUTER"] == 1,
        "internos_iguais_ao_modelo": layers["CUT_INNER"] == ref.get("contornos", {}).get("internos", -1),
        "cortes_fechados": not open_cut,
        "sem_corte_solto": not loose_cut,
        "sem_micro_segmento": micro == 0,
        "sem_duplicado": dup == 0,
        "linhas_de_dobra": bend_lines == exp_bend,
        "camadas_conhecidas": set(layers) <= EXPECT_LAYERS,
        "texto_fora_do_corte": all(l not in CUT for l, _ in texts),
        "texto_so_em_REFERENCE_ou_BEND_MARK": all(l in ("REFERENCE", "BEND_MARK") for l, _ in texts),
    }
    rows.append({
        "arquivo": name, "versao": doc.dxfversion, "insunits": doc.header.get("$INSUNITS"),
        "extensao_corte": ext, "blank_modelo": [bw, bh], "camadas": dict(layers), "tipos": dict(types),
        "textos": texts, "duplicados": dup, "micro_segmentos": micro, "cortes_abertos": len(open_cut),
        "linhas_dobra": [bend_lines, exp_bend], "conferencias": chk,
        "ok": all(v is not False for v in chk.values()),
    })
    rows[-1]["conferencias"] = {k: (None if v is None else bool(v)) for k, v in chk.items()}
    rows[-1]["ok"] = all(v is not False for v in rows[-1]["conferencias"].values())
    _ = ({
    })

json.dump(rows, open(os.path.join(DIR, "auditoria_dxf.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o))
names = list(rows[0]["conferencias"]) if rows else []
md = ["| Arquivo | " + " | ".join(n.replace("_", " ") for n in names) + " |", "|---|" + "---|" * len(names)]
for r in rows:
    md.append(f"| {r['arquivo']} | " + " | ".join("ok" if v else ("n/a" if v is None else "**FALHA**") for v in r["conferencias"].values()) + " |")
open(os.path.join(DIR, "auditoria_dxf.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
ok = sum(r["ok"] for r in rows)
print(f"{ok}/{len(rows)} arquivos sem falha · conferências por arquivo: {len(names)}")
for r in rows:
    if not r["ok"]:
        print("FALHA", r["arquivo"], [k for k, v in r["conferencias"].items() if v is False])
sys.exit(0 if rows and ok == len(rows) else 1)
