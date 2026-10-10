"""Author original seated cow/horse coworkers, reusing the employee's office rig.

Blender 5.2: blender --background --factory-startup --python-exit-code 1 \
    --python scripts/build_office_animals.py
The existing employee source is read only. Helpers use X/right, Y/up, Z/front.
"""
import argparse
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/blender'
OUT = ROOT / 'dashboard/assets'
WORK = ROOT / 'work'


def vec(p):
    return Vector((p[0], -p[2], p[1]))


def material(name, color, roughness=.72):
    m = bpy.data.materials.new('MAT_' + name)
    m.use_nodes = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    return m


def ellipsoid(name, pos, size, mat, segments=32, rings=20, tilt=0):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=vec(pos))
    obj = bpy.context.object
    obj.name = 'SM_' + name
    obj.scale = (size[0], size[2], size[1])
    obj.rotation_euler[1] = tilt
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def tube(name, points, radii, mat, sides=16):
    verts, faces = [], []
    for i, (p, radius) in enumerate(zip(points, radii)):
        p = Vector(p)
        tangent = (Vector(points[min(i + 1, len(points)-1)]) - Vector(points[max(0,i-1)])).normalized()
        right = tangent.cross(Vector((0,0,1)))
        if right.length < .01:
            right = tangent.cross(Vector((0,1,0)))
        right.normalize()
        up = tangent.cross(right).normalized()
        for j in range(sides):
            a = j * math.tau / sides
            verts.append(vec(p + radius * (right * math.cos(a) + up * math.sin(a))))
    for i in range(len(points)-1):
        for j in range(sides):
            a, b = i*sides+j, i*sides+(j+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.extend((tuple(range(sides-1,-1,-1)), tuple((len(points)-1)*sides+j for j in range(sides))))
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new('SM_' + name, data)
    bpy.context.scene.collection.objects.link(obj)
    data.materials.append(mat)
    for p in data.polygons:
        p.use_smooth = True
    return obj


def join(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return obj


def finish(obj, budget):
    bpy.context.view_layer.objects.active = obj
    count = sum(len(p.vertices)-2 for p in obj.data.polygons)
    if count > budget:
        mod = obj.modifiers.new('Realtime_Budget', 'DECIMATE')
        mod.ratio = budget / count
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=.015)
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def weight(obj, rig, head_only=False, root_only=False):
    for group in list(obj.vertex_groups):
        obj.vertex_groups.remove(group)
    for bone in rig.data.bones:
        obj.vertex_groups.new(name=bone.name)
    for vertex in obj.data.vertices:
        x, y, z = vertex.co.x, vertex.co.z, -vertex.co.y
        if root_only:
            weights = {'rig_root':1}
        elif head_only or y > 1.38:
            weights = {'rig_head':1}
        elif y > 1.27:
            t = max(0, min(1, (y-1.27)/.11))
            weights = {'rig_spine':1-t, 'rig_head':t}
        else:
            side = 'L' if x < 0 else 'R'
            if z > .115:
                t = max(0, min(1, (z-.115)/.09))
                weights = {'rig_elbow_'+side:1-t, 'rig_wrist_'+side:t}
            else:
                t = max(0, min(1, (z+.22)/.17))
                weights = {'rig_arm_'+side:1-t, 'rig_elbow_'+side:t}
        for name, amount in weights.items():
            if amount:
                obj.vertex_groups[name].add([vertex.index], amount, 'REPLACE')
    for mod in list(obj.modifiers):
        obj.modifiers.remove(mod)
    mod = obj.modifiers.new('Employee_Deform','ARMATURE')
    mod.object = rig
    obj.parent = rig


def remove_head(skin):
    """Remove entire connected head/neck/lid islands, leaving closed hand meshes."""
    bm = bmesh.new()
    bm.from_mesh(skin.data)
    seen, removed = set(), []
    for seed in bm.verts:
        if seed in seen:
            continue
        island, stack = [], [seed]
        seen.add(seed)
        while stack:
            v = stack.pop()
            island.append(v)
            for edge in v.link_edges:
                other = edge.other_vert(v)
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        if max(v.co.z for v in island) > 1.3:
            removed.extend(island)
    bmesh.ops.delete(bm, geom=removed, context='VERTS')
    bm.to_mesh(skin.data)
    bm.free()
    for attr in list(skin.data.color_attributes):
        skin.data.color_attributes.remove(attr)


def build(species, render=True):
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'office-employee.blend'))
    scene = bpy.context.scene
    scene.name = 'Codex_Office_' + species.title()
    rig = bpy.data.objects['ARM_Employee']
    export = bpy.data.collections['COL_Export']
    # Keep the authored body and its weights; never write back to the source human.
    for obj in list(export.objects):
        if obj.type == 'MESH' and ('LOD1' in obj.name or any(p in obj.name for p in ('Hair','Eyes','Irises','Glasses'))):
            bpy.data.objects.remove(obj, do_unlink=True)
    skin = bpy.data.objects['SM_Employee_Skin_LOD0']
    remove_head(skin)
    for mod in list(skin.modifiers):
        skin.modifiers.remove(mod)
    skin.parent = None
    cow = species == 'cow'
    fur = material('CowFur' if cow else 'HorseFur', (.88,.84,.72) if cow else (.34,.135,.06))
    ink = material('CowPatch' if cow else 'HorseMane', (.027,.034,.037) if cow else (.06,.028,.016))
    muzzle = material('CowMuzzle' if cow else 'HorseMuzzle', (.66,.32,.28) if cow else (.24,.105,.055))
    horn = material('HornIvory', (.73,.58,.34))
    inner = material('InnerEar', (.61,.30,.26) if cow else (.44,.21,.12))
    white = material('EyeWhite', (.94,.92,.82), .42)
    pupil = material('AnimalEyes', (.014,.02,.022), .28)
    blaze = material('HorseBlaze', (.88,.78,.57))
    skin.data.materials.clear()
    skin.data.materials.append(fur)
    for p in skin.data.polygons:
        p.material_index = 0
    base = [skin, ellipsoid('Neck',(0,1.35,-.425),(.073,.12,.071),fur)]
    detail, eyes, pupils = [], [], []
    if cow:
        base.append(ellipsoid('CowHead',(0,1.595,-.435),(.217,.23,.19),fur))
        detail.append(ellipsoid('CowMuzzle',(0,1.465,-.246),(.177,.103,.115),muzzle))
        # Large face markings follow the surface; visible in both LODs.
        for s in (-1,1):
            base.append(ellipsoid('CowEar',(s*.265,1.68,-.445),(.128,.058,.063),fur,tilt=s*.3))
            detail.append(ellipsoid('CowEarInner',(s*.276,1.68,-.393),(.083,.035,.018),inner,tilt=s*.3))
            detail.append(tube('CowHorn',[(s*.15,1.755,-.467),(s*.194,1.816,-.467),(s*.197,1.886,-.453),(s*.172,1.931,-.429)],[.044,.036,.022,.002],horn))
            eyes.append(ellipsoid('CowEye',(s*.108,1.653,-.265),(.045,.047,.019),white))
            pupils.append(ellipsoid('CowPupil',(s*.104,1.652,-.246),(.022,.027,.009),pupil))
            pupils.append(ellipsoid('CowGlint',(s*.104-.006,1.664,-.238),(.007,.009,.004),white,16,10))
            detail.append(ellipsoid('CowNostril',(s*.082,1.49,-.139),(.026,.016,.007),ink))
            detail.append(tube('CowBrow',[(s*.06,1.714,-.27),(s*.10,1.727,-.282),(s*.147,1.707,-.294)],[.009,.013,.007],ink))
        detail.append(tube('CowSmile',[(-.073,1.426,-.149),(0,1.418,-.132),(.073,1.426,-.149)],[.004,.005,.004],muzzle))
    else:
        base.extend([ellipsoid('HorseCranium',(0,1.664,-.42),(.163,.229,.181),fur),
                     ellipsoid('HorseNoseBridge',(0,1.514,-.257),(.125,.172,.195),fur)])
        detail.append(ellipsoid('HorseMuzzle',(0,1.415,-.112),(.133,.089,.115),muzzle))
        for s in (-1,1):
            base.append(ellipsoid('HorseEar',(s*.112,1.906,-.424),(.055,.112,.049),fur,tilt=s*.19))
            detail.append(ellipsoid('HorseEarInner',(s*.112,1.91,-.382),(.031,.073,.016),inner,tilt=s*.19))
            eyes.append(ellipsoid('HorseEye',(s*.128,1.684,-.287),(.04,.046,.028),white))
            pupils.append(ellipsoid('HorsePupil',(s*.127,1.679,-.26),(.021,.029,.009),pupil))
            pupils.append(ellipsoid('HorseGlint',(s*.127-.005,1.691,-.252),(.006,.009,.003),white,16,10))
            detail.append(ellipsoid('HorseNostril',(s*.077,1.435,-.006),(.022,.015,.007),ink))
            detail.append(tube('HorseBrow',[(s*.097,1.738,-.29),(s*.135,1.74,-.286),(s*.163,1.715,-.309)],[.008,.012,.006],ink))
        # A swept forelock and continuous dark mane make the profile legible.
        for i in range(5):
            detail.append(ellipsoid('HorseMane',(0,1.48+i*.081,-.588),(.074,.072,.063),ink))
        for i in range(3):
            detail.append(ellipsoid('HorseForelock',(-.061+i*.048,1.82-i*.018,-.323),(.06,.11,.052),ink,tilt=-.45))
    # Weld the anatomical volumes into one continuous head/neck silhouette.
    head=join(base[1:],'SM_AnimalHead')
    bpy.context.view_layer.objects.active=head
    remesh=head.modifiers.new('Unified_Head','REMESH');remesh.mode='VOXEL';remesh.voxel_size=.005
    remesh.use_smooth_shade=True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth=head.modifiers.new('Relax_Head','SMOOTH');smooth.factor=1;smooth.iterations=3
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    skin = finish(join([base[0],head],'SM_Employee_Skin_LOD0'),8500)
    # Flat coat markings conform to the head instead of floating over the eyes.
    colors=skin.data.color_attributes.new(name='Coat',type='BYTE_COLOR',domain='POINT')
    for vertex,color in zip(skin.data.vertices,colors.data):
        x,y,z=vertex.co.x,vertex.co.z,-vertex.co.y
        if cow:
            patch=(((x+.108)/.088)**2+((y-1.657)/.112)**2<1 and z>-.39) or (((x-.076)/.102)**2+((z+.436)/.16)**2<1 and y>1.747)
            rgb=(.026,.032,.035) if patch else (.88,.84,.72)
        else:
            marking=abs(x)<(.024+.01*math.cos((y-1.4)*12)) and 1.44<y<1.79 and z>-.29
            rgb=(.88,.78,.57) if marking else (.34,.135,.06)
        color.color=(*rgb,1)
    color_node=fur.node_tree.nodes.new('ShaderNodeVertexColor');color_node.layer_name='Coat'
    fur.node_tree.links.new(color_node.outputs['Color'],fur.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    accents = finish(join(detail,'SM_Employee_AnimalDetails_LOD0'),6500)
    eye_obj = finish(join(eyes,'SM_Employee_Eyes_LOD0'),1400)
    pupil_obj = finish(join(pupils,'SM_Employee_Irises_LOD0'),1400)
    weight(skin,rig)
    for obj in (accents,eye_obj,pupil_obj):
        weight(obj,rig,head_only=True)
    if cow:
        tail_points=[]
        for i in range(13):
            t=i/12
            tail_points.append((.43*math.sin(t*math.pi/2),.72-.47*t,-.60-.08*t-.16*math.sin(t*math.pi)))
        tail_parts=[tube('CowTail',tail_points,[.022-.009*i/12 for i in range(13)],material('CowTailFur',(.88,.84,.72)))]
        tail_parts.append(ellipsoid('TailTuft',(.43,.235,-.68),(.049,.073,.046),ink))
    else:
        tail_points=[(0,.71,-.66),(.11,.65,-.80),(.20,.54,-.87),(.25,.40,-.88),(.28,.26,-.85),(.29,.19,-.81)]
        tail_parts=[tube('HorseTail',tail_points,[.045,.059,.066,.06,.041,.003],ink,24)]
    tail = finish(join(tail_parts,'SM_Employee_Tail_LOD0'),1100)
    weight(tail,rig,root_only=True)
    for obj in (skin,accents,eye_obj,pupil_obj,tail):
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        export.objects.link(obj)
    high = [o for o in export.objects if o.type=='MESH']
    for obj in high:
        obj.hide_set(False)
        obj.hide_render=False
        lod = obj.copy()
        lod.data=obj.data.copy()
        lod.name=obj.name.replace('LOD0','LOD1')
        export.objects.link(lod)
        bpy.context.view_layer.objects.active=lod
        dec=lod.modifiers.new('Crowd_LOD','DECIMATE')
        dec.ratio=.30
        bpy.ops.object.modifier_move_up(modifier=dec.name)
        bpy.ops.object.modifier_apply(modifier=dec.name)
    objects=[o for o in export.objects if o.type=='MESH']
    report={'author':'Codex Office contributors','license':'MIT','species':species,'unit':'metre','format':'GLB','bones':len(rig.data.bones),'texture_size':2048,'objects':[]}
    for obj in objects:
        bm=bmesh.new();bm.from_mesh(obj.data)
        obj.data.calc_loop_triangles()
        report['objects'].append({'name':obj.name,'triangles':len(obj.data.loop_triangles),'uv_layers':len(obj.data.uv_layers),'nonmanifold_edges':sum(not e.is_manifold for e in bm.edges),'materials':len(obj.data.materials)})
        bm.free()
        assert all(abs(s-1)<1e-6 for s in obj.scale)
        assert all(v.groups for v in obj.data.vertices),obj.name
    for lod in (0,1):
        report[f'character_lod{lod}_triangles']=sum(o['triangles'] for o in report['objects'] if f'LOD{lod}' in o['name'])
    assert report['character_lod0_triangles']<=40000,report
    assert report['character_lod1_triangles']<report['character_lod0_triangles']*.4,report
    assert all(not o['nonmanifold_edges'] and o['uv_layers'] for o in report['objects']),report
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'office-{species}.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_materials='EXPORT',export_skins=True,export_extras=False,export_image_format='AUTO')
    for obj in objects:
        obj.hide_render='LOD1' in obj.name
        obj.hide_set(obj.hide_render)
    scene.render.resolution_x=900
    scene.render.resolution_y=1000
    scene.cycles.samples=24
    scene.camera.data.ortho_scale=2.4
    scene.render.filepath=str(WORK/f'blender-{species}-three-quarter.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f'office-{species}.blend'),compress=True)
    (OUT/f'office-{species}.validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print('OFFICE_ANIMAL_VALIDATED',json.dumps({k:v for k,v in report.items() if k!='objects'}),flush=True)
    if render:
        bpy.ops.render.render(write_still=True)
        camera=scene.camera
        camera.location=vec((2.5,1.8,0))
        camera.rotation_euler=(vec((0,1.05,-.2))-camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(WORK/f'blender-{species}-profile.png')
        bpy.ops.render.render(write_still=True)


if __name__=='__main__':
    import sys
    parser=argparse.ArgumentParser()
    parser.add_argument('--species',choices=['cow','horse','all'],default='all')
    parser.add_argument('--no-render',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    for species in (['cow','horse'] if args.species=='all' else [args.species]):
        build(species,not args.no_render)
