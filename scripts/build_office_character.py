"""Author the Codex Office employee in Blender (no downloaded assets).

Run: blender --background --factory-startup --python scripts/build_office_character.py
Coordinates in helpers use the web scene's X/right, Y/up, Z/front, in metres.
Blender receives X, -Z, Y; GLB export restores +Y up. All bones share a vertical
rest basis, allowing the existing small typing gestures to drive a smooth skin.
"""
import json
import math
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dashboard" / "assets"
SOURCE = ROOT / "assets" / "blender"
WORK = ROOT / "work"
for directory in (OUT, SOURCE, WORK):
    directory.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.name = "Codex_Office_Employee"
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1
collections = {}
for name in ("COL_Reference", "COL_Geo", "COL_Export", "COL_Lights", "COL_Cameras"):
    collections[name] = bpy.data.collections.new(name)
    scene.collection.children.link(collections[name])
bpy.ops.wm.save_as_mainfile(filepath=str(WORK / "office-character-start.blend"))


def vec(p):
    return Vector((p[0], -p[2], p[1]))


def place(obj, name, material, collection="COL_Geo"):
    obj.name = name
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    collections[collection].objects.link(obj)
    if material:
        obj.data.materials.append(material)
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def material(name, color, roughness=.65, metallic=0):
    m = bpy.data.materials.new("MAT_" + name)
    m.use_nodes = True
    shader = m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return m


skin = material("Skin", (.65, .39, .24), .53)
cloth = material("Shirt", (.18, .34, .39), .78)
pants = material("Trousers", (.075, .10, .13), .81)
hair = material("Hair", (.035, .025, .019), .62)
trim = material("LightTrim", (.84, .83, .76), .48)
dark = material("DarkTrim", (.022, .030, .036), .32)
iris = material("Iris", (.032, .07, .06), .22)
metal = material("Metal", (.16, .22, .23), .3, .65)
shirt_trim = material("ShirtTrim", (.27,.42,.45), .8)

# One original, tileable 2K fabric set shared by every outfit. Fine weave is a
# material detail; the live character does not spend geometry on individual fibres.
size = 2048
y, x = np.mgrid[0:size, 0:size].astype(np.float32)
weave = .5 + .25 * np.sin(x * math.pi / 4) + .25 * np.sin(y * math.pi / 4)
thread = .97 + .025 * weave
normal_x = .11 * np.cos(x * math.pi / 4)
normal_y = .11 * np.cos(y * math.pi / 4)


def image(name, rgb, noncolor=False):
    data = np.ones((size, size, 4), dtype=np.float32)
    data[:, :, :3] = rgb
    im = bpy.data.images.new(name, width=size, height=size, alpha=False)
    im.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
    im.pixels.foreach_set(data.ravel())
    im.filepath_raw = str(SOURCE / (name + ".png"))
    im.file_format = "PNG"
    im.save()
    im.pack()
    return im


fabric_bc = image("T_OfficeFabric_BC", np.repeat(thread[:, :, None], 3, axis=2))
normals = np.stack((normal_x * .5 + .5, normal_y * .5 + .5,
                    np.sqrt(1 - normal_x ** 2 - normal_y ** 2) * .5 + .5), axis=-1)
fabric_n = image("T_OfficeFabric_N", normals, True)
for m in (cloth, pants):
    nodes, links = m.node_tree.nodes, m.node_tree.links
    shader = nodes.get("Principled BSDF")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = fabric_bc
    # White fabric base is multiplied by a stable employee tint in the web app.
    links.new(tex.outputs["Color"], shader.inputs["Base Color"])
    tex_n = nodes.new("ShaderNodeTexImage")
    tex_n.image = fabric_n
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = .22
    links.new(tex_n.outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], shader.inputs["Normal"])


