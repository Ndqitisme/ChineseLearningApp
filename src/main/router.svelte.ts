// Tiny hash router: "#/word/吃" → { name: 'word', params: ['吃'] }.

export interface Route { path: string; name: string; params: string[] }

function parse(hash: string): Route {
  const path = decodeURIComponent(hash.replace(/^#/, '')) || '/';
  const [name = '', ...params] = path.split('/').filter(Boolean);
  return { path, name: name || 'home', params };
}

export const route = $state<Route>(parse(location.hash));

// Position in this window's own history. A window opened straight onto a page (e.g. a word clicked
// in the assistant's bubble) has nothing to go back to, so back() needs to know that.
let index = 0;
history.replaceState({ i: 0 }, '');

window.addEventListener('hashchange', () => {
  const state = history.state as { i?: number } | null;
  if (state?.i === undefined) history.replaceState({ i: ++index }, '');
  else index = state.i;
  Object.assign(route, parse(location.hash));
});

export function go(path: string) {
  location.hash = path;
}

/** Previous page in this window, or `fallback` when the window started on the current page. */
export function back(fallback: string) {
  if (index > 0) history.back();
  else go(fallback);
}
