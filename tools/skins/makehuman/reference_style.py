"""Editable geometry and procedural materials for the supplied two-photo reference.

No photograph is pasted onto the mesh. Clothing, ribbon and fringe remain real geometry
and follow the armature. Coordinates are metres in MakeHuman's Z-up rest space.
"""
import math
import random
import pathlib

import bpy
import bmesh
from mathutils import Vector


def color(rgb):
    return tuple(c / 3294.6 if c < 10.31475 else ((c / 255 + .055) / 1.055) ** 2.4 for c in rgb) + (1,)


def material(name, rgb, roughness=.5, metallic=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = color(rgb)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    return m


def mesh(name, verts, faces, mat, rig, bone='spine02', subdiv=2):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for p in data.polygons:
        p.use_smooth = True
    group = obj.vertex_groups.new(name=bone)
    group.add(list(range(len(verts))), 1., 'REPLACE')
    arm = obj.modifiers.new('Follow skeleton', 'ARMATURE')
    arm.object = rig
    if subdiv:
        sub = obj.modifiers.new('Tailored surface', 'SUBSURF')
        sub.levels = sub.render_levels = subdiv
    return obj


def cloth(mat, scale=450):
    n, l = mat.node_tree.nodes, mat.node_tree.links
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = 2
    bump = n.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = .16
    bump.inputs['Distance'].default_value = .0003
    l.new(noise.outputs['Fac'], bump.inputs['Height'])
    l.new(bump.outputs['Normal'], n.get('Principled BSDF').inputs['Normal'])
    n.get('Principled BSDF').inputs['Sheen Weight'].default_value = .22


def cropped_blouse(shirt, body):
    # Bisect rather than deleting whole quads: a continuous hem survives subdivision.
    bm = bmesh.new()
    bm.from_mesh(shirt.data)
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                          plane_co=(0, 0, 1.015), plane_no=(0, 0, 1), clear_inner=True)
    for v in bm.verts:
        if v.co.z < 1.06:
            t = max(0, (1.06-v.co.z)/.045)
            # Offset front hem echoes the overlapping triangular front in the photo.
            v.co.z += t * (.018 if v.co.x < 0 else -.018) * max(0, -v.co.y/.13)
            v.co.x *= 1 + .055*t
            v.co.y *= 1 + .045*t
    bm.to_mesh(shirt.data)
    bm.free()
    states=[(m,m.show_viewport) for m in body.modifiers]
    for m,_ in states: m.show_viewport=False
    bpy.context.view_layer.update()
    evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    skin=evaluated.to_mesh()
    exposed=[v.index for v in skin.vertices if v.co.z < 1.065]
    evaluated.to_mesh_clear()
    for m,shown in states: m.show_viewport=shown
    for mod in body.modifiers:
        if mod.type == 'MASK' and 'shirt' in mod.vertex_group.lower():
            body.vertex_groups[mod.vertex_group].remove(exposed)
    cotton = material('Ivory white cotton poplin', (237, 240, 244), .76)
    cloth(cotton)
    shirt.data.materials.clear()
    shirt.data.materials.append(cotton)
    for p in shirt.data.polygons:
        p.material_index = 0
    solid = shirt.modifiers.new('Sewn hem thickness', 'SOLIDIFY')
    solid.thickness = .0012


def plaid_material():
    m = material('Woven slate tartan — navy ivory burgundy', (112, 126, 148), .84)
    n, l = m.node_tree.nodes, m.node_tree.links
    coord = n.new('ShaderNodeTexCoord')
    sep = n.new('ShaderNodeSeparateXYZ')
    l.new(coord.outputs['UV'], sep.inputs[0])

    def mathnode(op, a, b):
        node = n.new('ShaderNodeMath')
        node.operation = op
        for sock, val in zip(node.inputs, (a, b)):
            if isinstance(val, (float, int)):
                sock.default_value = val
            else:
                l.new(val, sock)
        return node.outputs[0]

    out = None
    # Metric UVs make the checks square and stable during all poses.
    for axis in ('X', 'Y'):
        phase = mathnode('PINGPONG', mathnode('MULTIPLY', sep.outputs[axis], 1/.085), 1.)
        for centre, width, rgb in ((.18, .105, (42, 53, 73)), (.18, .031, (210, 215, 219)),
                                   (.39, .047, (35, 46, 63)), (.72, .012, (116, 63, 74))):
            distance = mathnode('ABSOLUTE', mathnode('SUBTRACT', phase, centre), 0)
            mask = mathnode('LESS_THAN', distance, width)
            mix = n.new('ShaderNodeMixRGB')
            l.new(mask, mix.inputs[0])
            if out is None:
                mix.inputs[1].default_value = color((112, 126, 148))
            else:
                l.new(out, mix.inputs[1])
            mix.inputs[2].default_value = color(rgb)
            out = mix.outputs[0]
    l.new(out, n.get('Principled BSDF').inputs['Base Color'])
    cloth(m)
    return m


