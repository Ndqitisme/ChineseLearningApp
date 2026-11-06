// Reference behaviour scheduler: the semantics of spec.stateMachine, run on a list of timed app
// events. src/ ports this logic; the checker runs it on the scenarios in lib/limits.mjs, which
// reproduce Pet.svelte's real call order (same-tick events are synchronous calls).
//
// Rules (from spec.stateMachine.interrupt):
//  - One body clip at a time. A request preempts the playing clip only if its priority is higher
//    and the playing clip is not locked (a lock yields only to priority >= lock.breakPriority).
//  - A request that cannot play queues (one slot, newest wins, expires after queue.expiryMs) if its
//    priority >= queue.minPriority; lower ones are dropped.
//  - A locking event's clip and its `then` chain hold the lock until the chain ends.
//  - Stateful clips: enter -> loop (repeats) -> exit. The hold rule releases the loop; the exit
//    starts at the next loop boundary if that is within exit.boundaryWaitMs, else at once (blend).
//  - maxMs forces the exit. minMs keeps a whileSpeaking hold alive after speech ends.
import { clipDuration } from './fk.mjs';

export function simulate(spec, events, { untilMs } = {}) {
  const sm = spec.stateMachine, ev = sm.events, I = sm.interrupt;
  const clips = spec.clips;
  const dur = (name, part) => clipDuration(part ? clips[name][part] : clips[name]);
  const segs = [];
  let cur = null;          // { clip, part, start, end, req, released, holdStart }
  let queue = null;        // { req, expiresAt }
  let lockChain = false;
  let hidden = false, hiddenAt = 0, speaking = false;
  const cooldown = {};
  const log = (m) => segs.push(m);

  const endSeg = (t, how) => { if (cur) log({ clip: cur.clip, part: cur.part, start: cur.start, end: t, how }); };
  function startSection(req, part, t) {
    const c = clips[req.clip];
    const d = c.kind === 'stateful' ? dur(req.clip, part) : dur(req.clip);
    cur = { clip: req.clip, part, start: t, end: t + d, req, released: cur?.req === req ? cur.released : false, holdStart: cur?.req === req ? cur.holdStart : t };
  }
  function start(req, t) {
    lockChain = !!req.locks || (lockChain && req.chained);
    const c = clips[req.clip];
    cur = null;
    startSection(req, c.kind === 'stateful' ? (req.skipEnter ? 'exit' : 'enter') : 'oneShot', t);
  }
  function nextFromQueue(t) {
    if (queue && queue.expiresAt >= t) { const q = queue.req; queue = null; start(q, t); return; }
    queue = null; cur = null; lockChain = false;
  }
  function afterChain(req, t) {
    if (req.then) { start({ clip: req.then, priority: req.priority, locks: req.locks, chained: true, event: req.event }, t); return; }
    lockChain = false;
    nextFromQueue(t);
  }
  function holdReleased(t) {
    const r = cur.req;
    if (cur.released) return true;
    if (r.hold === 'whileSpeaking') return !speaking && t - cur.holdStart >= (r.minMs ?? 0);
    return false;
  }
  function advance(t) {
    // Process section ends up to time t.
    for (let guard = 0; cur && cur.end <= t && guard < 1000; guard++) {
      const te = cur.end, c = clips[cur.clip], r = cur.req;
      if (cur.part === 'oneShot' || cur.part === 'exit') { endSeg(te, 'complete'); const rq = r; cur = null; afterChain(rq, te); continue; }
      if (cur.part === 'enter') { endSeg(te, 'complete'); startSection(r, 'loop', te); continue; }
      // loop boundary
      const forced = r.maxMs && te - cur.holdStart >= r.maxMs;
      if (holdReleased(te) || forced) { endSeg(te, forced ? 'maxMs' : 'released'); startSection(r, 'exit', te); }
      else { endSeg(te, 'cycle'); startSection(r, 'loop', te); }
      void c;
    }
  }
  function release(clipName, t) {
    if (!cur || cur.clip !== clipName) return false;
    // A whileSpeaking hold ends through the speaking flag so minMs still applies.
    if (cur.req.hold !== 'whileSpeaking') cur.released = true;
    if (cur.part === 'loop') {
      const wait = cur.end - t;
      if (wait > (I.exit?.boundaryWaitMs ?? 400) && holdReleased(t)) { endSeg(t, 'released'); startSection(cur.req, 'exit', t); }
    }
    return true;
  }
  function request(req, t) {
    if (hidden) return;
    if (cur && cur.clip === req.clip && clips[req.clip].kind === 'stateful' && cur.part !== 'exit') { if (req.hold === 'whileSpeaking') cur.released = false; return; }
    if (!cur) { start(req, t); return; }
    const p = cur.req.priority ?? 0;
    const lockHolds = lockChain && req.priority < (I.lock?.breakPriority ?? Infinity);
    if (req.priority > p && !lockHolds) { endSeg(t, 'preempted'); start(req, t); return; }
    if (req.priority >= (I.queue?.minPriority ?? 0)) queue = { req, expiresAt: t + (I.queue?.expiryMs ?? 0) };
  }

  const sorted = events.map((e, i) => [...e, i]).sort((a, b) => a[0] - b[0] || a[3] - b[3]);
  for (const [t, name] of sorted) {
    advance(t);
    const e = ev[name];
    if (name === 'fullscreenHide') { if (cur) endSeg(t, 'stopped'); cur = null; queue = null; lockChain = false; hidden = true; hiddenAt = t; continue; }
    if (name === 'fullscreenShow') { const was = hiddenAt; hidden = false; if (e?.clip && (!e.ifHiddenForMs || t - was >= e.ifHiddenForMs)) request(mk(name, e), t); continue; }
    if (!e) continue;
    if (e.cooldownMs !== undefined && typeof e.cooldownMs === 'number') { if (cooldown[name] !== undefined && t - cooldown[name] < e.cooldownMs) continue; cooldown[name] = t; }
    if (name === 'speakStart') speaking = true;
    if (name === 'speakEnd') speaking = false;
    if (name === 'idleTick') {
      if (cur || hidden) continue;
      const pick = (e.pick ?? []).map(([c]) => c).find((c) => !(cooldown[`clip:${c}`] !== undefined && t - cooldown[`clip:${c}`] < (e.cooldownMs?.[c] ?? 0)));
      if (pick) { cooldown[`clip:${pick}`] = t; request({ clip: pick, priority: e.priority, event: name }, t); }
      continue;
    }
    let handled = false;
    if (e.exits) {
      handled = release(e.exits, t);
      if (handled && e.then && cur) cur.req = { ...cur.req, then: e.then, locks: e.locks || cur.req.locks };
      if (handled && e.locks) lockChain = true;
      if (!handled && e.then && e.thenIfNotPlaying !== false) request({ clip: e.then, priority: e.priority ?? 0, locks: e.locks, event: name }, t);
    }
    if (e.clip) request(mk(name, e), t);
  }
  advance(untilMs ?? (sorted.length ? sorted[sorted.length - 1][0] + 60000 : 60000));
  if (cur) endSeg(untilMs ?? cur.end, 'open');
  return segs;

  function mk(name, e) { return { clip: e.clip, priority: e.priority ?? 0, hold: e.hold, minMs: e.minMs, maxMs: e.maxMs, locks: e.locks, then: e.then, event: name }; }
}

