// Stands in for the Tauri runtime in headless Chrome. Injected before app code by tools/e2e/run.ts
// as `(${source})(config)`; see README.md for the contract.
// Pages of one scenario share an origin, so localStorage plays the Rust process (store data survives
// a reload) and a BroadcastChannel links the main and pet windows.
// eslint-disable-next-line no-unused-vars
function installTauriMock({ label, seed, monitor }) {
  const STORE_PREFIX = 'e2e:store:';
  const bus = new BroadcastChannel('tauri-e2e');

  const e2e = {
    label,
    calls: [],       // every invoke: { cmd, args }
    unknown: [],     // command names the mock does not handle; the runner fails the scenario if any
    hitRects: null,  // last pet_set_hit_rects
    windowSize: null, // last setSize; the runner copies it onto the viewport
    system: { busy: false, idleSecs: 0 },
    autostart: false,
    dialogResult: null,
  };
  window.__e2e = e2e;

  try {
    if (seed && !localStorage.getItem('e2e:seeded')) {
      for (const [path, data] of Object.entries(seed)) localStorage.setItem(STORE_PREFIX + path, JSON.stringify(data));
      localStorage.setItem('e2e:seeded', '1');
    }
  } catch (err) {
    console.error('[e2e] could not seed stores', err);
  }

  // ---------------------------------------------------------------- callbacks
  const callbacks = new Map();
  function transformCallback(cb, once = false) {
    const id = crypto.getRandomValues(new Uint32Array(1))[0];
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return cb && cb(data);
    });
    return id;
  }

  // ---------------------------------------------------------------- events
  let nextEventId = 1;
  const listeners = new Map(); // event → [{ id, handler }]
  function deliver(event, payload) {
    for (const l of listeners.get(event) ?? []) callbacks.get(l.handler)?.({ event, id: l.id, payload });
  }
  /** `to` is a window label, or null for every window (this one included). */
  function emit(event, payload, to = null) {
    if (to === null || to === label) deliver(event, payload);
    bus.postMessage({ kind: 'event', event, payload, to });
  }

  // ---------------------------------------------------------------- plugin-store
  const stores = new Map(); // path → { rid, data }
  const ridToPath = new Map();
  let nextRid = 1;
  function readStore(path) {
    try { return JSON.parse(localStorage.getItem(STORE_PREFIX + path) ?? '{}'); } catch { return {}; }
  }
  function writeStore(path, data) {
    localStorage.setItem(STORE_PREFIX + path, JSON.stringify(data));
  }
  function storeOf(rid) {
    const path = ridToPath.get(rid);
    if (!path) throw new Error(`[e2e] unknown store rid ${rid}`);
    return { path, s: stores.get(path) };
  }
  // The real plugin emits store://change to every window, each with its own resource id.
  function storeChanged(path, key, value, exists) {
    const local = stores.get(path);
    if (local) deliver('store://change', { path, resourceId: local.rid, key, value, exists });
    bus.postMessage({ kind: 'store', path, key, value, exists });
  }

  // ---------------------------------------------------------------- windows
  const win = { position: { x: 0, y: 0 }, size: { width: innerWidth, height: innerHeight }, visible: false };
  const physical = (v, key) => (v.Physical ?? v.Logical ?? v)[key];
  const inMonitor = (x, y) =>
    x >= monitor.position.x && y >= monitor.position.y &&
    x < monitor.position.x + monitor.size.width && y < monitor.position.y + monitor.size.height;

  bus.onmessage = ({ data }) => {
    if (data.kind === 'event') {
      if (data.to === null || data.to === label) deliver(data.event, data.payload);
    } else if (data.kind === 'store') {
      const local = stores.get(data.path);
      if (!local) return;
      if (data.exists) local.data[data.key] = data.value;
      else delete local.data[data.key];
      deliver('store://change', { path: data.path, resourceId: local.rid, key: data.key, value: data.value, exists: data.exists });
    }
  };

  // ---------------------------------------------------------------- commands
  const ok = () => null;
  const handlers = {
    // app commands (src-tauri/src/*.rs)
    open_main: ({ route }) => {
      if (route) emit('main:navigate', route, 'main');
      return null;
    },
    pet_set_hit_rects: ({ rects }) => { e2e.hitRects = rects; return null; },
    system_state: () => ({ ...e2e.system }),
    tts_http: () => { throw new Error('[e2e] tts_http has no network voice in tests'); },
    voicepack_info: () => { throw new Error('[e2e] no voice pack in tests'); },
    voicepack_clip: () => { throw new Error('[e2e] no voice pack in tests'); },

    // events
    'plugin:event|listen': ({ event, handler }) => {
      const id = nextEventId++;
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push({ id, handler });
      return id;
    },
    'plugin:event|unlisten': ({ event, eventId }) => {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l.id !== eventId));
      return null;
    },
    'plugin:event|emit': ({ event, payload }) => { emit(event, payload); return null; },
    'plugin:event|emit_to': ({ target, event, payload }) => {
      emit(event, payload, typeof target === 'string' ? target : target.label);
      return null;
    },

    // plugin-store
    'plugin:store|load': ({ path, options }) => {
      if (!stores.has(path)) {
        const rid = nextRid++;
        const saved = readStore(path);
        stores.set(path, { rid, data: Object.keys(saved).length ? saved : { ...(options?.defaults ?? {}) } });
        ridToPath.set(rid, path);
      }
      return stores.get(path).rid;
    },
    'plugin:store|get_store': ({ path }) => stores.get(path)?.rid ?? null,
    'plugin:store|get': ({ rid, key }) => {
      const { s } = storeOf(rid);
      return [s.data[key] ?? null, key in s.data];
    },
    'plugin:store|set': ({ rid, key, value }) => {
      const { path, s } = storeOf(rid);
      s.data[key] = value;
      writeStore(path, s.data);
      storeChanged(path, key, value, true);
      return null;
    },
    'plugin:store|has': ({ rid, key }) => key in storeOf(rid).s.data,
    'plugin:store|delete': ({ rid, key }) => {
      const { path, s } = storeOf(rid);
      const had = key in s.data;
      delete s.data[key];
      writeStore(path, s.data);
      if (had) storeChanged(path, key, null, false);
      return had;
    },
    'plugin:store|keys': ({ rid }) => Object.keys(storeOf(rid).s.data),
    'plugin:store|values': ({ rid }) => Object.values(storeOf(rid).s.data),
    'plugin:store|entries': ({ rid }) => Object.entries(storeOf(rid).s.data),
    'plugin:store|length': ({ rid }) => Object.keys(storeOf(rid).s.data).length,
    'plugin:store|save': ok,
    'plugin:store|reload': ({ rid }) => { const { path, s } = storeOf(rid); s.data = readStore(path); return null; },
    'plugin:resources|close': ok,

    // plugin-opener, plugin-autostart, plugin-dialog: recorded in e2e.calls
    'plugin:opener|open_url': ok,
    'plugin:opener|open_path': ok,
    'plugin:opener|reveal_item_in_dir': ok,
    'plugin:autostart|is_enabled': () => e2e.autostart,
    'plugin:autostart|enable': () => { e2e.autostart = true; return null; },
    'plugin:autostart|disable': () => { e2e.autostart = false; return null; },
    'plugin:dialog|open': () => e2e.dialogResult,
    'plugin:dialog|save': () => e2e.dialogResult,
    'plugin:dialog|message': ok,

    // window
    'plugin:window|show': () => { win.visible = true; return null; },
    'plugin:window|hide': () => { win.visible = false; return null; },
    'plugin:window|minimize': ok,
    'plugin:window|toggle_maximize': ok,
    'plugin:window|close': ok,
    'plugin:window|start_dragging': ok,
    'plugin:window|scale_factor': () => monitor.scaleFactor,
    'plugin:window|outer_position': () => ({ ...win.position }),
    'plugin:window|outer_size': () => ({ ...win.size }),
    'plugin:window|set_position': ({ value }) => {
      const next = { x: physical(value, 'x'), y: physical(value, 'y') };
      const moved = next.x !== win.position.x || next.y !== win.position.y;
      win.position = next;
      if (moved) deliver('tauri://move', next);
      return null;
    },
    'plugin:window|set_size': ({ value }) => {
      win.size = { width: physical(value, 'width'), height: physical(value, 'height') };
      e2e.windowSize = win.size;
      return null;
    },
    'plugin:window|primary_monitor': () => monitor,
    'plugin:window|monitor_from_point': ({ x, y }) => (inMonitor(x, y) ? monitor : null),
  };

  async function invoke(cmd, rawArgs = {}) {
    // Tauri sends args as JSON; dpi classes (LogicalSize, PhysicalPosition…) serialize via toJSON.
    const args = JSON.parse(JSON.stringify(rawArgs));
    e2e.calls.push({ cmd, args });
    const handler = handlers[cmd];
    if (!handler) {
      e2e.unknown.push(cmd);
      const err = new Error(`[e2e] unmocked Tauri command: ${cmd}`);
      console.error(err.message, args);
      throw err;
    }
    return handler(args);
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (path) => path,
    metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
    plugins: {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (event, id) => {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l.id !== id));
    },
  };
}