def tailored_skirt(old, rig, body):
    bpy.data.objects.remove(old, do_unlink=True)
    # Continuous fitted silhouette, with a separate 3 cm waistband, no accordion pleats.
    rings = [( .656,.162,.119),(.658,.162,.119),(.68,.162,.12),(.74,.161,.124),
             (.81,.157,.125),(.85,.149,.119),(.89,.135,.108),(.918,.124,.098),
             (.92,.124,.098),(.944,.122,.096),(.946,.122,.096)]
    count=96
    # Fit the garment to evaluated morphs, not the unmodified basis mesh.
    states=[(m,m.show_viewport) for m in body.modifiers]
    for m,_ in states: m.show_viewport=False
    bpy.context.view_layer.update()
    ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    skin=ev.to_mesh()
    bodygroup=body.vertex_groups['body'].index
    points=[v.co.copy() for v in skin.vertices if abs(v.co.x)<.23 and
            any(g.group==bodygroup for g in body.data.vertices[v.index].groups)]
    ev.to_mesh_clear()
    for m,show in states: m.show_viewport=show
    verts=[]
    for z,rx,ry in rings:
        band=[p for p in points if abs(p.z-z)<.018]
        rx=max(rx,max(abs(p.x) for p in band)+.009)
        front=min(p.y for p in band)-.012
        back=max(p.y for p in band)+.012
        cy=(front+back)/2
        ry=max(ry,(back-front)/2)
        for j in range(count):
            a=j/count*2*math.pi
            sn,cs=math.sin(a),math.cos(a)
            verts.append((rx*math.copysign(abs(sn)**.86,sn),cy-ry*math.copysign(abs(cs)**.86,cs),z))
    faces=[(i*count+j,i*count+(j+1)%count,(i+1)*count+(j+1)%count,(i+1)*count+j)
           for i in range(len(rings)-1) for j in range(count)]
    obj=mesh('Reference.plaid_skirt',verts,faces,plaid_material(),rig,'root',2)
    uv=obj.data.uv_layers.new(name='Metric woven cloth')
    for p in obj.data.polygons:
        start=p.index%count
        for li in p.loop_indices:
            vi=obj.data.loops[li].vertex_index
            j=vi%count
            u=(count if j==0 and start==count-1 else j)/count*2*math.pi*.145
            uv.data[li].uv=(u,verts[vi][2])
    solid=obj.modifiers.new('Woven fabric thickness','SOLIDIFY')
    solid.thickness=.0018
    return obj


def ribbon(rig):
    satin=material('Black grosgrain ribbon',(12,15,22),.68)
    satin.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value=.2
    cloth(satin,650)
    # Folded bow loops, with a raised centre and downward tails.
    for side in (-1,1):
        verts=[]
        for i in range(13):
            t=i/12
            for j in range(5):
                w=j/4*2-1
                x=side*(.006+.065*t)
                z=1.247-.022*t+w*(.008+.020*math.sin(math.pi*t/2))
                y=-.092-.024*math.sin(math.pi*t)-.007*(1-w*w)
                verts.append((x,y,z))
        faces=[(i*5+j,i*5+j+1,(i+1)*5+j+1,(i+1)*5+j) for i in range(12) for j in range(4)]
        mesh('Reference.bow_loop',verts,faces,satin,rig,'spine01')
        verts=[]
        for i in range(13):
            t=i/12
            for j in range(5):
                w=j/4*2-1
                verts.append((side*(.012+.032*t)+w*.015,
                              -.103-.047*t-.004*math.sin(t*math.pi*3+w),
                              1.24-.105*t + .008*w*side))
        mesh('Reference.bow_tail',verts,faces,satin,rig,'spine01')
    pearl=material('Pearl silver brooch',(221,223,225),.22,.35)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=(0,-.12,1.243),scale=(.008,.005,.008))
    o=bpy.context.object
    o.name='Reference.pearl_brooch'
    bpy.ops.object.transform_apply(location=True,rotation=False,scale=True)
    o.data.materials.append(pearl)
    g=o.vertex_groups.new(name='spine01')
    g.add(list(range(len(o.data.vertices))),1,'REPLACE')
    o.modifiers.new('Follow collar','ARMATURE').object=rig
    for p in o.data.polygons: p.use_smooth=True