def mesh(name, verts, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata([vec(p) for p in verts], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collections["COL_Geo"].objects.link(obj)
    return place(obj, name, mat)


def loft(name, rows, mat, pos=(0, 0, 0), sides=48, exponent=2, sculpt=None):
    verts, faces = [], []
    for row in rows:
        yy, rx, rz, *rest = row
        zc = rest[0] if rest else 0
        for j in range(sides):
            angle = j * 2 * math.pi / sides
            ss, cc = math.sin(angle), math.cos(angle)
            xx = math.copysign(abs(ss) ** (2 / exponent), ss) * rx
            zz = math.copysign(abs(cc) ** (2 / exponent), cc) * rz + zc
            if sculpt:
                zz += sculpt(xx, yy, max(0, cc))
            verts.append((xx + pos[0], yy + pos[1], zz + pos[2]))
    for i in range(len(rows) - 1):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces.extend((tuple(range(sides - 1, -1, -1)), tuple((len(rows) - 1) * sides + j for j in range(sides))))
    return mesh(name, verts, faces, mat)


def ellipsoid(name, pos, scale, mat, segments=32, rings=20):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=vec(pos))
    obj = bpy.context.object
    obj.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return place(obj, name, mat)


def capsule(name, a, b, radii, mat):
    # A shaped, tapered limb with rounded ends, not a constant-radius cylinder.
    aa, bb = Vector(a), Vector(b)
    direction = (bb - aa).normalized()
    right = direction.cross(Vector((0, 0, 1)))
    if right.length < .01:
        right = direction.cross(Vector((0, 1, 0)))
    right.normalize()
    across = direction.cross(right).normalized()
    verts, faces, sides = [], [], 24
    for t, radius in radii:
        for i in range(sides):
            angle = i * 2 * math.pi / sides
            p = aa.lerp(bb, t) + right * (math.cos(angle) * radius) + across * (math.sin(angle) * radius)
            verts.append(tuple(p))
    for j in range(len(radii) - 1):
        for i in range(sides):
            a0, b0 = j * sides + i, j * sides + (i + 1) % sides
            faces.append((a0, b0, b0 + sides, a0 + sides))
    faces.extend((tuple(range(sides - 1, -1, -1)), tuple((len(radii) - 1) * sides + i for i in range(sides))))
    return mesh(name, verts, faces, mat)


def curve(name, pts, radius, mat):
    closed = pts[0] == pts[-1]
    if closed:
        pts = pts[:-1]
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 12
    data.bevel_depth = radius
    data.bevel_resolution = 3
    data.use_fill_caps = True
    spline = data.splines.new("BEZIER")
    spline.use_cyclic_u = closed
    spline.bezier_points.add(len(pts) - 1)
    for p, co in zip(spline.bezier_points, pts):
        p.co = vec(co)
        p.handle_left_type = p.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, data)
    collections["COL_Geo"].objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    # Blender's curve caps have split boundary vertices. Weld the boundary
    # before decimation/UVs so the exported mesh is genuinely watertight.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000001)
    bm.to_mesh(obj.data)
    bm.free()
    obj.select_set(False)
    return place(obj, name, mat)


def join(objects, name):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def finish(obj, budget, remesh=None, subdiv=0):
    bpy.context.view_layer.objects.active = obj
    if remesh:
        mod = obj.modifiers.new("Unified_Silhouette", "REMESH")
        mod.mode = "VOXEL"
        mod.voxel_size = remesh
        mod.use_smooth_shade = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
        smooth = obj.modifiers.new("Relax_Surface", "SMOOTH")
        smooth.factor, smooth.iterations = 1.0, 4
        bpy.ops.object.modifier_apply(modifier=smooth.name)
    if subdiv:
        mod = obj.modifiers.new("Sculpt_Smooth", "SUBSURF")
        mod.levels = subdiv
        bpy.ops.object.modifier_apply(modifier=mod.name)
    count = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if count > budget:
        mod = obj.modifiers.new("Realtime_Budget", "DECIMATE")
        mod.ratio = budget / count
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in obj.data.polygons:
        p.use_smooth = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def smooth_profile(obj):
    """Round the sparse sculpt control cage before unioning anatomical parts."""
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("Sculpt_Control_Surface", "SUBSURF")
    mod.levels = 2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


head_pos = (0, 1.57, -.40)
gauss = lambda x, y, cx, cy, wx, wy: math.exp(-((x-cx)/wx)**2 - ((y-cy)/wy)**2)
shape = lambda x, y, f: f * (.014 * (gauss(x,y,-.09,-.045,.047,.035)+gauss(x,y,.09,-.045,.047,.035))
                              - .014 * (gauss(x,y,-.059,.018,.038,.025)+gauss(x,y,.059,.018,.038,.025)))
head = loft("SM_Head", [(-.215,.023,.047,.030),(-.195,.069,.076,.027),(-.159,.107,.105,.013),
             (-.109,.133,.123,0),(-.05,.151,.141,-.007),(.012,.147,.135,-.008),(.061,.146,.143,-.01),
             (.118,.148,.14,-.014),(.172,.127,.116,-.02),(.211,.075,.069,-.025),(.23,.005,.012,-.026)], skin, head_pos, sculpt=shape)
