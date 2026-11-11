"""Flower border for the "Viền cỏ lá" skin: flowers and leafy plants rendered in Blender into sprite atlases.

    python tools/skins/meadow/fetch.py                                   # once: the pinned Poly Haven models (CC0)
    blender -b --factory-startup --python tools/skins/meadow/build.py    # src/pet/frames/meadow.json, meadow@{1,2,3}x.png

A low bed of flowers and leaves runs along the bottom of the window, behind the bubble's lower edge, and taller
leafy stems climb the two lower corners. Each sprite is one plant (low front plants go three to a sprite) with its
base as the pivot, so the app can bend it in the wind. A sprite is rendered alone, but the other plants stay in the
scene as shadow casters, so it keeps the shade its neighbours give it. Sprites are listed back to front; the app
draws them in that order. Colours are the plants' own, not tinted per theme.
Rendered at RENDER_SCALE x the CSS size and box-filtered down (premultiplied, linear light) to each atlas scale.
"""

import json
import math
import os
import random
import sys

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
CACHE = os.path.join(ROOT, '.cache', 'polyhaven')
TMP = os.path.join(ROOT, '.cache', 'meadow')
OUT = os.path.join(ROOT, 'src', 'pet', 'frames')

PAD = {'top': 16, 'side': 32, 'bottom': 48}   # window margin around the 264px bubble, CSS px
WIN_W = 264 + 2 * PAD['side']
FRAME_H = 130                                # rendered band above the window's bottom edge, CSS px
PX_PER_M = 230                               # CSS px per metre of plant
TILT = math.radians(10)                      # camera looks slightly down, so rows behind sit a little higher
RENDER_SCALE = 6
SCALES = [1, 2, 3]
SAMPLES = 128
SEED = 23
ATLAS_W = 512                                # @1x
SPRITE_PAD = 2                               # CSS px of clear border around each sprite
SWAY_MAX = 25                                # src/pet/frames/leaves.ts: the app's largest lean, deg
EDGE = 1                                     # CSS px kept clear between a plant and the window's side
SATURATION = 1.22                            # photo-scanned plants read a little grey at this size
EXPOSURE = 1.14

CELANDINE = [f'celandine_01_{s}_LOD0' for s in 'abcde']
EMPODIUM = [f'flower_empodium_{s}_LOD0' for s in 'abcde']
DANDELION = [f'dandelion_01_{s}_LOD0' for s in 'abcde']
SORREL = [f'shrub_sorrel_01_{s}' for s in 'abde']
PERIWINKLE_LOW = [f'periwinkle_plant_0{n}_LOD0' for n in (3, 4, 5, 6)]
PERIWINKLE_TALL = ['periwinkle_plant_01_LOD0', 'periwinkle_plant_02_LOD0']
SHRUB_MID = [f'shrub_01_{s}_LOD0' for s in 'cde']
SHRUB_TALL = [f'shrub_01_{s}_LOD0' for s in 'abh']
ASSETS = [('celandine_01', CELANDINE), ('flower_empodium', EMPODIUM), ('dandelion_01', DANDELION),
          ('shrub_sorrel_01', SORREL), ('periwinkle_plant', PERIWINKLE_LOW + PERIWINKLE_TALL),
          ('shrub_01', SHRUB_MID + SHRUB_TALL)]


# ------------------------------------------------------------------ scene

