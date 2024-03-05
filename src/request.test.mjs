import assert from 'node:assert';
import test from 'node:test';
import request from './request.mjs';

test('request signal aborted', () => {
  assert.throws(
    () => {
      const controller = new AbortController();
      controller.abort();

      request(
        {
          signal: controller.signal,
        },
        () => {},
      );
    },
    (error) => error instanceof assert.AssertionError,
  );
});