nose = loft("SM_Nose", [(-.074,.02,.012,.16),(-.053,.024,.026,.174),(-.027,.017,.024,.159),
             (.01,.012,.02,.142),(.045,.005,.008,.134)], skin, head_pos, sides=32)
head_parts = [smooth_profile(head), smooth_profile(nose)]
for s in (-1,1):
    head_parts.append(ellipsoid("SM_Ear", (s*.152,1.55,-.408),(.03,.052,.026),skin))
    head_parts.append(ellipsoid("SM_NoseWing", (s*.021,1.504,-.24),(.016,.011,.016),skin))
head_parts.append(capsule("SM_Neck", (0,1.30,-.425),(0,1.42,-.408),[(0,.067),(.3,.065),(.9,.06),(1,.055)],skin))
head = finish(join(head_parts,"SM_Employee_Head_LOD0"),8000,remesh=.005)

shirt_parts = [smooth_profile(loft("SM_Shirt", [(.785,.19,.139),(.83,.208,.15),(.94,.213,.151),
                (1.07,.235,.16),(1.19,.24,.151),(1.25,.235,.14),(1.29,.146,.102),(1.315,.075,.073)],cloth,(0,0,-.42),exponent=2.5))]
skin_arms = []
joint_positions = {"rig_root": (0,0,0), "rig_spine": (0,.82,-.42), "rig_head":head_pos}
parents = {"rig_spine":"rig_root", "rig_head":"rig_spine"}
for s, label in ((-1,"L"),(1,"R")):
    shoulder=(s*.246,1.215,-.412)
    elbow=(s*.288,.967,-.135)
    wrist=(s*.164,1.015,.163)
    joint_positions.update({"rig_arm_"+label:shoulder,"rig_elbow_"+label:elbow,"rig_wrist_"+label:wrist})
    parents.update({"rig_arm_"+label:"rig_spine","rig_elbow_"+label:"rig_arm_"+label,"rig_wrist_"+label:"rig_elbow_"+label})
    shirt_parts.append(smooth_profile(capsule("SM_Sleeve",(s*.217,1.245,-.412),elbow,[(0,.043),(.15,.089),(.4,.083),(.83,.066),(1,.062)],cloth)))
    arm_parts=[capsule("SM_Forearm",elbow,wrist,[(0,.054),(.2,.054),(.6,.04),(1,.028)],skin),
               ellipsoid("SM_Palm",(wrist[0],1.014,.21),(.047,.025,.061),skin)]
    for i in range(4):
        xx=wrist[0]+(i-1.5)*.021
        arm_parts.append(capsule("SM_Finger",(xx,1.012,.245),(xx,1.0,.305-abs(i-1.5)*.012),[(0,.009),(.45,.01),(.75,.009),(1,.0035)],skin))
    arm_parts.append(capsule("SM_Thumb",(wrist[0]+s*.038,1.012,.20),(wrist[0]+s*.062,1.0,.243),[(0,.012),(.6,.013),(1,.006)],skin))
    skin_arms.append(finish(join(arm_parts,"SM_Hand_"+label),2500,remesh=.0038))
shirt=finish(join(shirt_parts,"SM_Employee_Shirt_LOD0"),8000,remesh=.008)

pant_parts=[loft("SM_Hips",[(.645,.21,.2),(.70,.23,.209),(.77,.206,.173),(.815,.19,.138)],pants,(0,0,-.42),exponent=2.4)]
shoe_parts=[]
for s in (-1,1):
    pant_parts.extend([capsule("SM_Thigh",(s*.125,.75,-.38),(s*.19,.65,.045),[(0,.107),(.35,.112),(.72,.093),(1,.083)],pants),
                       capsule("SM_Calf",(s*.19,.65,.045),(s*.19,.19,.157),[(0,.085),(.22,.085),(.65,.064),(1,.06)],pants)])
    shoe_parts.append(loft("SM_Shoe",[(.085,.078,.172,.04),(.106,.082,.18,.04),(.125,.075,.164,.04),
                     (.16,.067,.131,.025),(.20,.05,.079,-.025)],dark,(s*.19,0,.19),exponent=3))
pants_obj=finish(join(pant_parts,"SM_Employee_Trousers_LOD0"),6500,remesh=.0075)
shoes=finish(join(shoe_parts,"SM_Employee_Shoes_LOD0"),1400,subdiv=1)