/** Checks one scenario's expectations against a simulated timeline. Returns failure messages. */
export function expectations(segs, expect) {
  const fails = [];
  const match = (s, id) => (id.includes('.') ? `${s.clip}.${s.part}` === id : s.clip === id);
  const ofClip = (id) => segs.filter((s) => match(s, id));
  for (const [kind, a, b] of expect) {
    if (kind === 'completes') {
      const done = ofClip(a).filter((s) => (b === undefined || s.start >= b) && ((s.part === 'oneShot' || s.part === 'exit') && s.how === 'complete'));
      if (!done.length) fails.push(`${a} never plays to its end (${ofClip(a).map((s) => `${s.part} ${s.start}-${s.end} ${s.how}`).join('; ') || 'never starts'})`);
    } else if (kind === 'startsAfter') {
      // The first A that starts once B has started must wait for B's end.
      const B = ofClip(b), b0 = B.length ? B[0].start : Infinity;
      const A = ofClip(a).filter((s) => s.start >= b0);
      const bEnd = Math.max(...B.filter((s) => s.how === 'complete').map((s) => s.end), -Infinity);
      if (!B.length) fails.push(`${b} never plays`);
      else if (!A.length) fails.push(`${a} never starts after ${b} starts`);
      else if (A[0].start < bEnd - 1) fails.push(`${a} starts at ${A[0].start} ms, before ${b} ends at ${bEnd} ms`);
    } else if (kind === 'preempts') {
      const B = ofClip(b), A = ofClip(a);
      if (!A.length || !B.some((s) => s.how === 'preempted' && Math.abs(s.end - A[0].start) < 1)) fails.push(`${a} does not preempt ${b}`);
    } else if (kind === 'never') {
      if (ofClip(a).length) fails.push(`${a} plays but must not`);
    } else if (kind === 'plays') {
      if (!ofClip(a).length) fails.push(`${a} never plays`);
    } else if (kind === 'stopsAt') {
      const after = segs.filter((s) => s.start < a && s.end > a + 1);
      if (after.length) fails.push(`still playing past ${a} ms: ${after.map((s) => s.clip).join(', ')}`);
    }
  }
  return fails;
}
