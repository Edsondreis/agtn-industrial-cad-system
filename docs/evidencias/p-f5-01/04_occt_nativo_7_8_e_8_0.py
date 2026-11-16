import sys
from OCP.STEPControl import STEPControl_Reader
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRepCheck import BRepCheck_Analyzer
REFV, REFA = 11739729.622605406, 4135203.6497592945
for f in sys.argv[1:]:
    r = STEPControl_Reader(); r.ReadFile(f); r.TransferRoots(); s = r.OneShape()
    g = GProp_GProps(); BRepGProp.VolumeProperties_s(s, g); v = g.Mass()
    g2 = GProp_GProps(); BRepGProp.SurfaceProperties_s(s, g2); a = g2.Mass()
    print(f"  {f.split('/')[-1]:22s} vol={v:.3f} ({v/REFV-1:+.2e}) área={a:.3f} ({a/REFA-1:+.2e}) válido={BRepCheck_Analyzer(s).IsValid()}")
