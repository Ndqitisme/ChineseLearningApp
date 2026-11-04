// Tiny hash router: "#/word/吃" → { name: 'word', params: ['吃'] }.

export interface Route { path: string; name: string; params: string[] }

function parse(hash: string): Route {
  const path = decodeURIComponent(hash.replace(/^#/, '')) || '/';
  const [name = '', ...params] = path.split('/').filter(Boolean);
  return { path, name: name || 'home', params };
}

export const route = $state<Route>(parse(location.hash));

window.addEventListener('hashchange', () => Object.assign(route, parse(location.hash)));

export function go(path: string) {
  location.hash = path;
}
