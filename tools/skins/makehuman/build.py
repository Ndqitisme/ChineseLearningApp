"""Builds the assistant with MakeHuman (MPFB2 in Blender) and renders it into sprite frames.

The character is assembled from CC0 / CC-BY MakeHuman community assets (credits in
tools/skins/pack.py): young Asian woman, fair skin, brown ponytail, round glasses, denim
short-sleeve shirt, charcoal pleated mini skirt. Calm hand-keyed animations play at real speed
and are rendered to transparent PNGs + meta.json for tools/skins/pack.py.

Run (Blender 4.5 with MPFB and its asset packs installed, see README):
  blender -b --python tools/skins/makehuman/build.py -- probe            # rest pose still
  blender -b --python tools/skins/makehuman/build.py -- frames rest wave_1  # chosen frames
  blender -b --python tools/skins/makehuman/build.py -- face             # two face close-ups
  blender -b --python tools/skins/makehuman/build.py -- check            # IK misses, interpenetration, silhouette
  blender -b --python tools/skins/makehuman/build.py -- full             # all frames + meta.json
"""
import json
import math
import pathlib
import sys

import bpy
import bmesh
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.locationservice import LocationService

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / ".cache" / "render3d" / "frames"
MODE = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "probe"
W, H = 460, 840


def log(*a):
    print("[build]", *a, flush=True)


def srgb(r, g, b):
    """sRGB 0-255 to the linear RGBA Blender expects in node sockets."""
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), 1.0)


# ---------------------------------------------------------------- character
PHENOTYPE = {
    "gender": 0.0, "age": 0.46, "muscle": 0.45, "weight": 0.40, "proportions": 0.9,
    "height": 0.45, "cupsize": 0.55, "firmness": 0.7,
    "race": {"asian": 1.0, "caucasian": 0.0, "african": 0.0},
}
# MakeHuman modelling targets (data/targets/<category>/<name>) applied before the clothes are
# fitted, so the clothes follow the shaped body. Slim fashion-model build: long legs, small
# waist, moderate bust, narrow hips (about 87-58-87 cm scaled to 1.68 m, waist/hip 0.68).
BODY_TARGETS = [
    ("measure-hips-circ-decr", 0.3), ("buttocks-volume-decr", 0.25), ("hip-scale-horiz-decr", 0.15),
    ("measure-waist-circ-decr", 0.3), ("stomach-tone-incr", 0.3),
    ("measure-thigh-circ-decr", 0.25), ("measure-calf-circ-decr", 0.15),
    ("upperlegs-height-incr", 0.3), ("lowerlegs-height-incr", 0.25),
    ("torso-vshape-incr", 0.1), ("neck-scale-vert-incr", 0.1), ("neck-scale-horiz-decr", 0.1),
    ("l-hand-scale-decr", 0.25), ("r-hand-scale-decr", 0.25),
    ("l-foot-scale-decr", 0.2), ("r-foot-scale-decr", 0.2),
]
# Larger eyes, narrower nose, fuller lips, softer cheeks and a slightly tapered chin.
FACE_SHAPE = [
    ("l-eye-scale-incr", 0.45), ("r-eye-scale-incr", 0.45),
    ("l-eye-height2-incr", 0.4), ("r-eye-height2-incr", 0.4),
    ("l-eye-corner2-up", 0.15), ("r-eye-corner2-up", 0.15),
    ("nose-width1-decr", 0.25), ("nose-width2-decr", 0.25), ("nose-width3-decr", 0.25),
    ("nose-scale-horiz-decr", 0.2), ("nose-trans-forward", 0.1), ("nose-point-width-decr", 0.2),
    ("mouth-upperlip-volume-incr", 0.35), ("mouth-lowerlip-volume-incr", 0.35),
    ("mouth-cupidsbow-incr", 0.3), ("mouth-scale-horiz-decr", 0.1), ("mouth-angles-up", 0.1),
    ("chin-width-decr", 0.3), ("chin-triangle", 0.3), ("chin-height-decr", 0.1),
    ("l-cheek-bones-incr", 0.2), ("r-cheek-bones-incr", 0.2),
    ("l-cheek-volume-decr", 0.3), ("r-cheek-volume-decr", 0.3),
    ("head-oval", 0.3),
]


