import assert from 'node:assert';
import net from 'node:net';
import { test, mock } from 'node:test';
import { waitFor } from '@quanxiaoxiao/utils';
import getSocketConnect from './getSocketConnect.mjs';

const _getPort = () => {
  let _port = 5850;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const getPort = _getPort();

test('getSocketConnect invalid', () => {
  assert.throws(
    () => {
      getSocketConnect({
        protocol: 'htttp:',
        port: 888,
      });
    },
    (error) => error instanceof assert.AssertionError,
  );
  assert.throws(
    () => {
      getSocketConnect({
        port: 65536,
      });
    },
    (error) => error instanceof assert.AssertionError,
  );
  assert.throws(
    () => {
      getSocketConnect({
        port: 88.8,
      });
    },
    (error) => error instanceof assert.AssertionError,
  );
});

test('getSocketConnect', async () => {
  const port = getPort();

  const handleSocket = mock.fn(() => {});

  const server = net.createServer(handleSocket);

  server.listen(port);
  await waitFor(100);

  const handleSocketClientConnect = mock.fn(() => {});

  const socket = getSocketConnect({
    port,
  });

  socket.on('connect', handleSocketClientConnect);

  await waitFor(500);

  assert.equal(handleSocket.mock.calls.length, 1);
  assert.equal(handleSocketClientConnect.mock.calls.length, 1);

  await waitFor(100);

  socket.destroy();
  server.close();
});

test('getSocketConnect 2', async () => {
  const port = 80;

  const handleSocket = mock.fn(() => {});

  const server = net.createServer(handleSocket);

  server.listen(port);
  await waitFor(100);

  const handleSocketClientConnect = mock.fn(() => {});

  const socket = getSocketConnect({});

  socket.on('connect', handleSocketClientConnect);

  await waitFor(500);

  assert.equal(handleSocket.mock.calls.length, 1);
  assert.equal(handleSocketClientConnect.mock.calls.length, 1);

  await waitFor(100);

  socket.destroy();
  server.close();
});

test('getSocketConnect 3', async () => {
  const port = 443;

  const handleSocket = mock.fn(() => {});

  const server = net.createServer(handleSocket);

  server.listen(port);
  await waitFor(100);

  const handleSocketClientConnect = mock.fn(() => {});

  const socket = getSocketConnect({
    protocol: 'https:',
  });

  socket.on('connect', handleSocketClientConnect);

  await waitFor(500);

  assert.equal(handleSocket.mock.calls.length, 1);
  assert.equal(handleSocketClientConnect.mock.calls.length, 1);

  await waitFor(100);

  socket.destroy();
  server.close();
});
