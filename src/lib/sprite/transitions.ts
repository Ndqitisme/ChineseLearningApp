import type { FrameStep, Skin } from './skins.ts';

/** Reuse rendered neighbouring poses to return to rest when an action is interrupted.
 * Edges are reversible: waking up and putting a lifted foot down follow their entry
 * poses backwards, instead of snapping directly to the idle image. Each step takes 120–220 ms,
 * close to the action's own pace: faster reads as the arm being yanked back.
 */
export function restTransitions(skin: Pick<Skin, 'animations'>): Map<number, FrameStep[]> {
  const idle = skin.animations.idle?.[0]?.[0] ?? 0;
  const graph = new Map<number, Map<number, number>>();
  const connect = (a: number, b: number, ms: number) => {
    if (a === b) return;
    const edges = graph.get(a) ?? new Map<number, number>();
    edges.set(b, Math.min(edges.get(b) ?? Infinity, ms));
    graph.set(a, edges);
  };
  for (const steps of Object.values(skin.animations)) {
    if (!steps) continue;
    let previous = idle, duration = 80;
    for (const [frame, ms] of steps) {
      const travel = Math.max(120, Math.min(220, ms || duration));
      connect(previous, frame, travel);
      connect(frame, previous, travel);
      previous = frame;
      if (ms > 0) duration = ms;
    }
  }
  const distances = new Map([[idle, 0]]);
  const next = new Map<number, [number, number]>();
  const pending = new Set([idle]);
  while (pending.size) {
    const node = [...pending].reduce((a, b) => distances.get(a)! < distances.get(b)! ? a : b);
    pending.delete(node);
    for (const [neighbor, ms] of graph.get(node) ?? []) {
      const cost = distances.get(node)! + ms;
      if (cost < (distances.get(neighbor) ?? Infinity)) {
        distances.set(neighbor, cost);
        next.set(neighbor, [node, ms]);
        pending.add(neighbor);
      }
    }
  }
  const result = new Map<number, FrameStep[]>([[idle, []]]);
  for (const start of next.keys()) {
    const route: FrameStep[] = [];
    let frame = start;
    while (frame !== idle) {
      const [destination, ms] = next.get(frame)!;
      route.push([destination, ms]);
      frame = destination;
    }
    result.set(start, route);
  }
  return result;
}
