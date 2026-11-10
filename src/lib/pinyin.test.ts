import { describe, expect, it } from 'vitest';
import { searchKey, splitWritten } from './pinyin.ts';

describe('searchKey', () => {
  it('finds ü syllables whether the learner types ü, v or u', () => {
    const word = searchKey('yílǜ');
    for (const typed of ['yilu', 'yilv', 'yílǜ', 'yi lü']) expect(searchKey(typed)).toBe(word);
  });
});

describe('splitWritten', () => {
  it('splits written words into syllables, so each one takes its own tone colour', () => {
    expect(splitWritten('Guǎngdōng de diǎnxin hěn yǒumíng.')).toEqual(['Guǎng', 'dōng', 'de', 'diǎn', 'xin', 'hěn', 'yǒu', 'míng']);
  });
  it('n/ng before a vowel starts the next syllable; a/o/e syllables need the apostrophe', () => {
    expect(splitWritten('dàngāo')).toEqual(['dàn', 'gāo']);
    expect(splitWritten("Xī'ān nǚ'ér")).toEqual(['Xī', 'ān', 'nǚ', 'ér']);
    expect(splitWritten('piányi xiànzài')).toEqual(['pián', 'yi', 'xiàn', 'zài']);
  });
  it('keeps erhua on its syllable and leaves an unparsable word whole', () => {
    expect(splitWritten('yìdiǎnr')).toEqual(['yì', 'diǎnr']);
    expect(splitWritten('Qǐng jìn, qǐng zuò.')).toEqual(['Qǐng', 'jìn', 'qǐng', 'zuò']);
    expect(splitWritten('OK, hǎo')).toEqual(['OK', 'hǎo']);
  });
});
