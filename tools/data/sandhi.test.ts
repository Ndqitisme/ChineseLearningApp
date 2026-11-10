import { describe, expect, it } from 'vitest';
import { writeYiBuSandhi } from './sandhi.ts';

const none = new Map<string, string>();
const write = (hanzi: string, numeric: string, overrides = none) => writeYiBuSandhi(hanzi, numeric.split(' '), overrides).join(' ');

describe('writeYiBuSandhi', () => {
  it('writes bú before a 4th tone and keeps the neutral tones of the list', () => {
    expect(write('不客气', 'bu4 ke4 qi5')).toBe('bu2 ke4 qi5');
    expect(write('不对', 'bu4 dui4')).toBe('bu2 dui4');
    expect(write('不同', 'bu4 tong2')).toBe('bu4 tong2');
    expect(write('不得不', 'bu4 de2 bu4')).toBe('bu4 de2 bu4');
  });

  it('writes yì before tones 1–3 and yí before a 4th tone', () => {
    expect(write('一些', 'yi1 xie1')).toBe('yi4 xie1');
    expect(write('一直', 'yi1 zhi2')).toBe('yi4 zhi2');
    expect(write('一起', 'yi1 qi3')).toBe('yi4 qi3');
    expect(write('一共', 'yi1 gong4')).toBe('yi2 gong4');
    expect(write('一模一样', 'yi1 mu2 yi1 yang4')).toBe('yi4 mu2 yi2 yang4');
  });

  it('takes the changed tone from the next syllable as the list writes it', () => {
    expect(write('不一会儿', 'bu4 yi1 hui3 r5')).toBe('bu4 yi4 hui3 r5');
    expect(write('一个', 'yi1 ge5')).toBe('yi2 ge5');
  });

  it('keeps yī where 一 counts or orders', () => {
    expect(write('一月', 'yi1 yue4')).toBe('yi1 yue4');
    expect(write('第一', 'di4 yi1')).toBe('di4 yi1');
    expect(write('统一', 'tong3 yi1')).toBe('tong3 yi1');
  });

  it('keeps a neutral-tone 不 even where pinyin-pro reads bú', () => {
    expect(write('说不定', 'shuo1 bu5 ding4')).toBe('shuo1 bu5 ding4');
    expect(write('对不起', 'dui4 bu5 qi3')).toBe('dui4 bu5 qi3');
  });

  it('leaves a word from the override file as written', () => {
    const overrides = new Map([['一会儿', 'yi1 hui4 r5']]);
    expect(write('一会儿', 'yi1 hui4 r5', overrides)).toBe('yi1 hui4 r5');
    expect(write('一会儿', 'yi1 hui4 r5')).toBe('yi2 hui4 r5');
  });
});
