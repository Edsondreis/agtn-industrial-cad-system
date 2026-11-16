# Matriz: arquivo ORIGINAL, só a ordem cíclica (ponto de partida) dos laços das faces de revolução muda
import itertools, os, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, "../../.."))
src=open(os.path.join(ROOT, "tests/step/viewer_ref/vessel_revolved.step")).read()
outer=("#146 = EDGE_LOOP('',(#147,#148,#172));",["#147","#148","#172"])
inner=("#234 = EDGE_LOOP('',(#235,#236,#260));",["#235","#236","#260"])
def rot(l,k): return l[k:]+l[:k]
for ko in range(3):
  for ki in range(3):
    s=src.replace(outer[0],"#146 = EDGE_LOOP('',(%s));"%",".join(rot(outer[1],ko))).replace(inner[0],"#234 = EDGE_LOOP('',(%s));"%",".join(rot(inner[1],ki)))
    open("_r.step","w").write(s)
    out=subprocess.run(["node", os.path.join(HERE, "00_sonda_faces.mjs"), ROOT, "_r.step"],capture_output=True,text=True).stdout.splitlines()
    v=[l for l in out if l.startswith("valid")][0]; faces=[l.split(" area=")[1].split(" ")[0] for l in out if "revolution" in l]
    print(f"externo começa em {rot(outer[1],ko)[0]}  interno começa em {rot(inner[1],ki)[0]} → {v}  áreas calotas={faces}")
