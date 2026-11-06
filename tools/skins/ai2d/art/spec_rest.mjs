// Rest-pose joint sites of the motion spec in the 139x340 app frame at 1x (spec's own FK and projection).
import fs from 'node:fs';
import { composite } from '../motion-v1/lib/compose.mjs';
import { fk, project } from '../motion-v1/lib/fk.mjs';
const spec = JSON.parse(fs.readFileSync(new URL('../motion-v1/motion-spec.json', import.meta.url)));
const P = composite(spec, { name: 'rest', part: 'loop', clip: {}, parent: {} }, 0, 0, false);
const W = fk(P.pose, P.hipsOffset), F = spec.frame, out = {};
for (const [k, j] of Object.entries(W)) { const p = project(j.p, spec.camera.yawDeg); out[k] = [+(F.originXPx + p[0] * F.pxPerM).toFixed(2), +(F.originYPx - p[1] * F.pxPerM).toFixed(2)]; }
fs.writeFileSync(new URL('./work/spec_rest.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(Object.keys(out).join(' ')); console.log('headTop', out.headTop, 'toes', out.leftToes, out.rightToes, 'neck', out.neck, 'hips', out.hips);