# Tailored collar, cuffs, placket, pocket and sneaker soles share the trim atlas.
trim_parts=[]
for s in (-1,1):
    collar=[(s*.018,1.32,-.354),(s*.078,1.302,-.335),(s*.106,1.214,-.275),(s*.034,1.257,-.282)]
    trim_parts.append(mesh("SM_Collar",collar+[(x,y,z-.006) for x,y,z in collar],
                           [(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],shirt_trim))
    trim_parts.append(capsule("SM_Cuff",(s*.288,.967,-.135),(s*.278,.974,-.112),[(0,.065),(.25,.067),(.8,.067),(1,.064)],shirt_trim))
    trim_parts.append(loft("SM_Sole",[(.073,.083,.182,.04),(.096,.083,.183,.04)],trim,(s*.19,0,.19),exponent=3,sides=32))
for yy in (.94,1.045,1.155):
    trim_parts.append(ellipsoid("SM_Button",(0,yy,-.252),(.005,.005,.005),trim,16,8))
trim_parts.append(curve("SM_Placket",[(0,.84,-.264),(0,1.04,-.251),(0,1.22,-.27)],.0025,shirt_trim))
trim_parts.append(curve("SM_Pocket",[(-.17,1.15,-.29),(-.17,1.075,-.277),(-.115,1.07,-.267),(-.10,1.146,-.266)],.0016,shirt_trim))
trim_obj=finish(join(trim_parts,"SM_Employee_Trim_LOD0"),1400)

eye_parts, iris_parts, lid_parts, glasses_parts=[] ,[],[],[]
for s in (-1,1):
    xx=s*.059
    eye_parts.append(ellipsoid("SM_EyeWhite",(xx,1.59,-.268),(.031,.011,.011),trim))
    iris_parts.append(ellipsoid("SM_Iris",(xx-s*.002,1.589,-.256),(.010,.009,.003),iris,24,12))
    iris_parts.append(ellipsoid("SM_Pupil",(xx-s*.002,1.589,-.253),(.0045,.0055,.001),dark,20,12))
    for up in (True,False):
        lid_parts.append(curve("SM_Lid",[(xx-.031,1.59,-.271),(xx-.012,1.59+(.012 if up else -.009),-.254),
                             (xx+.013,1.59+(.012 if up else -.009),-.254),(xx+.031,1.59,-.271)],.0029,skin))
    iris_parts.append(curve("SM_Brow",[(s*.029,1.634,-.265),(s*.06,1.64,-.265),(s*.096,1.625,-.281)],.005,hair))
    glasses_parts.append(curve("SM_Frame",[(s*.022,1.611,-.241),(s*.041,1.62,-.24),(s*.085,1.612,-.25),
                           (s*.095,1.588,-.253),(s*.073,1.573,-.245),(s*.035,1.576,-.235),(s*.022,1.611,-.241)],.0038,metal))
    glasses_parts.append(curve("SM_Temple",[(s*.093,1.608,-.254),(s*.145,1.615,-.31),(s*.151,1.60,-.41)],.003,metal))
glasses_parts.append(curve("SM_Bridge",[(-.024,1.606,-.24),(0,1.612,-.225),(.024,1.606,-.24)],.0032,metal))
lid_parts.append(curve("SM_Lips",[(-.032,1.46,-.264),(-.01,1.464,-.253),(0,1.46,-.249),(.013,1.464,-.253),(.032,1.46,-.264)],.004,skin))
eyes=finish(join(eye_parts,"SM_Employee_Eyes_LOD0"),900)
irises=finish(join(iris_parts,"SM_Employee_Irises_LOD0"),900)
lids=finish(join(lid_parts,"SM_Employee_Lids_LOD0"),1200)
glasses=finish(join(glasses_parts,"SM_Employee_Glasses_LOD0"),1000)


def hair_style(style):
    verts, faces=[],[]
    sides, rings=64,24
    for i in range(rings+1):
        t=i/rings
        for j in range(sides):
            angle=j*2*math.pi/sides
            front=max(0,math.cos(angle))
            phi=.005+(1.91-front*.91)*t
            ripple=.003*math.cos(angle*18+t*5)*math.sin(phi)
            part=.014*math.sin(angle+.8)*math.sin(phi) if style==0 else 0
            xx=math.sin(angle)*math.sin(phi)*(.174+ripple)
            yy=1.587+math.cos(phi)*.247+part
            zz=-.416+math.cos(angle)*math.sin(phi)*(.168+ripple)
            verts.append((xx,yy,zz))
    for i in range(rings):
        for j in range(sides):
            a,b=i*sides+j,i*sides+(j+1)%sides
            faces.append((a,a+sides,b+sides,b))
    faces.append(tuple(range(sides-1,-1,-1)))
    faces.append(tuple(rings*sides+j for j in range(sides)))
    parts=[mesh("SM_HairCap",verts,faces,hair)]
    if style==0:
        # Side-swept quiff; the scalloped surface reads in silhouette and light.
        for i in range(5):
            xx=-.102+i*.039
            parts.append(curve("SM_HairLock",[(xx,1.725,-.295),(xx+.038,1.805,-.355),(.035+xx*.6,1.818,-.44)],.019-i*.001,hair))
    elif style==1:
        parts.append(loft("SM_Bob",[(1.34,.116,.053),(1.385,.172,.065),(1.55,.169,.067),(1.69,.12,.04)],hair,(0,0,-.51)))
    else:
        parts.append(ellipsoid("SM_Bun",(0,1.646,-.596),(.075,.075,.063),hair))
    return finish(join(parts,"SM_Employee_Hair"+str(style)+"_LOD0"),3000,remesh=.006)


hairs=[hair_style(i) for i in range(3)]
skin_obj=join([head,*skin_arms,lids],"SM_Employee_Skin_LOD0")
objects=[skin_obj,shirt,pants_obj,shoes,trim_obj,eyes,irises,glasses,*hairs]

# Vertex colour adds cheek/ear/lip warmth without a photo or external skin map.
colors=skin_obj.data.color_attributes.new(name="Color",type="BYTE_COLOR",domain="POINT")
for vertex,color in zip(skin_obj.data.vertices,colors.data):
    xx,zz,yy=vertex.co.x,-vertex.co.y,vertex.co.z
    warmth=0
    if yy>1.4:
        warmth=.16*(gauss(xx,yy,-.1,1.53,.045,.04)+gauss(xx,yy,.1,1.53,.045,.04))
        warmth+=.32*gauss(xx,yy,0,1.46,.04,.012)
    color.color=(1,.94-warmth,.88-warmth*.9,1)
node=skin.node_tree.nodes.new("ShaderNodeVertexColor");node.layer_name="Color"
skin.node_tree.links.new(node.outputs["Color"],skin.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])