def build_human():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    info = {
        "phenotype": PHENOTYPE,
        "rig": "default",
        "eyes": "high-poly/high-poly.mhclo",
        "eyebrows": "eyebrow010/eyebrow010.mhclo",
        "eyelashes": "eyelashes02/eyelashes02.mhclo",
        "teeth": "teeth_base/teeth_base.mhclo",
        "tongue": "tongue01/tongue01.mhclo",
        "hair": "ponytail01/ponytail01.mhclo",
        "proxy": "",
        "targets": [{"target": name, "value": value} for name, value in BODY_TARGETS + FACE_SHAPE],
        "clothes": [
            "elvs_male_shirt_untucked_bd1/elvs_male_shirt_untucked_bd1.mhclo",
            "mtknife_pleated_mini_skirt/mtknife_pleated_mini_skirt.mhclo",
            "toigo_round_glasses_leopard/toigo_round_glasses_leopard.mhclo",
            "shoes04/shoes04.mhclo",
        ],
        "skin_mhmat": "young_asian_female/young_asian_female.mhmat",
        "skin_material_type": "ENHANCED_SSS",
        "eyes_material_type": "MAKESKIN",
        "skin_material_settings": {},
        "eyes_material_settings": {},
        "expressions": [],
        "alternative_materials": {},
    }
    settings = HumanService.get_default_deserialization_settings()
    settings["subdiv_levels"] = 1
    basemesh = HumanService.deserialize_from_dict(info, settings)
    rig = basemesh.parent
    log("objects", [o.name for o in bpy.data.objects])
    log("basemesh modifiers", [(m.type, getattr(m, "vertex_group", "")) for m in basemesh.modifiers])
    return basemesh, rig


def find(part):
    return next(o for o in bpy.data.objects if o.type == "MESH" and part in o.name.lower())


# ---------------------------------------------------------------- styling
SLEEVE_CUT = ("upperarm02", "lowerarm", "wrist", "finger", "metacarpal")


def arm_weight(obj, vertex):
    names = obj.vertex_groups
    return sum(g.weight for g in vertex.groups if names[g.group].name.startswith(SLEEVE_CUT))


def shorten_sleeves(shirt, basemesh):
    """Short sleeves: drop the shirt below mid upper arm and stop masking the skin there.

    The skin is unmasked a little further up than the cut, under the sleeve, so no gap opens."""
    bm = bmesh.new()
    bm.from_mesh(shirt.data)
    bm.verts.ensure_lookup_table()
    doomed = [bm.verts[v.index] for v in shirt.data.vertices if arm_weight(shirt, v) > 0.5]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(shirt.data)
    bm.free()
    shown = [v.index for v in basemesh.data.vertices if arm_weight(basemesh, v) > 0.2]
    for mod in basemesh.modifiers:
        if mod.type == "MASK" and mod.vertex_group in basemesh.vertex_groups and "shirt" in mod.vertex_group.lower():
            basemesh.vertex_groups[mod.vertex_group].remove(shown)
    log("sleeves: removed", len(doomed), "shirt verts, unmasked", len(shown), "skin verts")


