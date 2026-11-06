"""Blender (background) side of the 3D pose guide. Run:
  blender.exe -b --factory-startup --python blender_guide.py -- <job.json>
job.json: {glb, out_dir, reg: {top_px, bottom_px, cx_px, W, H}, joints: {name: [x_px, y_px]},
           poses: {pose: {name: [x_px, y_px, dy_world]}}, views: {view: {yaw, pitch, box: [x,y,side]}}}
Writes <out_dir>/<pose>_sil.png, <pose>_depth.png and <out_dir>/joints3d.json (the posed joints projected to
master pixels). The mesh is a guide only: it never ships.
"""
import json
import math
import sys

import bpy
import bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
OUT = job["out_dir"]
R = job["reg"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["glb"])
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in bpy.context.scene.objects:
    o.select_set(o.type == "MESH")
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
# bone heat fails on a 1-unit-tall mesh (its solver tolerances are absolute): work at 10x
SC = 10.0
ob.scale = ob.scale * SC
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# bone heat fails on the raw TRELLIS mesh (open, self-intersecting shells): a voxel remesh makes it one
# closed surface first
rm = ob.modifiers.new("rm", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = job.get("voxel", 0.004) * SC
bpy.ops.object.modifier_apply(modifier="rm")
dec = ob.modifiers.new("dec", "DECIMATE")
dec.ratio = min(1.0, 30000 / max(1, len(ob.data.polygons)))
bpy.ops.object.modifier_apply(modifier="dec")

vs = [v.co.copy() for v in ob.data.vertices]
zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
xmin, xmax = min(v.x for v in vs), max(v.x for v in vs)
ymin = min(v.y for v in vs)
# master px -> world: image x = +X (front faces -Y, camera on -Y looking +Y), image y down = -Z
s = (zmax - zmin) / (R["bottom_px"] - R["top_px"])            # world units per master px
x0 = (xmin + xmax) / 2 - R["cx_px"] * s
z0 = zmax + R["top_px"] * s
if "s" in R:      # refined registration from reg_search.py (best upper-body silhouette IoU)
    s, x0, z0 = R["s"] * SC, R["x0"] * SC, R["z0"] * SC


def px2w(x, y):
    return x0 + x * s, z0 - y * s


def w2px(p):
    return [(p.x - x0) / s, (z0 - p.z) / s]


bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())


def depth_mid(x, y):
    """Mid depth of the mesh along the camera ray through master pixel (x, y): first and last hit."""
    X, Z = px2w(x, y)
    hits = []
    o = Vector((X, ymin - 1.0 * SC, Z))
    d = Vector((0, 1, 0))
    for _ in range(8):
        h = bvh.ray_cast(o, d)
        if h[0] is None:
            break
        hits.append(h[0].y)
        o = h[0] + d * 1e-4
    if not hits:
        return None
    return (hits[0] + hits[-1]) / 2


J3 = {}
for k, (x, y) in job["joints"].items():
    yy = None
    for r in (0, 4, 8, 14, 22):
        for dx, dy in ((0, 0), (r, 0), (-r, 0), (0, r), (0, -r)):
            yy = depth_mid(x + dx, y + dy)
            if yy is not None:
                break
        if yy is not None:
            break
    X, Z = px2w(x, y)
    J3[k] = Vector((X, yy if yy is not None else (ymin + 0.1 * SC), Z))

BONES = job["bones"]       # name: [head_joint, tail_joint, parent]
bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
arm = bpy.context.object
eb = arm.data.edit_bones
eb.remove(eb[0])
for name, (h, t, par) in BONES.items():
    b = eb.new(name)
    b.head, b.tail = J3[h], J3[t]
for name, (h, t, par) in BONES.items():
    if par:
        eb[name].parent = eb[par]
        eb[name].use_connect = False
bpy.ops.object.mode_set(mode="OBJECT")

bpy.ops.object.select_all(action="DESELECT")
ob.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
weights = "auto"
try:
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    if not any(len(v.groups) for v in ob.data.vertices):
        raise RuntimeError("bone heat gave no weights")
