// Reference behaviour scheduler: the semantics of spec.stateMachine, run on a list of timed app
// events. The live pet re-runs it on its event log (Timeline in rig-player.js); same-tick events are
// synchronous calls in Pet.svelte.
//
// Rules (from spec.stateMachine.interrupt):
//  - One body clip at a time. A request preempts the playing clip only if its priority is higher
//    and the playing clip is not locked (a lock yields only to priority >= lock.breakPriority).
//  - A request that cannot play queues (one slot, newest wins, expires after queue.expiryMs) if its
//    priority >= queue.minPriority; lower ones are dropped.
//  - A locking event's clip and its `then` chain hold the lock until the chain ends.
//  - Stateful clips: enter -> loop (repeats) -> exit. A release during the enter goes to the exit at
//    the enter's end. A release in the loop waits for the boundary if it is within
//    exit.boundaryWaitMs, else the exit starts at once (blend). maxMs forces the exit.
//  - Sleep is a state, not an edge: while `sleeping` is set, whenever nothing plays (a drag ended,
//    the window was shown again) sleep is requested again. sleeping clears on userBack, and on any
//    event marked clearsSleep (nextNow sets sleeping = false without wake()): the rig emits userBack
//    for every true -> false change.
//  - Overlays (click nod) are additive layers that start at once over whatever body clip plays.
//  - Speech carries a token: speakEnd ends talk only for the utterance that is current.
//  - Mouth visemes are their own layer, gated by `speaking` (mouthAt); the talk body clip carries none.
//  - idleTick picks by weight with a seeded RNG, never repeats the last pick, skips clips on
//    cooldown, and does nothing while the menu is open, while she sleeps, or while a clip plays.
import { clipDuration, sampleTrack } from './fk.js';

/** Small seeded PRNG (mulberry32): the reference is deterministic; the app may seed it from the clock. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Event keys the scheduler implements. A spec field outside this set is documentation the runtime would ignore. */
export const IMPLEMENTED_KEYS = new Set(['source', 'at', 'note', 'clip', 'priority', 'hold', 'minMs', 'maxMs', 'locks', 'then', 'exits',
  'cooldownMs', 'pick', 'noRepeat', 'seed', 'ifHiddenForMs', 'resumeIfSleeping', 'overlay', 'clearsSleep', 'sets', 'gazeTarget',
  'suppressFidgets', 'action', 'interruptExitMs', 'token', 'thenIfNotPlaying', 'intervalMs']);

/** The app's idle ticks (idleTick.intervalMs): seeded, uniform in the interval, from 0 to untilMs. */
export function idleTickTimes(spec, untilMs, seed = 1) {
  const iv = spec.stateMachine.events.idleTick?.intervalMs;
  if (!iv) return [];
  const rng = mulberry32(seed ^ 0x51ed), out = [];
  for (let t = iv[0] + rng() * (iv[1] - iv[0]); t < untilMs; t += iv[0] + rng() * (iv[1] - iv[0])) out.push(Math.round(t));
  return out;
}

