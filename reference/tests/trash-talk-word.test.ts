import { expect, it } from 'vitest';
import {
  validateIncludeWord,
  captionIncludesWord,
} from '../packages/trash-talk/src/include-word';

it.each([undefined, '', '   '])(
  'allows an omitted optional word: %s',
  (word) => {
    expect(validateIncludeWord(word)).toEqual({ word: '' });
  },
);
it.each(['banana', 'Scunthorpe', 'classic', 'grass', 'cockatoo'])(
  'allows ordinary words without substring false positives: %s',
  (word) => {
    expect(validateIncludeWord(` ${word} `)).toEqual({ word });
  },
);
it.each([
  'two words',
  'two\nwords',
  'ice-cream',
  "can't",
  '123',
  'f00k',
  'f*ck',
  'banana!',
  'a'.repeat(31),
  null,
  42,
  ['banana'],
])('rejects non-single words: %s', (word) => {
  expect(validateIncludeWord(word).error).toBeTruthy();
});
it.each([
  'fuck',
  'SHIT',
  'fuuuck',
  'fuk',
  'bitch',
  'asshole',
  'damn',
  'hell',
  'crap',
])('blocks swearing: %s', (word) => {
  expect(validateIncludeWord(word).error).toContain('without swearing');
});
it('requires a complete caption word, allowing capitalization and punctuation', () => {
  expect(captionIncludesWord('BANANA! Your defense slipped.', 'banana')).toBe(
    true,
  );
  expect(captionIncludesWord('A bananas defense.', 'banana')).toBe(false);
  expect(captionIncludesWord('Catch that!', 'cat')).toBe(false);
  expect(captionIncludesWord('cat1', 'cat')).toBe(false);
});
