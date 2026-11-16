# Prova: tirar a aresta degenerada do polo (estado em que o STEP chega) e rodar o ShapeFix do leitor
from OCP.gp import gp_Pnt, gp_Dir, gp_Ax1, gp_Ax2, gp_Elips
from OCP.GC import GC_MakeArcOfEllipse
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire, BRepBuilderAPI_MakeFace
from OCP.BRepPrimAPI import BRepPrimAPI_MakeRevol
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_FACE, TopAbs_EDGE, TopAbs_WIRE
from OCP.TopoDS import TopoDS
from OCP.BRep import BRep_Tool
from OCP.BRepTools import BRepTools
from OCP.ShapeExtend import ShapeExtend_WireData
from OCP.ShapeFix import ShapeFix_Wire, ShapeFix_Face
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.BRepCheck import BRepCheck_Analyzer
import math
D = lambda x,y,z: gp_Dir(x,y,z)
def head(vmax):
    a,b=300.,150.
    if vmax: ax=gp_Ax2(gp_Pnt(0,0,0), D(0,1,0), D(0,0,1)); t0,t1=0,math.pi/2
    else:    ax=gp_Ax2(gp_Pnt(0,0,0), D(0,-1,0), D(0,0,1)); t0,t1=-math.pi/2,0
    arc = GC_MakeArcOfEllipse(gp_Elips(ax,a,b), t0, t1, True).Value()
    w = BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Pnt(0,0,0),gp_Pnt(0,0,a)).Edge(),
                                BRepBuilderAPI_MakeEdge(arc).Edge(),
                                BRepBuilderAPI_MakeEdge(gp_Pnt(b,0,0),gp_Pnt(0,0,0)).Edge()).Wire()
    return BRepPrimAPI_MakeRevol(BRepBuilderAPI_MakeFace(w).Face(), gp_Ax1(gp_Pnt(0,0,0),D(1,0,0)), 2*math.pi).Shape()
def area(f):
    g=GProp_GProps(); BRepGProp.SurfaceProperties_s(f,g); return g.Mass()
def revface(s):
    ex=TopExp_Explorer(s,TopAbs_FACE)
    while ex.More():
        f=TopoDS.Face(ex.Current())
        if BRep_Tool.Surface_s(f).DynamicType().Name()=="Geom_SurfaceOfRevolution": return f
        ex.Next()
for vmax in (True, False):
    f = revface(head(vmax)); ref = area(f)
    wire = TopoDS.Wire(TopExp_Explorer(f, TopAbs_WIRE).Current())
    wd = ShapeExtend_WireData(wire)
    deg = [i for i in range(1, wd.NbEdges()+1) if BRep_Tool.Degenerated_s(wd.Edge(i))]
    for i in reversed(deg): wd.Remove(i)
    # face com o laço do STEP: costura + círculo, sem degenerada
    f2 = BRepBuilderAPI_MakeFace(BRep_Tool.Surface_s(f), wd.Wire()).Face()
    sfw = ShapeFix_Wire(wd.Wire(), f2, 1e-7); sfw.FixDegenerated(); sfw.FixLacking()
    nd = sum(BRep_Tool.Degenerated_s(sfw.WireData().Edge(i)) for i in range(1, sfw.WireData().NbEdges()+1))
    f3 = BRepBuilderAPI_MakeFace(BRep_Tool.Surface_s(f), sfw.Wire()).Face()
    sff = ShapeFix_Face(f2); sff.Perform(); f4 = sff.Face()
    u1,u2,v1,v2 = BRepTools.UVBounds_s(f4)
    print(f"polo em {'vmax' if vmax else 'vmin'}: área exata {ref:.1f} | degeneradas removidas {len(deg)} | "
          f"ShapeFix_Wire repõe {nd} → área {area(f3):.1f} | ShapeFix_Face → área {area(f4):.1f} v=[{v1:.3f},{v2:.3f}] válida={BRepCheck_Analyzer(f4).IsValid()}")