# A true weighted skeleton. The skin bends continuously through elbow/wrist and
# shoulder instead of separating independent geometric pieces while typing.
armature=bpy.data.armatures.new("ARM_Employee")
rig=bpy.data.objects.new("ARM_Employee",armature)
collections["COL_Export"].objects.link(rig)
bpy.ops.object.select_all(action="DESELECT");rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode="EDIT")
for name,p in joint_positions.items():
    bone=armature.edit_bones.new(name);bone.head=vec(p);bone.tail=vec(p)+Vector((0,0,.12))
    if name in parents:bone.parent=armature.edit_bones[parents[name]]
bpy.ops.object.mode_set(mode="OBJECT")


def assignment(obj,p):
    xx,yy,zz=p
    if any(word in obj.name for word in ("Hair","Eyes","Irises","Glasses")):
        return {"rig_head":1}
    if yy>1.38:return {"rig_head":1}
    if "Trousers" in obj.name or "Shoes" in obj.name or yy<.81:return {"rig_root":1}
    if abs(xx)>.21 or (yy<1.085 and zz>-.1):
        label="L" if xx<0 else "R"
        if zz>.115:
            t=min(1,max(0,(zz-.115)/.09));return {"rig_elbow_"+label:1-t,"rig_wrist_"+label:t}
        if zz>-.22:
            t=min(1,max(0,(zz+.22)/.17));return {"rig_arm_"+label:1-t,"rig_elbow_"+label:t}
        t=min(1,max(0,(abs(xx)-.19)/.09));return {"rig_spine":1-t,"rig_arm_"+label:t}
    return {"rig_spine":1}


