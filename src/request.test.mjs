import assert from 'node:assert';
import net from 'node:net';
import { test, mock } from 'node:test';
import { encodeHttp } from '@quanxiaoxiao/http-utils';
import { errors } from '@quanxiaoxiao/about-net';
import request from './request.mjs';

const _getPort = () => {
  let _port = 5350;
  return () => {
    const port = _port;
    _port += 1;
    return port;
  };
};

const getPort = _getPort();

const waitFor = async (t = 100) => {
  await new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, t);
  });
};

const connect = (port) => () => {
  const socket = net.Socket();
  socket.connect({
    host: '127.0.0.1',
    port,
  });
  return socket;
};

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

test('request socket unable connect 1', async () => {
  try {
    await request(
      {
        path: '/aaa',
      },
      () => {
        const socket = net.Socket();
        return socket;
      },
    );
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof errors.SocketConnectError);
  }
});

test('request socket unable connect 2', async () => {
  try {
    await request(
      {
        path: '/aaa',
      },
      connect(9989),
    );
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof errors.SocketConnectError);
  }
  await waitFor();
});

test('server close socket with no response', async () => {
  const port = getPort();

  const handleDataOnSocket = mock.fn((chunk) => {
    assert.equal(
      chunk.toString(),
      encodeHttp({
        path: '/',
        method: 'GET',
        body: null,
      }).toString(),
    );
  });

  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.end();
    }, 80);
  });

  server.listen(port);

  try {
    await request({}, connect(port));
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof errors.SocketCloseError);
  }
  await waitFor();
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
});

test('server response with not full chunk', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write('HTTP/1.1 200\r\nContent-Length: 3\r\n\r\nab');
    }, 20);
    setTimeout(() => {
      socket.destroy();
    }, 100);
  });
  server.listen(port);
  try {
    await request({}, connect(port));
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof errors.SocketCloseError);
  }
  await waitFor(500);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
});

test('request onRequest trigger error', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  try {
    await request(
      {
        onRequest: async () => {
          await waitFor(200);
          assert.equal(handleCloseOnSocket.mock.calls.length, 0);
          throw new Error('eeee');
        },
      },
      connect(port),
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.message, 'eeee');
  }
  await waitFor(500);
  server.close();
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(handleDataOnSocket.mock.calls.length, 0);
});