HAIR_TINT=(.68,.52,.38,1)   # multiplies the asset's brown strand map: light chestnut


def hair_material(hair):
    """Light-brown version of the asset's own strand/alpha maps."""
    for mat in hair.data.materials:
        n,l=mat.node_tree.nodes,mat.node_tree.links
        bs=n.get('Principled BSDF')
        if not bs: continue
        socket=bs.inputs['Base Color']
        if socket.is_linked:
            source=socket.links[0].from_socket
            mul=n.new('ShaderNodeMixRGB'); mul.blend_type='MULTIPLY'
            mul.inputs[0].default_value=1
            mul.inputs[2].default_value=HAIR_TINT
            l.new(source,mul.inputs[1]); l.new(mul.outputs[0],socket)
        bs.inputs['Roughness'].default_value=.42


def card_material(base):
    """Hair-card shader: many fine strands across each card (noise stretched along the card),
    ragged see-through tips and a little per-strand shading, like game hair cards."""
    m=material('Light chestnut bangs',base,.38)
    n,l=m.node_tree.nodes,m.node_tree.links
    p=n.get('Principled BSDF')
    p.inputs['Anisotropic'].default_value=.6
    coord=n.new('ShaderNodeTexCoord'); sep=n.new('ShaderNodeSeparateXYZ')
    l.new(coord.outputs['UV'],sep.inputs[0])

    def noise(scale_u,scale_v,detail):
        mapping=n.new('ShaderNodeMapping'); mapping.inputs['Scale'].default_value=(scale_u,scale_v,1)
        tex=n.new('ShaderNodeTexNoise'); tex.inputs['Detail'].default_value=detail
        tex.inputs['Scale'].default_value=1
        l.new(coord.outputs['UV'],mapping.inputs['Vector']); l.new(mapping.outputs[0],tex.inputs['Vector'])
        return tex.outputs['Fac']

    strands=noise(38,2.5,3)
    streak=n.new('ShaderNodeMapRange')
    streak.inputs['From Min'].default_value,streak.inputs['From Max'].default_value=.50,.55
    l.new(strands,streak.inputs['Value'])
    ragged=noise(9,.6,1)
    start=n.new('ShaderNodeMapRange')          # where this bundle of strands starts to thin out
    start.inputs['From Min'].default_value,start.inputs['From Max'].default_value=0,1
    start.inputs['To Min'].default_value,start.inputs['To Max'].default_value=.35,.85
    l.new(ragged,start.inputs['Value'])
    fade=n.new('ShaderNodeMapRange')
    fade.inputs['To Min'].default_value,fade.inputs['To Max'].default_value=1,0
    l.new(start.outputs[0],fade.inputs['From Min']); fade.inputs['From Max'].default_value=1.0
    l.new(sep.outputs['Y'],fade.inputs['Value'])
    alpha=n.new('ShaderNodeMath'); alpha.operation='MULTIPLY'
    l.new(streak.outputs[0],alpha.inputs[0]); l.new(fade.outputs[0],alpha.inputs[1])
    soft=n.new('ShaderNodeMath'); soft.operation='MULTIPLY'; soft.inputs[1].default_value=.95
    l.new(alpha.outputs[0],soft.inputs[0]); l.new(soft.outputs[0],p.inputs['Alpha'])
    shade=n.new('ShaderNodeMapRange')
    shade.inputs['To Min'].default_value,shade.inputs['To Max'].default_value=.5,1.0
    l.new(strands,shade.inputs['Value'])
    tint=n.new('ShaderNodeMixRGB'); tint.blend_type='MULTIPLY'; tint.inputs[0].default_value=1
    tint.inputs[1].default_value=color(base)
    l.new(shade.outputs[0],tint.inputs[2]); l.new(tint.outputs[0],p.inputs['Base Color'])
    return m


def rest_skin(body):
    """Vertex positions of the shaped body skin (targets applied, modifiers off, helper
    geometry such as the hair and eye helpers left out)."""
    states=[(m,m.show_viewport) for m in body.modifiers]
    for m,_ in states: m.show_viewport=False
    bpy.context.view_layer.update()
    ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
    group=body.vertex_groups['body'].index
    skin={v.index for v in body.data.vertices if any(g.group==group for g in v.groups)}
    points=[v.co.copy() for v in ev.to_mesh().vertices if v.index in skin]
    ev.to_mesh_clear()
    for m,shown in states: m.show_viewport=shown
    return points


