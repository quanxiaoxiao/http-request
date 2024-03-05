import assert from 'node:assert';
import net from 'node:net';
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
        () => {
          const socket = new net.Socket();
          return socket;
        },
      );
    },
    (error) => error instanceof assert.AssertionError,
  );
});
