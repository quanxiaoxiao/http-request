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
      () => {
        const socket = net.Socket();
        socket.connect({
          host: '127.0.0.1',
          port: 9989,
        });
        return socket;
      },
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
    await request({}, () => {
      const socket = net.Socket();
      socket.connect({
        host: '127.0.0.1',
        port,
      });
      return socket;
    });
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof errors.SocketCloseError);
  }
  await waitFor();
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
});
