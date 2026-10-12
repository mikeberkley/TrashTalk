import { expect, it } from 'vitest';
import { trashTalkImage } from '../worker/src/jobs/trash-talk-image';
export function jpeg(width = 1024, height = 1024) {
  return (
    'data:image/jpeg;base64,' +
    btoa(
      String.fromCharCode(
        ...[
          255,
          216,
          255,
          224,
          0,
          4,
          0,
          0,
          255,
          192,
          0,
          11,
          8,
          height >> 8,
          height & 255,
          width >> 8,
          width & 255,
          1,
          1,
          17,
          0,
          255,
          217,
        ],
      ),
    )
  );
}
it('accepts square JPEG output and returns the matching extension and MIME', () => {
  expect(trashTalkImage(jpeg())).toMatchObject({
    extension: 'jpg',
    contentType: 'image/jpeg',
  });
});
it('rejects invalid, truncated and non-square JPEGs', () => {
  expect(() => trashTalkImage(jpeg(1024, 768))).toThrow('square');
  expect(() =>
    trashTalkImage('data:image/jpeg;base64,' + btoa('invalid')),
  ).toThrow('JPEG');
  expect(() =>
    trashTalkImage(
      'data:image/jpeg;base64,' +
        btoa(String.fromCharCode(255, 216, 255, 192, 0, 20)),
    ),
  ).toThrow('JPEG');
});
