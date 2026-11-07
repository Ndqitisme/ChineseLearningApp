import { describe, expect, it } from 'vitest';
import { autoVoice } from './index.ts';

const v = (name: string) => ({ name });
// The voices this Windows machine has, in the order the WebView lists them.
const windows = ['Microsoft Huihui - Chinese (Simplified, PRC)', 'Microsoft Kangkang - Chinese (Simplified, PRC)', 'Microsoft Yaoyao - Chinese (Simplified, PRC)'].map(v);

describe('autoVoice', () => {
  it('picks a voice of the slot gender, not the first Chinese voice', () => {
    expect(autoVoice(windows, 'male')?.name).toContain('Kangkang');
    expect(autoVoice(windows, 'female')?.name).toContain('Huihui');
  });

  it('knows neural and macOS names', () => {
    expect(autoVoice([v('Microsoft Xiaoxiao Online (Natural)'), v('Microsoft Yunxi Online (Natural)')], 'male')?.name).toContain('Yunxi');
    expect(autoVoice([v('Microsoft Yunxi Online (Natural)'), v('Microsoft Xiaoxiao Online (Natural)')], 'female')?.name).toContain('Xiaoxiao');
    expect(autoVoice([v('Tingting'), v('Li-mu')], 'male')?.name).toBe('Li-mu');
    expect(autoVoice([v('Li-mu'), v('Lili')], 'female')?.name).toBe('Lili');
  });

  it('does not read "female" as male, and finds nothing when no name matches', () => {
    expect(autoVoice([v('Chinese female'), v('Chinese male')], 'male')?.name).toBe('Chinese male');
    expect(autoVoice([windows[0], windows[2]], 'male')).toBeUndefined();
    expect(autoVoice([v('Google 普通话（中国大陆）')], 'female')).toBeUndefined();
  });
});