export_objects=[]
for obj in objects:
    for c in list(obj.users_collection):c.objects.unlink(obj)
    collections["COL_Export"].objects.link(obj)
    for name in joint_positions:obj.vertex_groups.new(name=name)
    for vertex in obj.data.vertices:
        co=obj.matrix_world@vertex.co
        for name,weight in assignment(obj,(co.x,co.z,-co.y)).items():
            if weight>0:obj.vertex_groups[name].add([vertex.index],weight,"REPLACE")
    modifier=obj.modifiers.new("Employee_Deform","ARMATURE");modifier.object=rig
    obj.parent=rig
    export_objects.append(obj)
    # Actual decimated geometry LOD, retained skin weights, same skeleton.
    lod=obj.copy();lod.data=obj.data.copy();lod.name=obj.name.replace("LOD0","LOD1")
    collections["COL_Export"].objects.link(lod)
    bpy.context.view_layer.objects.active=lod
    dec=lod.modifiers.new("Crowd_LOD","DECIMATE");dec.ratio=.32
    # Evaluate decimation before skin deformation.
    bpy.ops.object.modifier_move_up(modifier=dec.name)
    bpy.ops.object.modifier_apply(modifier=dec.name)
    export_objects.append(lod)

report={"author":"Codex Office contributors", "license":"MIT", "unit":"metre", "format":"GLB",
        "texture_size":2048, "bones":len(joint_positions), "objects":[]}
for obj in export_objects:
    triangles=sum(len(p.vertices)-2 for p in obj.data.polygons)
    bm=bmesh.new();bm.from_mesh(obj.data)
    nonmanifold=sum(not edge.is_manifold for edge in bm.edges);bm.free()
    report["objects"].append({"name":obj.name,"triangles":triangles,"uv_layers":len(obj.data.uv_layers),
                               "nonmanifold_edges":nonmanifold,"materials":len(obj.data.materials)})
report["character_lod0_triangles"]=sum(o["triangles"] for o in report["objects"] if "LOD0" in o["name"] and not any(x in o["name"] for x in ("Hair1","Hair2")))
report["character_lod1_triangles"]=sum(o["triangles"] for o in report["objects"] if "LOD1" in o["name"] and not any(x in o["name"] for x in ("Hair1","Hair2")))
assert report["character_lod0_triangles"]<=40000,report
assert all(o["uv_layers"] for o in report["objects"]),"Every render mesh needs UVs"
assert all(not o["nonmanifold_edges"] for o in report["objects"]),report

bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
for obj in export_objects:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/"office-employee.glb"),export_format="GLB",use_selection=True,
                          export_animations=False,export_yup=True,export_materials="EXPORT",export_skins=True,
                          export_extras=False,export_image_format="AUTO")

# Keep a reproducible, editable authoring file and two neutral look-dev views.
for obj in export_objects:
    obj.hide_render="LOD1" in obj.name or "Hair1" in obj.name or "Hair2" in obj.name
    obj.hide_set(obj.hide_render)
scene.world.color=(.15,.15,.15)
scene.render.engine="CYCLES";scene.cycles.samples=24
scene.render.resolution_x=1000;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format="PNG";scene.render.film_transparent=True


def light(name,position,power,size):
    data=bpy.data.lights.new(name,"AREA");data.energy=power;data.shape="DISK";data.size=size
    obj=bpy.data.objects.new(name,data);collections["COL_Lights"].objects.link(obj)
    obj.location=vec(position);obj.rotation_euler=(vec((0,1,-.2))-obj.location).to_track_quat('-Z','Y').to_euler()


light("LGT_Key",(-2.2,3.4,3),350,3)
light("LGT_Rim",(2.5,2.8,-2),450,2)
light("LGT_Fill",(2,1.8,2),90,2)
camera_data=bpy.data.cameras.new("CAM_Employee")
camera=bpy.data.objects.new("CAM_Employee",camera_data);collections["COL_Cameras"].objects.link(camera);scene.camera=camera
camera_data.type="ORTHO";camera_data.ortho_scale=2.25
camera.location=vec((2.1,2.05,3.2));camera.rotation_euler=(vec((0,.98,-.2))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(WORK/"blender-employee-three-quarter.png")
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/"office-employee.blend"),compress=True)
(OUT/"office-employee.validation.json").write_text(json.dumps(report,indent=2)+"\n")
print("OFFICE_ASSET_VALIDATED",json.dumps({k:v for k,v in report.items() if k!="objects"}))
bpy.ops.render.render(write_still=True)
camera.location=vec((2.5,1.8,0));camera.rotation_euler=(vec((0,.98,-.2))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(WORK/"blender-employee-profile.png")
bpy.ops.render.render(write_still=True)