export function simulate(spec, events, { untilMs, seed } = {}) {
  const sm = spec.stateMachine, ev = sm.events, I = sm.interrupt;
  const clips = spec.clips;
  const dur = (name, part) => clipDuration(part ? clips[name][part] : clips[name]);
  const rng = mulberry32(seed ?? ev.idleTick?.seed ?? 1);
  const segs = [];
  segs.speech = [];
  segs.picks = [];
  let cur = null;          // { clip, part, start, end, req, released, holdStart }
  let queue = null;        // { req, expiresAt }
  let lockChain = false;
  let hidden = false, hiddenAt = 0;
  let speaking = false, token = null, speechFrom = 0;
  let sleeping = false, sleepReq = null, menuOpen = false, lastPick = null;
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
  function idleNow(t) {
    cur = null; lockChain = false;
    if (sleeping && sleepReq && !hidden) start({ ...sleepReq, event: 'sleepResume' }, t);
  }
  function nextFromQueue(t) {
    if (queue && queue.expiresAt >= t) { const q = queue.req; queue = null; start(q, t); return; }
    queue = null;
    idleNow(t);
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
    for (let guard = 0; cur && cur.end <= t && guard < 10000; guard++) {
      const te = cur.end, r = cur.req;
      if (cur.part === 'oneShot' || cur.part === 'exit') { endSeg(te, 'complete'); const rq = r; cur = null; afterChain(rq, te); continue; }
      const forced = r.maxMs && te - cur.holdStart >= r.maxMs;
      if (cur.part === 'enter') {
        endSeg(te, 'complete');
        // A release that came during the enter goes straight to the exit.
        startSection(r, holdReleased(te) || forced ? 'exit' : 'loop', te);
        continue;
      }
      if (holdReleased(te) || forced) { endSeg(te, forced ? 'maxMs' : 'released'); startSection(r, 'exit', te); }
      else { endSeg(te, 'cycle'); startSection(r, 'loop', te); }
    }
  }
  function release(clipName, t) {
    if (!cur || cur.clip !== clipName) return false;
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
  function overlay(name, t) {
    log({ clip: name, part: 'overlay', start: t, end: t + dur(name), how: 'complete' });
  }
  function closeSpeech(t) { if (speaking) segs.speech.push([speechFrom, t]); speaking = false; token = null; }

  const sorted = events.map((e, i) => ({ t: e[0], name: e[1], data: e[2] ?? {}, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  for (const { t, name, data } of sorted) {
    advance(t);
    let e = ev[name];
    if (name === 'fullscreenHide') { if (cur) endSeg(t, 'stopped'); cur = null; queue = null; lockChain = false; hidden = true; hiddenAt = t; continue; }
    if (name === 'fullscreenShow') {
      hidden = false;
      if (sleeping && e?.resumeIfSleeping) { idleNow(t); continue; }
      if (e?.clip && (!e.ifHiddenForMs || t - hiddenAt >= e.ifHiddenForMs)) request(mk(name, e), t);
      continue;
    }
    if (!e) continue;
    if (e.clearsSleep) { if (!sleeping) continue; e = ev.userBack; }   // nextNow while asleep is a userBack
    if (e.sets) { if ('menuOpen' in e.sets) menuOpen = e.sets.menuOpen; }
    if (e.cooldownMs !== undefined && typeof e.cooldownMs === 'number') { if (cooldown[name] !== undefined && t - cooldown[name] < e.cooldownMs) continue; cooldown[name] = t; }
    if (name === 'speakStart') { closeSpeech(t); speaking = true; token = data.token ?? null; speechFrom = t; }
    if (name === 'speakEnd') {
      if (data.token !== undefined && token !== null && data.token !== token) continue; // a cancelled utterance's late end
      closeSpeech(t);
    }
    if (e === ev.userBack) sleeping = false;
    if (e.overlay) { overlay(e.overlay, t); continue; }
    if (name === 'idleTick') {
      if (cur || hidden || sleeping || (menuOpen && e.suppressedByMenu !== false)) continue;
      const cands = (e.pick ?? []).filter(([c]) => !(e.noRepeat && c === lastPick) && !(cooldown[`clip:${c}`] !== undefined && t - cooldown[`clip:${c}`] < (e.cooldownMs?.[c] ?? 0)));
      if (!cands.length) continue;
      let r = rng() * cands.reduce((a, [, w]) => a + w, 0), pick = cands[cands.length - 1][0];
      for (const [c, w] of cands) { if (r < w) { pick = c; break; } r -= w; }
      cooldown[`clip:${pick}`] = t; lastPick = pick; segs.picks.push([t, pick]);
      request({ clip: pick, priority: e.priority, event: name }, t);
      continue;
    }
    let handled = false;
    if (e.exits) {
      handled = release(e.exits, t);
      if (handled && e.then && cur) cur.req = { ...cur.req, then: e.then, locks: e.locks || cur.req.locks };
      if (handled && e.locks) lockChain = true;
      if (!handled && e.then && e.thenIfNotPlaying !== false) request({ clip: e.then, priority: e.priority ?? 0, locks: e.locks, event: name }, t);
    }
    if (e.clip) {
      const req = mk(name, e);
      if (e.hold === 'untilEvent:userBack') { sleeping = true; sleepReq = req; }   // a held state, resumed whenever nothing plays
      request(req, t);
    }
  }
  advance(untilMs ?? (sorted.length ? sorted[sorted.length - 1].t + 60000 : 60000));
  if (cur) endSeg(untilMs ?? cur.end, 'open');
  if (speaking) segs.speech.push([speechFrom, Infinity]);
  return segs;

  function mk(name, e) { return { clip: e.clip, priority: e.priority ?? 0, hold: e.hold, minMs: e.minMs, maxMs: e.maxMs, locks: e.locks, then: e.then, event: name }; }
}

/** Mouth layer: viseme weights at time t. Visemes play only while speech plays (plus releaseMs fading out). */
export function mouthAt(spec, segs, t) {
  const m = spec.stateMachine?.mouth;
  const out = {};
  if (!m) return out;
  let gate = 0, from = 0;
  for (const [a, b] of segs.speech ?? []) {
    if (t < a) continue;
    const g = t <= b ? 1 : Math.max(0, 1 - (t - b) / (m.releaseMs || 1));
    if (g > gate) { gate = g; from = a; }
  }
  for (const [k, tr] of Object.entries(m.tracks ?? {})) out[k] = gate ? gate * sampleTrack(tr, (t - from) % m.periodMs) : 0;
  return out;
}

/** Checks one scenario's expectations against a simulated timeline. Returns failure messages. */
export function expectations(segs, expect) {
  const fails = [];
  const match = (s, id) => (id.includes('.') ? `${s.clip}.${s.part}` === id : s.clip === id);
  const ofClip = (id) => segs.filter((s) => match(s, id));
  const IDLE = ['look', 'hairTuck', 'breathe'];
  const picks = segs.picks ?? segs.filter((s) => IDLE.includes(s.clip) && s.part === 'oneShot').map((s) => [s.start, s.clip]);
  const show = (id) => ofClip(id).map((s) => `${s.part} ${s.start}-${s.end} ${s.how}`).join('; ') || 'never starts';
  for (const [kind, a, b, c] of expect) {
    if (kind === 'completes') {
      const done = ofClip(a).filter((s) => (b === undefined || s.start >= b) && ((s.part === 'oneShot' || s.part === 'exit' || s.part === 'overlay') && s.how === 'complete'));
      if (!done.length) fails.push(`${a} never plays to its end (${show(a)})`);
    } else if (kind === 'startsAfter') {
      const B = ofClip(b), b0 = B.length ? B[0].start : Infinity;
      const A = ofClip(a).filter((s) => s.start >= b0);
      const bEnd = Math.max(...B.filter((s) => s.how === 'complete').map((s) => s.end), -Infinity);
      if (!B.length) fails.push(`${b} never plays`);
      else if (!A.length) fails.push(`${a} never starts after ${b} starts`);
      else if (A[0].start < bEnd - 1) fails.push(`${a} starts at ${A[0].start} ms, before ${b} ends at ${bEnd} ms`);
    } else if (kind === 'playsAfter') {
      // a plays at some point after the last section of b has ended
      const B = ofClip(b);
      const bEnd = Math.max(...B.map((s) => s.end), -Infinity);
      if (!B.length) fails.push(`${b} never plays`);
      else if (!ofClip(a).some((s) => s.start >= bEnd - 1)) fails.push(`${a} never plays after ${b} ends at ${bEnd} ms (${show(a)})`);
    } else if (kind === 'preempts') {
      const B = ofClip(b), A = ofClip(a);
      if (!A.length || !B.some((s) => s.how === 'preempted' && Math.abs(s.end - A[0].start) < 1)) fails.push(`${a} does not preempt ${b}`);
    } else if (kind === 'never') {
      if (ofClip(a).length) fails.push(`${a} plays but must not (${show(a)})`);
    } else if (kind === 'neverAfter') {
      if (ofClip(a).some((s) => s.start >= b)) fails.push(`${a} plays after ${b} ms but must not (${show(a)})`);
    } else if (kind === 'plays') {
      if (!ofClip(a).length) fails.push(`${a} never plays`);
    } else if (kind === 'stopsAt') {
      const after = segs.filter((s) => s.start < a && s.end > a + 1);
      if (after.length) fails.push(`still playing past ${a} ms: ${after.map((s) => s.clip).join(', ')}`);
    } else if (kind === 'startsWithin') {
      // [startsWithin, id, tMs, withinMs]: some section of id starts in [t, t + within]
      if (!ofClip(a).some((s) => s.start >= b - 1 && s.start <= b + c)) fails.push(`${a} does not start within ${c} ms of ${b} ms (${show(a)})`);
    } else if (kind === 'exitBy') {
      // [exitBy, clip, tMs]: the clip's exit has started by t
      if (!segs.some((s) => s.clip === a && s.part === 'exit' && s.start <= b + 1)) fails.push(`${a}.exit has not started by ${b} ms (${show(a)})`);
    } else if (kind === 'playingAt') {
      if (!ofClip(a).some((s) => s.start <= b && s.end > b)) fails.push(`${a} is not playing at ${b} ms (${show(a)})`);
    } else if (kind === 'picksAll') {
      // [picksAll, [clips]]: every listed clip is picked by idleTick at least once
      const got = new Set(picks.map((p) => p[1]));
      const miss = a.filter((x) => !got.has(x));
      if (miss.length) fails.push(`idle picks never chose ${miss.join(', ')} (${[...got].join(', ') || 'nothing'} picked)`);
    } else if (kind === 'noRepeat') {
      const p = picks;
      const rep = p.findIndex((x, i) => i > 0 && x[1] === p[i - 1][1]);
      if (rep > 0) fails.push(`idle pick ${p[rep][1]} at ${p[rep][0]} ms repeats the previous pick`);
    } else if (kind === 'noIdleIn') {
      const p = picks.filter((x) => x[0] >= a && x[0] < b);
      if (p.length) fails.push(`idle fidget ${p[0][1]} at ${p[0][0]} ms while it must be suppressed (${a}-${b} ms)`);
    } else if (kind === 'idleIn') {
      if (!picks.some((x) => x[0] >= a && x[0] < b)) fails.push(`no idle fidget in ${a}-${b} ms`);
    } else fails.push(`unknown expectation ${kind}`);
  }
  return fails;
}