def bsdf_of(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def upstream_image(socket):
    """The image texture feeding a socket, through any number of intermediate nodes."""
    for link in socket.links:
        node = link.from_node
        if node.type == "TEX_IMAGE":
            return node
        for inp in node.inputs:
            found = upstream_image(inp)
            if found:
                return found
    return None


def unlink(tree, socket):
    for link in list(socket.links):
        tree.links.remove(link)


def denim(mat):
    """Medium-wash denim: diagonal twill and slub noise, with the original texture's seams kept."""
    tree = mat.node_tree
    nodes, links = tree.nodes, tree.links
    bsdf = bsdf_of(mat)
    tex = upstream_image(bsdf.inputs["Base Color"])
    twill = nodes.new("ShaderNodeTexWave")
    twill.wave_type, twill.bands_direction = "BANDS", "DIAGONAL"
    twill.inputs["Scale"].default_value = 260
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 90
    noise.inputs["Detail"].default_value = 6
    blend = nodes.new("ShaderNodeMix")
    blend.data_type = "FLOAT"
    blend.inputs["Factor"].default_value = 0.45
    links.new(noise.outputs["Fac"], blend.inputs["A"])
    links.new(twill.outputs["Fac"], blend.inputs["B"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.3, 0.75
    ramp.color_ramp.elements[0].color = srgb(64, 90, 130)
    ramp.color_ramp.elements[1].color = srgb(104, 134, 176)
    links.new(blend.outputs["Result"], ramp.inputs["Fac"])
    out = ramp.outputs["Color"]
    if tex:
        # The source texture is near-black with lighter seams/buttons: turn it into a multiplier.
        bw = nodes.new("ShaderNodeRGBToBW")
        detail = nodes.new("ShaderNodeMapRange")
        detail.inputs["From Min"].default_value, detail.inputs["From Max"].default_value = 0.01, 0.06
        detail.inputs["To Min"].default_value, detail.inputs["To Max"].default_value = 0.85, 1.5
        mul = nodes.new("ShaderNodeMix")
        mul.data_type, mul.blend_type = "RGBA", "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        links.new(tex.outputs["Color"], bw.inputs["Color"])
        links.new(bw.outputs["Val"], detail.inputs["Value"])
        links.new(out, mul.inputs["A"])
        links.new(detail.outputs["Result"], mul.inputs["B"])
        out = mul.outputs["Result"]
    unlink(tree, bsdf.inputs["Base Color"])
    links.new(out, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85


def flat(mat, color, roughness):
    """Solid colour; normal/bump maps stay so pleats and folds keep their shading."""
    bsdf = bsdf_of(mat)
    unlink(mat.node_tree, bsdf.inputs["Base Color"])
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness


def glasses_material(glasses):
    """Thin dark-gold metal frame with clear lenses. The lenses use the top band of the
    texture (UV v > 0.72), so those faces get a separate glass material."""
    frame = glasses.active_material
    bsdf = bsdf_of(frame)
    for name in ("Base Color", "Alpha"):
        unlink(frame.node_tree, bsdf.inputs[name])
    bsdf.inputs["Base Color"].default_value = srgb(150, 118, 70)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.3
    bsdf.inputs["Alpha"].default_value = 1.0

    lens = bpy.data.materials.new("lens")
    lens.use_nodes = True
    lb = bsdf_of(lens)
    lb.inputs["Base Color"].default_value = (1, 1, 1, 1)
    lb.inputs["Roughness"].default_value = 0.04
    lb.inputs["Alpha"].default_value = 0.08
    glasses.data.materials.append(lens)
    uv = glasses.data.uv_layers.active.data
    count = 0
    for poly in glasses.data.polygons:
        if min(uv[i].uv.y for i in poly.loop_indices) > 0.72:
            poly.material_index = len(glasses.data.materials) - 1
            count += 1
    log("lens faces", count, "of", len(glasses.data.polygons))


def bare_ankles(shoes, basemesh):
    """shoes04 comes with white socks (the texture square at u > 0.83, v > 0.72): delete the sock
    faces and show the ankle skin the shoes' mask was hiding."""
    uv = shoes.data.uv_layers.active.data
    bm = bmesh.new()
    bm.from_mesh(shoes.data)
    bm.faces.ensure_lookup_table()
    socks = [bm.faces[p.index] for p in shoes.data.polygons
             if all(uv[i].uv.x > 0.83 and uv[i].uv.y > 0.72 for i in p.loop_indices)]
    bmesh.ops.delete(bm, geom=socks, context="FACES")
    bm.to_mesh(shoes.data)
    bm.free()
    names = basemesh.vertex_groups
    ankle = [v.index for v in basemesh.data.vertices
             if sum(g.weight for g in v.groups if names[g.group].name.startswith("lowerleg")) > 0.5]
    for mod in basemesh.modifiers:
        if mod.type == "MASK" and "shoes" in mod.vertex_group.lower():
            names[mod.vertex_group].remove(ankle)
    log("socks: removed", len(socks), "faces")


def smaller_glasses(glasses, factor=0.9):
    """The frames are oversized for this face: shrink them about the bridge, which stays on the
    nose (the temples end a little earlier, under the hair)."""
    bbox = [Vector(c) for c in glasses.bound_box]
    bridge = Vector((0, min(c.y for c in bbox), (min(c.z for c in bbox) + max(c.z for c in bbox)) / 2))
    for v in glasses.data.vertices:
        v.co = bridge + (v.co - bridge) * factor


def restyle(basemesh):
    shorten_sleeves(find("shirt"), basemesh)
    denim(find("shirt").active_material)
    flat(find("skirt").active_material, srgb(66, 68, 75), 0.75)
    glasses_material(find("glasses"))
    smaller_glasses(find("glasses"))
    bare_ankles(find("shoes"), basemesh)
    soften_bust(find("shirt"))


def soften_bust(shirt, radius=0.1):
    """The shirt is a men's model; fitted over the bust it forms two points. Smooth a falloff
    region around the most forward shirt vertex on each side."""
    mw = shirt.matrix_world
    points = [(mw @ v.co, v.index) for v in shirt.data.vertices]
    group = shirt.vertex_groups.new(name="bust")
    for sx in (1, -1):
        side = [(p, i) for p, i in points if p.x * sx > 0.03]
        apex = min(side, key=lambda pi: pi[0].y)[0]
        for p, i in side:
            d = (p - apex).length
            if d < radius:
                group.add([i], 1 - d / radius, "REPLACE")
    smooth = shirt.modifiers.new("bust", "SMOOTH")
    smooth.vertex_group, smooth.factor, smooth.iterations = "bust", 1.0, 16


# ---------------------------------------------------------------- posing
def update():
    bpy.context.view_layer.update()


def head_of(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].head


def tail_of(rig, name):
    return rig.matrix_world @ rig.pose.bones[name].tail


def turn(rig, name, rot):
    """Apply a world-space rotation (3x3) to a pose bone about its head."""
    pb = rig.pose.bones[name]
    mw = rig.matrix_world
    m = mw @ pb.matrix
    pivot = m.translation.copy()
    pb.matrix = mw.inverted() @ (Matrix.Translation(pivot) @ rot.to_4x4() @ Matrix.Translation(-pivot) @ m)
    update()


def aim(rig, name, direction):
    """Swing a bone (minimal rotation) so it points along a world direction."""
    current = (tail_of(rig, name) - head_of(rig, name)).normalized()
    turn(rig, name, current.rotation_difference(Vector(direction).normalized()).to_matrix())


def rotate(rig, name, axis, degrees):
    turn(rig, name, Matrix.Rotation(math.radians(degrees), 3, Vector(axis)))


def reach(rig, side, target, pole):
    """Analytic two-bone IK: put the wrist at `target`, elbow bending towards `pole`."""
    s = f".{side}"
    shoulder = head_of(rig, "upperarm01" + s)
    upper = (tail_of(rig, "upperarm02" + s) - shoulder).length
    lower = (tail_of(rig, "lowerarm02" + s) - head_of(rig, "lowerarm01" + s)).length
    d = Vector(target) - shoulder
    dist = min(max(d.length, abs(upper - lower) + 1e-4), upper + lower - 1e-4)
    dn = d.normalized()
    x = (upper * upper - lower * lower + dist * dist) / (2 * dist)
    h = math.sqrt(max(upper * upper - x * x, 0.0))
    p = Vector(pole) - dn * Vector(pole).dot(dn)
    elbow = shoulder + dn * x + p.normalized() * h
    for bone in ("upperarm01", "upperarm02"):
        aim(rig, bone + s, elbow - head_of(rig, bone + s))
    wrist = shoulder + dn * dist
    for bone in ("lowerarm01", "lowerarm02"):
        aim(rig, bone + s, wrist - head_of(rig, bone + s))


def reset_pose(rig):
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    update()


def head_turn(rig, yaw=0.0, pitch=0.0, roll=0.0):
    """Head rotation in degrees (yaw + = her left, pitch + = chin down, roll + = tilt to her left),
    shared between neck and head so it bends like a neck rather than a hinge."""
    for bone, share in (("neck02", 0.35), ("head", 0.65)):
        rotate(rig, bone, (0, 0, 1), yaw * share)
        rotate(rig, bone, (1, 0, 0), pitch * share)
        rotate(rig, bone, (0, 1, 0), roll * share)


def stance(rig):
    """Weight on the right leg: the pelvis tilts (left hip lower), the spine straightens back up
    with the shoulders settling a little the other way, the legs are re-aimed so the feet stay
    put, and the shoulders drop into a relaxed line."""
    rotate(rig, "root", (0, 1, 0), 3)
    rotate(rig, "spine05", (0, 1, 0), -3)
    rotate(rig, "spine02", (0, 1, 0), -1.5)
    rotate(rig, "upperleg01.L", (0, 1, 0), -3 + 2.5)   # knees a little closer than MakeHuman's stance
    rotate(rig, "upperleg01.R", (0, 1, 0), -3 - 2.5)
    rotate(rig, "clavicle.L", (0, 1, 0), 1.5)
    rotate(rig, "clavicle.R", (0, 1, 0), -1.5)


def breathe(rig, amount):
    """Chest lifts and shoulders rise a little on the in-breath."""
    rotate(rig, "spine03", (1, 0, 0), -1.5 * amount)
    rotate(rig, "clavicle.L", (0, 1, 0), -2.5 * amount)
    rotate(rig, "clavicle.R", (0, 1, 0), 2.5 * amount)


def twist(rig, side, degrees):
    """Roll the forearm (and so the hand) about its own axis, half at each forearm bone."""
    s = f".{side}"
    axis = tail_of(rig, "lowerarm02" + s) - head_of(rig, "lowerarm01" + s)
    for bone in ("lowerarm01", "lowerarm02"):
        rotate(rig, bone + s, axis, degrees / 2)


# Arm states are (wrist target, elbow pole, hand direction, forearm roll) in world space, so they
# can be blended. In the app the sprite is mirrored to face the screen centre, which puts her
# right arm at the screen edge: that arm only ever hangs, every gesture is made with the left.
def hip_state(rig):
    """Far (left) hand resting on the hip: heel of the hand on the hip bone, fingers over the front."""
    hip = head_of(rig, "upperleg01.L")
    return hip + Vector((0.11, -0.035, 0.12)), Vector((1, 0.4, 0)), Vector((-0.4, -0.8, -0.45)), 25.0


def hang_state(rig):
    """Near (right) arm hanging with a soft elbow tucked back and the hand a little in front of the
    skirt's side, where the pleats are narrower, so it stays inside the body's silhouette.
    (Shoulder to wrist is only ~0.39 m on this rig, so targets stay within that.)"""
    shoulder = head_of(rig, "upperarm01.R")
    return shoulder + Vector((-0.02, -0.115, -0.36)), Vector((-0.2, 1, 0)), Vector((-0.05, -0.35, -1)), 0.0


def chin(rig):
    return tail_of(rig, "jaw")


def think_state(rig):
    """Left hand to the chin, knuckles under the jaw, elbow forward and down clear of the chest."""
    c = chin(rig)
    wrist = c + Vector((0.04, -0.09, -0.085))
    return wrist, Vector((0.4, -1, -0.3)), c - wrist + Vector((0, 0, 0.02)), 0.0


def hair_state(rig):
    """Fingers tucking hair behind the left ear, elbow forward and down."""
    ear = head_of(rig, "eye.L") + Vector((0.05, 0.085, 0.0))
    wrist = ear + Vector((0.08, -0.055, -0.14))
    return wrist, Vector((0.6, -0.5, -0.6)), ear + Vector((0.02, 0, 0.05)) - wrist, 0.0


def wave_state(rig, sway=0.0):
    shoulder = head_of(rig, "upperarm01.L")
    return (shoulder + Vector((0.18 - sway * 0.015, -0.05, 0.13)), Vector((0.8, 0.2, -1)),
            Vector((0.1 - sway * 0.4, -0.15, 1)), 0.0)


def offer_state(rig):
    """Talking gesture: forearm forward, palm up."""
    hip = head_of(rig, "upperleg01.L")
    return hip + Vector((0.08, -0.2, 0.13)), Vector((0.5, 0.6, -0.5)), Vector((0.15, -1, 0.15)), 0.0


def clasp_state(side):
    """Hands meeting in front of the chest, elbows kept down by the ribs."""
    sx = 1 if side == "L" else -1

    def state(rig):
        mid = (head_of(rig, "upperarm01.L") + head_of(rig, "upperarm01.R")) / 2
        return mid + Vector((sx * 0.08, -0.2, -0.17)), Vector((sx * 0.3, 0.3, -1)), Vector((-sx * 0.35, -0.3, 0.9)), 0.0
    return state


def lifted_state(rig):
    """Left hand brought up to the collarbone ("oh!"), elbow down by the ribs."""
    shoulder = head_of(rig, "upperarm01.L")
    return shoulder + Vector((-0.03, -0.17, -0.08)), Vector((0.6, 0, -1)), Vector((-0.6, 0.0, 0.8)), 0.0


def flinch_state(rig):
    """Right arm stays down, the hand just drifting forward, fingers spread."""
    target, pole, _, roll = hang_state(rig)
    return target + Vector((0, -0.02, 0)), pole, Vector((-0.1, -0.45, -1)), roll


def kick(rig, degrees):
    """Left lower leg swung back from the knee (the leg a lifted person lets dangle)."""
    rotate(rig, "lowerleg01.L", (1, 0, 0), degrees)
    rotate(rig, "foot.L", (1, 0, 0), degrees * 0.4)


def towards(goal, t, lift=(0, 0, 0), side="R"):
    """Arm state a fraction t of the way from rest to `goal`. `lift` bows the wrist's path
    (largest half-way) so the hand travels around the body instead of through it."""
    rest = hang_state if side == "R" else hip_state

    def state(rig):
        a, b = rest(rig), goal(rig)
        bow = Vector(lift) * (4 * t * (1 - t))
        return (a[0].lerp(b[0], t) + bow, a[1].lerp(b[1], t), a[2].normalized().lerp(b[2].normalized(), t),
                a[3] + (b[3] - a[3]) * t)
    return state


# ---------------------------------------------------------------- face
FACE_UNITS = ("mouth-corner-puller", "mouth-open")
LIDS = ("orbicularis03.L", "orbicularis03.R")  # upper eyelids; -26 degrees closes the eye


def face_targets(basemesh):
    units = pathlib.Path(LocationService.get_mpfb_data("targets")) / "expression" / "units" / "asian"
    for unit in FACE_UNITS:
        TargetService.load_target(basemesh, str(units / f"{unit}.target.gz"), weight=0.0, name=unit)


# ---------------------------------------------------------------- poses and shots
REST = {"yaw": -8, "pitch": 5, "roll": 3, "smile": 0.25, "open": 0.0, "lids": 3.0, "chest": 0.0,
        "L": None, "R": None, "curlL": 15, "curlR": 15, "kick": 0}


def apply_pose(rig, basemesh, spec):
    p = {**REST, **spec}
    reset_pose(rig)
    stance(rig)
    kick(rig, p["kick"])
    breathe(rig, p["chest"])
    head_turn(rig, p["yaw"], p["pitch"], p["roll"])
    for side, rest in (("L", hip_state), ("R", hang_state)):
        target, pole, hand, roll = (p[side] or rest)(rig)
        reach(rig, side, target, pole)
        twist(rig, side, roll)
        aim(rig, f"wrist.{side}", hand)
        # +X on each finger joint curls it towards the palm; 15 degrees reads as a relaxed hand.
        for finger in range(2, 6):
            for joint in range(1, 4):
                pb = rig.pose.bones[f"finger{finger}-{joint}.{side}"]
                pb.rotation_mode = "XYZ"
                pb.rotation_euler = (math.radians(p["curl" + side]), 0, 0)
    for bone in LIDS:
        pb = rig.pose.bones[bone]
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (math.radians(p["lids"]), 0, 0)
    keys = basemesh.data.shape_keys.key_blocks
    keys["mouth-corner-puller"].value = p["smile"]
    keys["mouth-open"].value = p["open"]
    update()


def ease(t):
    return t * t * (3 - 2 * t)


FRAMES: dict[str, dict] = {}
SHOTS: dict[str, list] = {}


def frame(name, **spec):
    FRAMES[name] = spec
    return name


def gesture(shot, n, step, hold, make):
    """n frames easing from rest into make(1), hold the last one, then the same frames back."""
    names = [frame(f"{shot}_{k:02d}", **make(ease(k / n))) for k in range(1, n + 1)]
    SHOTS[shot] = ([(f, step) for f in names[:-1]] + [(names[-1], hold)]
                   + [(f, step) for f in reversed(names[:-1])])


def define_shots():
    """Calm, real-time motions; durations in ms. The app returns to `rest` after each shot."""
    frame("rest")
    half, shut = frame("blink_00", lids=-13), frame("blink_01", lids=-26)
    SHOTS["blink"] = [(half, 60), (shut, 90), (half, 60)]
    gesture("breathe", 4, 330, 500, lambda t: dict(chest=t))
    gesture("look", 4, 150, 1300, lambda t: dict(yaw=-8 + 26 * t, pitch=5 - 4 * t, roll=3 - 5 * t))
    gesture("hair", 5, 160, 600, lambda t: dict(
        L=towards(hair_state, t, (0.06, -0.06, 0), side="L"), curlL=15 - 5 * t, yaw=-8 - 4 * t,
        pitch=5 - 2 * t, roll=3 - 6 * t, smile=0.25 + 0.15 * t, lids=3 - 4 * t))
    gesture("think", 5, 160, 2600, lambda t: dict(
        L=towards(think_state, t, (0.04, -0.08, 0), side="L"), curlL=15 + 30 * t,
        yaw=-8 + 4 * t, pitch=5 - 3 * t, roll=3 + 5 * t, lids=3 - 7 * t, smile=0.25 - 0.1 * t))
    talk = [frame(f"talk_{k:02d}", L=towards(offer_state, t, side="L"), curlL=8, pitch=pitch, smile=0.45, open=mouth)
            for k, (t, pitch, mouth) in enumerate(
                [(0.3, 6, 0.12), (0.6, 8, 0.28), (0.85, 6, 0.08), (1.0, 4, 0.24), (1.0, 6, 0.04)])]
    SHOTS["talk"] = [(f, 170) for f in talk] + [(f, 170) for f in reversed(talk[:3])]
    gesture("happy", 4, 140, 1200, lambda t: dict(
        L=towards(clasp_state("L"), t, side="L"), R=towards(clasp_state("R"), t, (0, -0.06, 0)),
        curlL=15 + 10 * t, curlR=15 + 10 * t, smile=0.25 + 0.75 * t, open=0.12 * t, roll=3 - 9 * t,
        pitch=5 - 6 * t, chest=0.6 * t, lids=3 - 6 * t))
    up = [frame(f"wave_up_{k}", L=towards(wave_state, ease(k / 3), (0.08, -0.06, 0), side="L"),
                curlL=15 - 11 * ease(k / 3), smile=0.25 + 0.4 * ease(k / 3), roll=3 + 3 * ease(k / 3)) for k in (1, 2, 3)]
    sway = [frame(f"wave_{k}", L=lambda rig, s=s: wave_state(rig, s), curlL=4, smile=0.65, roll=6, open=0.08)
            for k, s in enumerate((0.6, 1.2, -0.6, -1.2))]
    cycle = [up[2], sway[0], sway[1], sway[0], up[2], sway[2], sway[3], sway[2]]
    SHOTS["wave"] = ([(f, 160) for f in up[:2]] + [(f, 110) for f in cycle * 2]
                     + [(up[2], 160), (up[1], 160), (up[0], 160)])
    # Shown while she is dragged: a playful "being lifted" pose, one leg dangling back.
    SHOTS["surprise"] = [(frame("surprise", L=lifted_state, R=flinch_state, curlL=20, curlR=8, kick=50,
                                lids=7, open=0.14, smile=0.3, yaw=-14, pitch=-3, roll=8, chest=0.8), 0)]
    SHOTS["sleep"] = [(frame("sleep", lids=-26, pitch=16, roll=9, yaw=-4, smile=0.1, curlR=22), 0)]


# ---------------------------------------------------------------- checks
HAND = ("lowerarm", "wrist", "finger", "metacarpal")
ARM = ("upperarm",) + HAND
LEG = ("upperleg", "lowerleg")


def group_weight(obj, vertex, prefixes, suffix=""):
    names = obj.vertex_groups
    return sum(g.weight for g in vertex.groups
               if names[g.group].name.startswith(prefixes) and names[g.group].name.endswith(suffix))


def evaluated(obj, depsgraph):
    """World-space vertices and polygons of an object as the depsgraph evaluates it."""
    ev = obj.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    mw = obj.matrix_world
    verts = [mw @ v.co for v in mesh.vertices]
    polys = [list(p.vertices) for p in mesh.polygons]
    ev.to_mesh_clear()
    return verts, polys


class Collider:
    """Interpenetration test of the posed character. Skin: a point is inside when it lies behind
    the outward normal of the nearest skin point. Shirt and skirt are open tubes with pleats and
    folds whose nearest normal is unreliable, so for them a ray towards the front counts
    crossings instead (odd = inside)."""
    FRONT = Vector((0.013, -1, 0.007)).normalized()  # slightly off-axis so rays never run along an edge

    def __init__(self, rig, basemesh, scene):
        self.rig, self.basemesh, self.scene = rig, basemesh, scene
        self.shirt, self.skirt, self.hair = find("shirt"), find("skirt"), find("ponytail")
        verts = basemesh.data.vertices
        body = basemesh.vertex_groups["body"].index
        self.body = {v.index for v in verts if any(g.group == body for g in v.groups)}
        self.hand = {s: [i for i in self.body if group_weight(basemesh, verts[i], HAND, "." + s) > 0.5] for s in "LR"}
        self.arm = {s: {i for i in self.body if group_weight(basemesh, verts[i], ARM, "." + s) > 0.2} for s in "LR"}
        self.leg = [i for i in self.body if group_weight(basemesh, verts[i], LEG) > 0.5]

    def skin(self):
        """Skin with only the armature applied, so vertex indices still match the vertex groups."""
        states = [(m, m.show_viewport) for m in self.basemesh.modifiers]
        for m in self.basemesh.modifiers:
            m.show_viewport = m.type == "ARMATURE"
        verts, polys = evaluated(self.basemesh, bpy.context.evaluated_depsgraph_get())
        for m, s in states:
            m.show_viewport = s
        return verts, polys

    @classmethod
    def enclosed(cls, bvh, p):
        crossings, origin = 0, p
        while True:
            loc, _, _, _ = bvh.ray_cast(origin, cls.FRONT)
            if loc is None:
                return crossings % 2 == 1
            crossings += 1
            origin = loc + cls.FRONT * 1e-4

    def depth(self, label, bvh, p):
        """Signed distance into a surface (positive = inside); None when nothing is within reach."""
        loc, normal, _, dist = bvh.find_nearest(p, 0.04)
        if loc is None:
            return None
        if label == "skin":
            return (loc - p).dot(normal)
        return dist if self.enclosed(bvh, p) else -dist

    def report(self, name):
        skin_v, skin_p = self.skin()
        dg = bpy.context.evaluated_depsgraph_get()
        shirt, skirt = (BVHTree.FromPolygons(*evaluated(o, dg)) for o in (self.shirt, self.skirt))
        parts, worst = [], 0.0
        for side in "LR":
            skin = BVHTree.FromPolygons(skin_v, [p for p in skin_p if all(i in self.body and i not in self.arm[side] for i in p)])
            hits, gap = {}, 0.04
            for i in self.hand[side]:
                for label, bvh in (("skin", skin), ("shirt", shirt), ("skirt", skirt)):
                    d = self.depth(label, bvh, skin_v[i])
                    if d is None:
                        continue
                    if d > 0.003:
                        n, worst_here = hits.get(label, (0, 0.0))
                        hits[label] = (n + 1, max(worst_here, d))
                    else:
                        gap = min(gap, -d)
            worst = max([worst] + [d for _, d in hits.values()])
            parts.append(f"{side}: " + (", ".join(f"{n} in {k} ({d * 1000:.0f} mm)" for k, (n, d) in hits.items())
                                        or f"clear, gap {gap * 1000:.0f} mm"))
        skirt_v = [self.skirt.matrix_world @ v.co for v in self.skirt.evaluated_get(dg).data.vertices]
        zlo, zhi = min(v.z for v in skirt_v) + 0.01, max(v.z for v in skirt_v) - 0.01
        poke = sum(1 for i in self.leg if zlo < skin_v[i].z < zhi and not self.enclosed(skirt, skin_v[i]))
        hair, _ = evaluated(self.hair, dg)
        collar = sum(1 for p in hair if self.enclosed(shirt, p))
        log(f"{name:11s} {parts[0]:36s} {parts[1]:36s} legs-out-of-skirt {poke:3d}  hair-in-shirt {collar:3d}")
        return worst

    def left_edge(self):
        """Leftmost rendered pixel column of the current pose (screen-edge side in the app)."""
        dg = bpy.context.evaluated_depsgraph_get()
        cam = self.scene.camera
        xmin = 1.0
        for o in bpy.data.objects:
            if o.type == "MESH" and not o.hide_render:
                verts, _ = evaluated(o, dg)
                xmin = min([xmin] + [world_to_camera_view(self.scene, cam, v).x for v in verts])
        return xmin * W


# ---------------------------------------------------------------- scene
def setup_scene(samples=40):
    scene = bpy.context.scene
    # Cycles on the CPU: Eevee crashes inside older Intel OpenGL drivers (ig75icd64.dll, HD 4600).
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 6
    scene.render.threads_mode = "AUTO"
    scene.render.resolution_x, scene.render.resolution_y = W, H
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("world") if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.84, 0.9, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6

    def light(name, kind, energy, loc, rot, size=2.0, color=(1, 1, 1)):
        data = bpy.data.lights.new(name, kind)
        data.energy = energy
        data.color = color
        if kind == "AREA":
            data.size = size
        obj = bpy.data.objects.new(name, data)
        obj.location = loc
        obj.rotation_euler = [math.radians(a) for a in rot]
        scene.collection.objects.link(obj)

    light("key", "AREA", 260, (1.6, -2.2, 2.4), (55, 0, 35), 2.5, (1.0, 0.97, 0.94))
    light("fill", "AREA", 110, (-2.2, -1.6, 1.6), (65, 0, -50), 3.0, (1.0, 0.95, 0.97))
    light("rim", "AREA", 220, (-0.6, 2.4, 2.4), (-60, 0, 180), 1.5, (0.88, 0.93, 1.0))
    return scene


def setup_camera(scene, target_obj):
    bbox = [target_obj.matrix_world @ Vector(c) for c in target_obj.bound_box]
    zmin = min(v.z for v in bbox); zmax = max(v.z for v in bbox)
    height = zmax - zmin
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 85
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    # Three-quarter view from slightly left, at chest height, framing the whole body.
    sensor_h = cam_data.sensor_width * H / W
    dist = (height * 1.2) * cam_data.lens / sensor_h
    angle = math.radians(-20)
    centre = Vector((0, 0, zmin + height * 0.5))
    cam.location = centre + Vector((math.sin(angle) * dist, -math.cos(angle) * dist, height * 0.06))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_data.sensor_fit = "HORIZONTAL"
    return cam


def face_camera(scene, cam, rig):
    """Re-aim the camera for a 360x360 face close-up (used by the `face` mode)."""
    head = head_of(rig, "head") + Vector((0, 0, 0.09))
    cam.location = head + Vector((-0.2, -0.78, 0.0))
    cam.rotation_euler = (head - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = scene.render.resolution_y = 360


def render(scene, name):
    scene.render.filepath = str(OUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)


def check(rig, basemesh, scene):
    """Per frame: wrists that miss their IK target, hand/forearm points inside the body, clothes
    or hair, legs through the skirt, hair through the collar, and how far the pose reaches past
    the rest pose on the screen-edge side."""
    collider = Collider(rig, basemesh, scene)
    worst, edge, rest_edge = 0.0, {}, None
    for name, spec in FRAMES.items():
        apply_pose(rig, basemesh, spec)
        p = {**REST, **spec}
        for side, rest in (("L", hip_state), ("R", hang_state)):
            target = (p[side] or rest)(rig)[0]
            miss = (tail_of(rig, f"lowerarm02.{side}") - target).length
            if miss > 0.005:
                log(f"{name}.{side}: wrist misses target by {miss:.3f} m")
        worst = max(worst, collider.report(name))
        edge[name] = collider.left_edge()
        rest_edge = rest_edge if rest_edge is not None else edge[name]
    wide = {n: round(rest_edge - x) for n, x in edge.items() if x < rest_edge - 2}
    log(f"rest left edge {rest_edge:.0f} px; frames reaching further left (px): {wide or 'none'}")
    log(f"worst penetration {worst * 1000:.1f} mm")


def main():
    """Modes: `probe` renders the rest pose, `frames a b ...` only the named frames, `face` two
    close-ups, `check` the pose report, `full` every frame plus meta.json for the packer."""
    OUT.mkdir(parents=True, exist_ok=True)
    basemesh, rig = build_human()
    restyle(basemesh)
    face_targets(basemesh)
    scene = setup_scene()
    cam = setup_camera(scene, basemesh)
    define_shots()
    log("frames", len(FRAMES))
    if MODE == "check":
        check(rig, basemesh, scene)
        return
    if MODE == "face":
        face_camera(scene, cam, rig)
        for name, spec in (("face_neutral", {}), ("face_smile", dict(smile=0.85, open=0.1, lids=-2))):
            apply_pose(rig, basemesh, spec)
            render(scene, name)
        return
    if MODE == "probe":
        names = ["rest"]
    elif MODE == "frames":
        names = sys.argv[sys.argv.index("--") + 2:]
    else:
        names = list(FRAMES)
    for i, name in enumerate(names, 1):
        apply_pose(rig, basemesh, FRAMES[name])
        render(scene, "probe" if MODE == "probe" else name)
        log(f"rendered {name} ({i}/{len(names)})")
    if MODE == "full":
        meta = {"frames": names, "shots": SHOTS, "facing": "right"}
        (OUT / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    log("done")


if __name__ == "__main__":
    main()