except Exception as e:  # noqa: BLE001
    # bone heat fails on this mesh even remeshed and at 10x (measured). Fallback: distance weights, a soft
    # min over the bone segments (sigma 1 cm at model scale), which is all a pose guide needs.
    print("auto weights failed:", e)
    ob.vertex_groups.clear()
    bpy.ops.object.parent_set(type="ARMATURE_NAME")
    segs = {n: (J3[h], J3[t]) for n, (h, t, p) in BONES.items()}
    groups = {n: ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n) for n in BONES}
    sig = 0.01 * SC
    for v in ob.data.vertices:
        ds = {}
        for n, (A, Bp) in segs.items():
            ab = Bp - A
            t = max(0.0, min(1.0, (v.co - A).dot(ab) / max(ab.length_squared, 1e-9)))
            ds[n] = (v.co - (A + ab * t)).length
        dm = min(ds.values())
        w = {n: math.exp(-(d - dm) / sig) for n, d in ds.items() if d - dm < 4 * sig}
        tot = sum(w.values())
        for n, x in w.items():
            groups[n].add([v.index], x / tot, "REPLACE")
    weights = "distance"
unweighted = sum(1 for v in ob.data.vertices if not v.groups)

# render setup: Cycles CPU (Workbench renders a wrong view in background on this machine)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 16
sc.render.resolution_x, sc.render.resolution_y = R["W"], R["H"]
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "Standard"
cam_d = bpy.data.cameras.new("cam")
cam_d.type = "ORTHO"
cam_d.ortho_scale = R["H"] * s
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cx, cz = px2w(R["W"] / 2, R["H"] / 2)
cam.location = (cx, ymin - 2.0 * SC, cz)
cam.rotation_euler = (math.pi / 2, 0, 0)
cam_d.clip_start, cam_d.clip_end = 0.01, 100

# one emission material whose colour is camera depth: white near, dark far (a depth map), alpha = coverage
mat = bpy.data.materials.new("depth")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
outn = nt.nodes.new("ShaderNodeOutputMaterial")
em = nt.nodes.new("ShaderNodeEmission")
geo = nt.nodes.new("ShaderNodeNewGeometry")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
mr = nt.nodes.new("ShaderNodeMapRange")
mr.inputs["From Min"].default_value = ymin - 0.02 * SC
mr.inputs["From Max"].default_value = max(v.y for v in vs) + 0.02 * SC
mr.inputs["To Min"].default_value = 1.0
mr.inputs["To Max"].default_value = 0.15
nt.links.new(geo.outputs["Position"], sep.inputs[0])
nt.links.new(sep.outputs["Y"], mr.inputs["Value"])
sepn = nt.nodes.new("ShaderNodeSeparateXYZ")
nt.links.new(geo.outputs["Normal"], sepn.inputs[0])
face = nt.nodes.new("ShaderNodeMath"); face.operation = "MULTIPLY"; face.inputs[1].default_value = -0.55
nt.links.new(sepn.outputs["Y"], face.inputs[0])
mix = nt.nodes.new("ShaderNodeMath"); mix.operation = "MULTIPLY_ADD"
mix.inputs[1].default_value = 0.6
nt.links.new(mr.outputs["Result"], mix.inputs[0])
nt.links.new(face.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], em.inputs["Color"])
nt.links.new(em.outputs[0], outn.inputs["Surface"])
ob.data.materials.clear()
ob.data.materials.append(mat)
sc.world = bpy.data.worlds.new("w")
sc.world.color = (0, 0, 0)


