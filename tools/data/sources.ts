// Upstream data the build depends on, pinned to a commit or release so a fresh clone rebuilds the
// same dataset. Hashes live in sources.lock.json; a changed file fails the fetch until someone
// reviews it and reruns with --update.

export interface Source { id: string; url: string; file: string; license: string }

export const CACHE_DIR = '.cache/sources';

export const SOURCES: Source[] = [
  { id: 'cvdict', file: 'CVDICT.u8', license: 'CC BY-SA 4.0',
    url: 'https://raw.githubusercontent.com/ph0ngp/CVDICT/c379d909e308343a247e51619f7839a2060a271c/CVDICT.u8' },
  { id: 'hsk', file: 'complete-hsk.json', license: 'MIT (meanings: CC BY-SA 4.0)',
    url: 'https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/7ac65bf1a6387d35f1ade478906172a19311c7f9/complete.json' },
  { id: 'wenkai', file: 'LXGWWenKaiLite-Regular.ttf', license: 'OFL 1.1',
    url: 'https://github.com/lxgw/LxgwWenKai-Lite/releases/download/v1.530/LXGWWenKaiLite-Regular.ttf' },
  { id: 'wenkai-ofl', file: 'OFL-LXGWWenKai.txt', license: 'OFL 1.1',
    url: 'https://raw.githubusercontent.com/lxgw/LxgwWenKai-Lite/3bca1fc0a0e00f6627f4c8bee60ef07778ab1820/OFL.txt' },
  { id: 'nunito', file: 'Nunito.ttf', license: 'OFL 1.1',
    url: 'https://raw.githubusercontent.com/google/fonts/2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc/ofl/nunito/Nunito%5Bwght%5D.ttf' },
  { id: 'nunito-ofl', file: 'OFL-Nunito.txt', license: 'OFL 1.1',
    url: 'https://raw.githubusercontent.com/google/fonts/2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc/ofl/nunito/OFL.txt' },
];