def wispy_bangs(hair,rig,body,brows):
    """See-through bangs and face-framing locks over the tied-back scalp asset.

    Overlapping hair cards (2.5 cm wide strips with a strand alpha texture) rather than
    hair-fine curves: at sprite scale (about 2 mm per pixel) single strands vanish, while cards
    with see-through strand gaps read as an airy fringe. Each card starts under the scalp
    asset's front edge, hugs the measured forehead surface a few millimetres out, sweeps
    sideways from a part just left of centre, and thins out around the brows."""
    hair_material(hair)
    hairmat=card_material((80,52,32))
    brow=max(Vector(c).z for c in brows.bound_box)
    skin=[p for p in rest_skin(body) if p.y<-.03 and p.z>brow-.2 and abs(p.x)<.1]
    front=[v.co for v in hair.data.vertices if v.co.y<-.04 and v.co.z>brow]

    def hairline(x):
        column=sorted(v.z for v in front if abs(v.x-x)<.012)
        return column[len(column)//25] if column else brow+.07

    def surface(x,z):
        """Frontmost skin y near (x, z): the forehead or cheek the lock lies against."""
        near=[p.y for p in skin if abs(p.x-x)<.009 and abs(p.z-z)<.009]
        return min(near) if near else -.1

    rng=random.Random(2024)

    def card(path,width,gap):
        """Strip along `path` (list of (x, z) control points), `gap` mm in front of the skin,
        5 vertices across so it wraps round the forehead."""
        verts,uvs=[],[]
        for i in range(13):
            t=i/12
            w=[(1-t)**3,3*(1-t)**2*t,3*(1-t)*t*t,t**3]
            x=sum(path[j][0]*w[j] for j in range(4)); z=sum(path[j][1]*w[j] for j in range(4))
            for j in range(5):
                u=j/4
                xx=x+(u-.5)*width
                verts.append((xx,surface(xx,z)-gap,z))
                uvs.append((u,t))
        faces=[(i*5+j,i*5+j+1,(i+1)*5+j+1,(i+1)*5+j) for i in range(12) for j in range(4)]
        return verts,faces,uvs

    locks=[]
    for layer in (0,1):
        for k in range(7):
            q=((k+.5*layer)/6.5)*2-1
            x=q*.05+rng.uniform(-.003,.003)
            top=hairline(x)
            end=brow-.008-.008*abs(q)+rng.uniform(-.004,.004)+.004*layer
            side=1 if q>-.15 else -1
            sweep=side*(.004+.014*abs(q+.15))+rng.uniform(-.003,.003)
            path=[(x,top+.012),(x+sweep*.2,top-.012),(x+sweep*.65,end+.02),(x+sweep,end)]
            locks.append(card(path,.026,.0035+.002*layer))
    # Face-framing locks in front of each ear, lying along the cheek to the jaw.
    for sx in (-1,1):
        for k in range(2):
            x=sx*(.066+k*.006); top=hairline(x)-.012-k*.008
            path=[(x,top),(x+sx*.006,top-.045),(x+sx*.004,top-.09),(x-sx*.004,top-.125-k*.015)]
            locks.append(card(path,.014-k*.003,.004))
    for verts,faces,uvs in locks:
        obj=mesh('Reference.bangs',verts,faces,hairmat,rig,'head',1)
        uv=obj.data.uv_layers.new(name='Strand')
        for poly in obj.data.polygons:
            for li in poly.loop_indices:
                uv.data[li].uv=uvs[obj.data.loops[li].vertex_index]


def warm_skin(body):
    """The fair caucasian skin map renders chalky under the studio lights: mix a little peach in."""
    group=next(n for n in body.active_material.node_tree.nodes if n.type=='GROUP')
    group.inputs['colorMixIn'].default_value=color((228,176,146))
    group.inputs['colorMixInStrength'].default_value=.4


def apply(body,rig,find,hair):
    cropped_blouse(find('shirt'),body)
    tailored_skirt(find('skirt'),rig,body)
    ribbon(rig)
    wispy_bangs(find(hair),rig,body,find('eyebrow'))
    tint_brows(find('eyebrow'))
    lip_tint(body)
    warm_skin(body)
    wire_glasses(find('glasses'),rig)
    # Use the supplied MakeHuman brown iris texture, preserving the white sclera.
    from bl_ext.user_default.mpfb.services.locationservice import LocationService
    path=pathlib.Path(LocationService.get_user_data('eyes'))/'materials'/'brown_eye.png'
    for mat in find('high-poly').data.materials:
        n,l=mat.node_tree.nodes,mat.node_tree.links
        for node in list(n):
            if node.type=='TEX_IMAGE' and node.image and 'normal' not in node.image.name.lower():
                node.image=bpy.data.images.load(str(path),check_existing=True)
                # Deep brown iris: darken the map on its way to whatever it feeds.
                for link in list(node.outputs['Color'].links):
                    mul=n.new('ShaderNodeMixRGB'); mul.blend_type='MULTIPLY'; mul.inputs[0].default_value=1
                    mul.inputs[2].default_value=(.55,.42,.36,1)
                    target=link.to_socket; l.remove(link)
                    l.new(node.outputs['Color'],mul.inputs[1]); l.new(mul.outputs[0],target)


def wire_glasses(old,rig):
    """Thin, truly round silver rims, curved bridge, clear open lenses and ear temples."""
    old.hide_render=True
    old.hide_set(True)
    eye=rig.data.bones['eye.L'].head_local
    z=eye.z-.001
    y=eye.y-.030
    metal=material('Polished silver spectacle wire',(196,202,210),.22,1)
    paths=[]
    for s in (-1,1):
        cx=s*.032
        paths.append([(cx+.0245*math.cos(i/96*math.tau),y+.003*math.cos(i/96*math.tau)**2,
                       z+.0235*math.sin(i/96*math.tau)) for i in range(97)])
        paths.append([(s*.0565,y+.003,z+.004),(s*.066,y+.018,z+.005),
                      (s*.071,-.045,z+.006),(s*.069,-.021,z+.001),(s*.067,-.015,z-.009)])
    paths.append([(-.0085+i/24*.017,y-.001,z+.006+.004*math.sin(i/24*math.pi)) for i in range(25)])
    curve=bpy.data.curves.new('Silver eyewire','CURVE')
    curve.dimensions='3D';curve.bevel_depth=.00055;curve.bevel_resolution=3
    for pts in paths:
        sp=curve.splines.new('POLY');sp.points.add(len(pts)-1)
        for p,co in zip(sp.points,pts): p.co=(*co,1)
    obj=bpy.data.objects.new('Reference.silver_glasses',curve)
    bpy.context.collection.objects.link(obj);curve.materials.append(metal)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.convert(target='MESH')
    obj=bpy.context.object
    g=obj.vertex_groups.new(name='head');g.add(list(range(len(obj.data.vertices))),1,'REPLACE')
    obj.modifiers.new('Follow head','ARMATURE').object=rig
    obj.select_set(False)


def lip_tint(body):
    """Natural pink lips: the orbicularis-oris bone weights outline the lips, and that weight
    mixes a rose tone into the skin texture inside MPFB's skin node group."""
    names=body.vertex_groups
    lips=body.vertex_groups.new(name='lips')
    for v in body.data.vertices:
        w=sum(g.weight for g in v.groups if names[g.group].name.startswith('oris'))
        if w>.2:
            lips.add([v.index],min(1.,(w-.2)*1.6),'REPLACE')
    group=next(n for n in body.active_material.node_tree.nodes if n.type=='GROUP')
    tree=group.node_tree
    n,l=tree.nodes,tree.links
    tex=next(node for node in n if node.type=='TEX_IMAGE' and node.image and 'normal' not in node.image.name.lower())
    targets=[(lk.to_node,lk.to_socket) for lk in tree.links if lk.from_node==tex and lk.from_socket.name=='Color']
    attr=n.new('ShaderNodeAttribute'); attr.attribute_name='lips'
    mix=n.new('ShaderNodeMixRGB'); mix.blend_type='MIX'
    mix.inputs[2].default_value=color((214,118,122))
    strength=n.new('ShaderNodeMath'); strength.operation='MULTIPLY'; strength.inputs[1].default_value=.6
    l.new(attr.outputs['Fac'],strength.inputs[0]); l.new(strength.outputs[0],mix.inputs[0])
    l.new(tex.outputs['Color'],mix.inputs[1])
    for node,socket in targets:
        l.new(mix.outputs[0],socket)


def tint_brows(brows):
    """Soft light-brown brows to go with the hair."""
    for mat in brows.data.materials:
        n,l=mat.node_tree.nodes,mat.node_tree.links
        bs=n.get('Principled BSDF')
        if not bs or not bs.inputs['Base Color'].is_linked: continue
        source=bs.inputs['Base Color'].links[0].from_socket
        mix=n.new('ShaderNodeMixRGB'); mix.blend_type='MIX'; mix.inputs[0].default_value=.3
        mix.inputs[2].default_value=color((110,80,55))
        l.new(source,mix.inputs[1]); l.new(mix.outputs[0],bs.inputs['Base Color'])
