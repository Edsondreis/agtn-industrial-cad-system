# Edições mínimas no STEP do caso vmax para achar o gatilho dentro do leitor
import re
from OCP.STEPControl import STEPControl_Reader
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRepCheck import BRepCheck_Analyzer
import math
REF = (2/3)*math.pi*300*300*150
base = open("vmax.step").read()
def vol(txt):
    open("_t.step","w").write(txt)
    r = STEPControl_Reader(); r.ReadFile("_t.step"); r.TransferRoots(); s = r.OneShape()
    g = GProp_GProps(); BRepGProp.VolumeProperties_s(s, g); return g.Mass()/REF, BRepCheck_Analyzer(s).IsValid()
edits = {
 "original": base,
 "polo z=0 exato": base.replace("(150.,0.,9.184850997342E-15)", "(150.,0.,0.)"),
 "ordem das pcurves da costura trocada": base.replace("(#72,#79),.PCURVE_S1.", "(#79,#72),.PCURVE_S1."),
 "laço começando pela costura": base.replace("EDGE_LOOP('',(#61,#62,#86))", "EDGE_LOOP('',(#62,#86,#61))"),
 "costura com sentido invertido (polo→costado, same_sense .F.)": base.replace("#63 = EDGE_CURVE('',#22,#64,#66,.T.)", "#63 = EDGE_CURVE('',#64,#22,#66,.F.)").replace("#62 = ORIENTED_EDGE('',*,*,#63,.T.)", "#62 = ORIENTED_EDGE('',*,*,#63,.F.)").replace("#86 = ORIENTED_EDGE('',*,*,#63,.F.)", "#86 = ORIENTED_EDGE('',*,*,#63,.T.)"),
 "costura sem pcurves (só a elipse 3D)": base.replace("#63 = EDGE_CURVE('',#22,#64,#66,.T.)", "#63 = EDGE_CURVE('',#22,#64,#67,.T.)"),
 "pcurves com v invertido nos limites (sentido da face .F.)": base.replace("#58 = ADVANCED_FACE('',(#59),#43,.T.)", "#58 = ADVANCED_FACE('',(#59),#43,.F.)").replace("#59 = FACE_BOUND('',#60,.T.)","#59 = FACE_BOUND('',#60,.F.)"),
}
for k, t in edits.items():
    v, ok = vol(t)
    print(f"{k:60s} vol/exato={v:.6f} válido={ok}")
