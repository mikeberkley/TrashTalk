import { expect, it } from 'vitest';
import {
  pregameShareDate,
  pregameShareTitle,
} from '../packages/trash-talk/src/share-title';
it('formats the kickoff date in Eastern time, including evening games after midnight UTC', () => {
  const day = pregameShareDate('2026-10-13T00:15:00Z');
  expect(day).toBe('2026-10-12');
  expect(pregameShareTitle('Bills vs Rams', day)).toBe(
    'Bills vs Rams on Mon Oct 12',
  );
});
it('does not invent a date for an invalid kickoff', () => {
  expect(pregameShareDate('invalid')).toBeUndefined();
  expect(pregameShareTitle('Bills vs Rams', '2026-02-30')).toBeUndefined();
});