def set_pose(targets):
    """Point each bone at its target joint. targets: joint -> [x_px, y_px, dy_world]; joints not listed
    keep their rest place relative to the parent."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()
    if "_root" in targets:                          # move the whole body (land: hips drop, feet stay down)
        dx, dy = targets["_root"][:2]
        pb = arm.pose.bones[next(iter(BONES))]
        pb.matrix = Matrix.Translation(Vector((dx * s, 0, -dy * s))) @ pb.matrix
        bpy.context.view_layer.update()
    tw = {}
    for j, v in targets.items():
        if not j.startswith("_"):
            X, Z = px2w(v[0], v[1])
            tw[j] = Vector((X, J3[j].y + v[2] * SC, Z))
    # two-bone IK for a leg: ankle target given, the knee goes forward (-Y) plus a sideways bias in the bend plane
    for upper, lower, a_t, side in targets.get("_ik", []):
        pu, pl = arm.pose.bones[upper], arm.pose.bones[lower]
        H = arm.matrix_world @ pu.head
        X, Z = px2w(a_t[0], a_t[1])
        A = Vector((X, J3[BONES[lower][1]].y + a_t[2] * SC, Z))
        Lt, Ls = pu.length, pl.length
        d = min((A - H).length, (Lt + Ls) * 0.999)
        u = (A - H).normalized()
        A = H + u * d
        a = (Lt * Lt - Ls * Ls + d * d) / (2 * d)
        hgt = math.sqrt(max(Lt * Lt - a * a, 0.0))
        fwd = Vector((side, -1.0, 0.0))
        n = (fwd - u * fwd.dot(u)).normalized()
        tw[BONES[upper][1]] = H + u * a + n * hgt
        tw[BONES[lower][1]] = A
    for name, (h, t, par) in BONES.items():       # BONES is ordered parent-first
        if t not in tw:
            continue
        tgt = tw[t]
        pb = arm.pose.bones[name]
        bpy.context.view_layer.update()
        head = arm.matrix_world @ pb.head
        cur = (arm.matrix_world @ pb.tail) - head
        want = tgt - head
        q = cur.rotation_difference(want)
        M = pb.matrix.copy()
        loc = M.to_translation()
        R3 = q.to_matrix() @ M.to_3x3()
        pb.matrix = Matrix.Translation(loc) @ R3.to_4x4()
        bpy.context.view_layer.update()
    pos = {}
    for name, (h, t, par) in BONES.items():
        pb = arm.pose.bones[name]
        pos[h] = w2px(arm.matrix_world @ pb.head)
        pos[t] = w2px(arm.matrix_world @ pb.tail)
    bpy.ops.object.mode_set(mode="OBJECT")
    return pos


REST_LEN = [(e.vertices[0], e.vertices[1], (ob.data.vertices[e.vertices[0]].co - ob.data.vertices[e.vertices[1]].co).length)
            for e in ob.data.edges]


def render_unstretched(limit=2.2):
    """Render the posed mesh without faces stretched past `limit` x their rest edge length. The model's left
    hand is fused to the hip, so lifting that arm pulls a membrane of waist out with it; dropping those faces
    leaves the arm and the body; the bone overlay and depth carry that arm."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bad = set()
    for (i, j, L) in REST_LEN:
        if (me.vertices[i].co - me.vertices[j].co).length > limit * max(L, 1e-6):
            bad.add(i); bad.add(j)
    bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if sum(v.index in bad for v in f.verts) >= 2], context="FACES")
    bm.to_mesh(me); bm.free()
    tmp = bpy.data.objects.new("tmp", me)
    sc.collection.objects.link(tmp)
    tmp.matrix_world = ob.matrix_world.copy()
    ob.hide_render = True
    bpy.ops.render.render(write_still=True)
    ob.hide_render = False
    bpy.data.objects.remove(tmp)
    bpy.data.meshes.remove(me)


report = {"weights": weights, "unweighted_verts": unweighted, "tris": len(ob.data.polygons), "s": s / SC,
          "x0": x0 / SC, "z0": z0 / SC, "poses": {}}
only = job.get("only")
for pose, targets in job["poses"].items():
    if only and pose not in only:
        continue
    report["poses"][pose] = set_pose(targets)
    sc.render.filepath = f"{OUT}/{pose}_depth.png"
    render_unstretched()

# head views: turn the head bone, render a close-up framed on the head box
for view, v in job.get("views", {}).items():
    if only and view not in only:
        continue
    set_pose({})
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones["head"]
    pb.rotation_mode = "XYZ"
    # bone-local axes vary; rotate in world: yaw about Z (+ = toward image right), pitch about X (+ = chin down)
    M = pb.matrix.copy()
    Rw = Matrix.Rotation(math.radians(v["yaw"]), 4, "Z") @ Matrix.Rotation(math.radians(v["pitch"]), 4, "X")
    loc = M.to_translation()
    pb.matrix = Matrix.Translation(loc) @ Rw @ Matrix.Translation(-loc) @ M
    bpy.ops.object.mode_set(mode="OBJECT")
    bx, by, side = v["box"]
    sc.render.resolution_x = sc.render.resolution_y = 1024
    cam_d.ortho_scale = side * s
    ccx, ccz = px2w(bx + side / 2, by + side / 2)
    cam.location = (ccx, ymin - 2.0 * SC, ccz)
    sc.render.filepath = f"{OUT}/{view}_depth.png"
    render_unstretched()
    sc.render.resolution_x, sc.render.resolution_y = R["W"], R["H"]
    cam_d.ortho_scale = R["H"] * s
    cam.location = (cx, ymin - 2.0 * SC, cz)

json.dump(report, open(f"{OUT}/joints3d.json", "w"), indent=1)
print("GUIDE_DONE", json.dumps({k: report[k] for k in ("weights", "unweighted_verts", "tris")}))