def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    for kind in ('OPTIX', 'CUDA', 'NONE'):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if kind == 'NONE' or any(d.type == kind for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == kind
                break
        except TypeError:
            continue
    sc.cycles.device = 'GPU' if prefs.compute_device_type != 'NONE' else 'CPU'
    print('cycles device:', prefs.compute_device_type, file=sys.stderr)
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 6
    sc.cycles.transparent_max_bounces = 16
    sc.render.film_transparent = True
    sc.render.filter_size = 1.2
    sc.render.resolution_x = WIN_W * RENDER_SCALE
    sc.render.resolution_y = FRAME_H * RENDER_SCALE
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.render.image_settings.color_depth = '32'
    sc.view_settings.view_transform = 'Standard'

    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.62, 0.74, 0.95, 1)
    bg.inputs['Strength'].default_value = 1.0
    sc.world = world

    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.5
    sun.data.angle = math.radians(4)
    sun.data.color = (1.0, 0.96, 0.88)
    # Light travels right, away from the camera and down: it comes from the top left of the screen.
    sun.rotation_euler = Vector((1.0, 0.7, -1.3)).normalized().to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(sun)

    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = WIN_W / PX_PER_M
    cam.rotation_euler = (math.pi / 2 - TILT, 0, 0)
    cam.location = (WIN_W / PX_PER_M / 2, -6, 0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    bpy.context.view_layer.update()
    # Move the camera along its own up axis so the ground at the front row meets the frame's bottom edge 3px up.
    up = cam.matrix_world.to_quaternion() @ Vector((0, 1, 0))
    v = world_to_camera_view(sc, cam, Vector((0, 0, 0))).y
    cam.location -= up * ((3 / FRAME_H - v) * (FRAME_H / PX_PER_M))
    bpy.context.view_layer.update()
    return sc, cam


def append(asset, names):
    path = os.path.join(CACHE, asset, f'{asset}.blend')
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        missing = [n for n in names if n not in src.objects]
        if missing:
            raise SystemExit(f'{asset}: no object {missing}')
        dst.objects = list(dict.fromkeys(names))
    # Textures are referenced relative to the source .blend; point them at the cached copies.
    for img in bpy.data.images:
        if img.filepath.startswith('//textures/'):
            img.filepath = os.path.join(CACHE, asset, 'textures', os.path.basename(img.filepath))
    return {o.name: o for o in dst.objects}


# ------------------------------------------------------------------ layout

def css(sc, cam, p):
    v = world_to_camera_view(sc, cam, p)
    return v.x * WIN_W, v.y * FRAME_H   # x from the left, y up from the window's bottom edge


def place(sc, protos, rnd):
    """Sprites as groups of plant instances: {objs, kind, bend, depth}, sorted back to front."""
    groups = []

    def plant(name, x, depth, scale=1.0, lean=0.0):
        o = protos[name].copy()
        o.location = (x / PX_PER_M, depth, 0)
        o.rotation_euler = (0, lean, rnd.uniform(0, 2 * math.pi))
        s = scale * rnd.uniform(0.9, 1.1)
        o.scale = (s, s, s)
        sc.collection.objects.link(o)
        return o

    def add(objs, kind, bend, depth):
        groups.append({'objs': objs, 'kind': kind, 'bend': bend, 'depth': depth})

    # Back row: leafy periwinkle and shrub stems whose tops go behind the bubble's lower edge.
    x = 30
    while x < WIN_W - 30:
        d = rnd.uniform(0.18, 0.24)
        if rnd.random() < 0.55:
            add([plant(rnd.choice(PERIWINKLE_LOW), x, d, 1.0)], 'flower', 0.9, d)
        else:
            add([plant(rnd.choice(SHRUB_MID), x, d, 1.0)], 'bush', 0.75, d)
        x += rnd.uniform(20, 28)
    # Middle row: celandine (heart-shaped leaves, yellow flowers) with empodium among it.
    x = 22
    while x < WIN_W - 22:
        d = rnd.uniform(0.09, 0.13)
        name = rnd.choice(EMPODIUM) if rnd.random() < 0.3 else rnd.choice(CELANDINE)
        add([plant(name, x, d, 1.25)], 'flower', 1.0, d)
        x += rnd.uniform(16, 22)
    # Front row: low leaves where the stems meet the window's edge, three plants to a sprite.
    x = 8
    while x < WIN_W - 8:
        d = rnd.uniform(0.0, 0.04)
        objs = []
        for k in range(3):
            r = rnd.random()
            px = x + k * rnd.uniform(9, 13)
            if px > WIN_W - 6:
                break
            if r < 0.35:
                objs.append(plant(rnd.choice(SORREL), px, d + rnd.uniform(0, 0.02), 3.2))
            elif r < 0.65:
                objs.append(plant(rnd.choice(DANDELION), px, d + rnd.uniform(0, 0.02), 1.0))
            else:
                objs.append(plant(rnd.choice(CELANDINE), px, d + rnd.uniform(0, 0.02), 0.9))
        if objs:
            add(objs, 'bush', 0.55, d)
        x += 34
    # Corners: taller leafy stems climbing beside the bubble, leaning a little outward.
    for side in (0, 1):
        sgn = -1 if side == 0 else 1
        for k, (name, dx, d, scale) in enumerate([(PERIWINKLE_TALL[side], 12, 0.09, 1.0),
                                                    (PERIWINKLE_TALL[1 - side], 22, 0.05, 0.9),
                                                    (rnd.choice(SHRUB_MID), 6, 0.02, 1.1)]):
            x = dx if side == 0 else WIN_W - dx
            add([plant(name, x, d, scale, sgn * math.radians(5 + 3 * k))], 'bush', 0.7, d)
    groups.sort(key=lambda g: -g['depth'])
    return groups


def bounds(sc, cam, objs):
    """CSS bbox (x0, y0, x1, y1; y up) of a group of objects and its base point."""
    deps = bpy.context.evaluated_depsgraph_get()
    pts, bases = [], []
    for o in objs:
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        pts += [css(sc, cam, o.matrix_world @ v.co) for v in me.vertices]
        lowest = min((o.matrix_world @ v.co).z for v in me.vertices)
        ev.to_mesh_clear()
        bases.append(css(sc, cam, Vector((o.location.x, o.location.y, max(lowest, 0.0)))))
    pts = np.array(pts)
    x0, y0 = pts.min(axis=0)
    x1, y1 = pts.max(axis=0)
    base = (sum(b[0] for b in bases) / len(bases), min(b[1] for b in bases))
    return (math.floor(x0) - SPRITE_PAD, math.floor(y0) - SPRITE_PAD, math.ceil(x1) + SPRITE_PAD, math.ceil(y1) + SPRITE_PAD), base


# ------------------------------------------------------------------ render

def render_sprite(sc, groups, idx, box):
    x0, y0, x1, y1 = box
    for j, g in enumerate(groups):
        for o in g['objs']:
            o.visible_camera = j == idx
    r = sc.render
    r.use_border = True
    r.use_crop_to_border = True
    r.border_min_x, r.border_max_x = x0 / WIN_W, x1 / WIN_W
    r.border_min_y, r.border_max_y = y0 / FRAME_H, y1 / FRAME_H
    path = os.path.join(TMP, f'sprite_{idx:03d}.exr')
    r.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    os.remove(path)
    px = px.reshape(h, w, 4)[::-1]          # top row first
    want = ((x1 - x0) * RENDER_SCALE, (y1 - y0) * RENDER_SCALE)
    out = np.zeros((want[1], want[0], 4), dtype=np.float32)   # Blender may round the border by a pixel
    out[:min(h, want[1]), :min(w, want[0])] = px[:want[1], :want[0]]
    return out


def to_scale(px, s):
    """Box filter a premultiplied linear RGBA render down to scale s, grade it, return straight-alpha sRGB 0..1."""
    f = RENDER_SCALE // s
    h, w = px.shape[0] // f, px.shape[1] // f
    a = px[:h * f, :w * f].reshape(h, f, w, f, 4).mean(axis=(1, 3))
    alpha = a[..., 3:4]
    rgb = np.where(alpha > 1e-5, a[..., :3] / np.maximum(alpha, 1e-5), 0) * EXPOSURE
    luma = (rgb * np.array([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
    rgb = np.clip(luma + (rgb - luma) * SATURATION, 0, 1)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    return np.concatenate([srgb, np.clip(alpha, 0, 1)], -1)


def hull(rgba, s):
    """Convex hull of the visible pixels of a sprite at scale s, in sprite CSS px, grown by half a pixel."""
    ys, xs = np.nonzero(rgba[..., 3] > 0.04)
    if not len(xs):
        return []
    pts = sorted(set(zip(((xs + 0.5) / s).tolist(), ((ys + 0.5) / s).tolist())))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    h = lower[:-1] + upper[:-1]
    cx, cy = sum(p[0] for p in h) / len(h), sum(p[1] for p in h) / len(h)
    out = []
    for x, y in h:
        d = math.hypot(x - cx, y - cy) or 1
        out.append([round(x + (x - cx) / d * 0.5 / s * 2, 1), round(y + (y - cy) / d * 0.5 / s * 2, 1)])
    w, h = rgba.shape[1] / s, rgba.shape[0] / s
    return [[min(max(x, 0), w), min(max(y, 0), h)] for x, y in out]


def bend_limit(sprite, pts, want):
    """Largest bend <= want at which every hull point, leaning SWAY_MAX * bend about the pivot, stays in the window."""
    k = math.inf
    for hx, hy in pts:
        dy = abs(hy - sprite['py'])
        if dy < 1e-6:
            continue
        wx = sprite['x'] + hx
        k = min(k, max(min(wx, WIN_W - wx), 0) / dy)
    if k == math.inf:
        return want
    return min(want, math.floor(math.degrees(math.atan(k)) / SWAY_MAX * 100) / 100)


def pack(sizes):
    """Shelf packing at 1x; returns (positions, atlas height)."""
    order = sorted(range(len(sizes)), key=lambda i: -sizes[i][1])
    pos = [None] * len(sizes)
    x = y = shelf = 0
    for i in order:
        w, h = sizes[i]
        if x + w > ATLAS_W:
            x, y, shelf = 0, y + shelf, 0
        pos[i] = (x, y)
        x += w
        shelf = max(shelf, h)
    return pos, y + shelf


def save_png(rgba, path):
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


def main():
    os.makedirs(TMP, exist_ok=True)
    rnd = random.Random(SEED)
    sc, cam = setup()
    protos = {}
    for asset, names in ASSETS:
        protos.update(append(asset, names))
    groups = place(sc, protos, rnd)
    bpy.context.view_layer.update()

    sprites, renders = [], []
    for idx, g in enumerate(groups):
        box, base = bounds(sc, cam, g['objs'])
        # A plant past the window's side would be cut off: move it in.
        shift = max(EDGE + SPRITE_PAD - box[0], 0) - max(box[2] - SPRITE_PAD - (WIN_W - EDGE), 0)
        if shift:
            for o in g['objs']:
                o.location.x += shift / PX_PER_M
            bpy.context.view_layer.update()
            box, base = bounds(sc, cam, g['objs'])
        # The window clips anything past its edges, so the render does too.
        x0, y0, x1, y1 = max(box[0], 0), max(box[1], 0), min(box[2], WIN_W), min(box[3], FRAME_H)
        print(f'sprite {idx + 1}/{len(groups)} {g["objs"][0].name} x{len(g["objs"])} box={(x0, y0, x1, y1)}', file=sys.stderr)
        renders.append(render_sprite(sc, groups, idx, (x0, y0, x1, y1)))
        sprites.append({
            'id': f'{g["kind"]}-{idx:02d}', 'kind': g['kind'], 'ax': 0, 'ay': 1,
            'x': x0, 'y': -y1, 'w': x1 - x0, 'h': y1 - y0,
            'px': round(base[0] - x0, 2), 'py': round(y1 - base[1], 2),
            'mirror': False, 'bend': g['bend'],
        })
        sprites[-1]['hull'] = hull(to_scale(renders[-1], 3), 3)
        sprites[-1]['bend'] = bend_limit(sprites[-1], sprites[-1]['hull'], g['bend'])

    pos, atlas_h = pack([(s['w'], s['h']) for s in sprites])
    for s, (ax, ay) in zip(sprites, pos):
        s['src'] = {'x': ax, 'y': ay, 'w': s['w'], 'h': s['h']}
    for k in SCALES:
        atlas = np.zeros((atlas_h * k, ATLAS_W * k, 4), dtype=np.float32)
        for s, px in zip(sprites, renders):
            img = to_scale(px, k)
            x, y = s['src']['x'] * k, s['src']['y'] * k
            atlas[y:y + img.shape[0], x:x + img.shape[1]] = img
        save_png(atlas, os.path.join(OUT, f'meadow@{k}x.png'))
    meta = {'pad': PAD, 'scales': SCALES, 'atlas': {'w': ATLAS_W, 'h': atlas_h}, 'sprites': sprites}
    with open(os.path.join(OUT, 'meadow.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(meta, f, indent=1)
        f.write('\n')
    print(f'wrote {len(sprites)} sprites, atlas {ATLAS_W}x{atlas_h} @1x, scales {SCALES}', file=sys.stderr)


main()
