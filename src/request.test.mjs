import assert from 'node:assert';
import net from 'node:net';
import { PassThrough } from 'node:stream';
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

test('request', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const onHeader = mock.fn((state) => {
    assert.equal(state.statusCode, 200);
    assert.equal(state.body.toString(), '');
    assert.deepEqual(state.headers, { server: 'quan', 'content-length': 2 });
    assert.deepEqual(state.headersRaw, ['server', 'quan', 'Content-Length', '2']);
  });
  const onStartLine = mock.fn((state) => {
    assert.equal(onHeader.mock.calls.length, 0);
    assert.equal(state.statusCode, 200);
  });
  const onRequest = mock.fn((options) => {
    assert.equal(onStartLine.mock.calls.length, 0);
    assert.equal(options.path, '/abc?name=aaa');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, 'quan1');
    assert.deepEqual(options.headers, { name: 'aaa' });
  });
  const onIncoming = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'HTTP/1.1 200 OK\r\nserver: quan\r\nContent-Length: 2\r\n\r\nok');
  });
  const onOutgoing = mock.fn((chunk) => {
    assert.equal(onIncoming.mock.calls.length, 0);
    assert.equal(chunk.toString(), 'POST /abc?name=aaa HTTP/1.1\r\nname: aaa\r\nContent-Length: 5\r\n\r\nquan1');
  });

  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write(encodeHttp({
        headers: {
          server: 'quan',
        },
        body: 'ok',
      }));
    }, 50);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const ret = await request(
    {
      method: 'POST',
      path: '/abc?name=aaa',
      body: 'quan1',
      headers: { name: 'aaa' },
      onRequest,
      onStartLine,
      onHeader,
      onOutgoing,
      onIncoming,
    },
    connect(port),
  );
  server.close();
  assert.equal(ret.body.toString(), 'ok');
  assert.deepEqual(ret.headers, { server: 'quan', 'content-length': 2 });
  assert.deepEqual(ret.headersRaw, ['server', 'quan', 'Content-Length', '2']);
  assert.equal(ret.statusCode, 200);
  await waitFor(100);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
  assert.equal(onStartLine.mock.calls.length, 1);
  assert.equal(onHeader.mock.calls.length, 1);
  assert.equal(onIncoming.mock.calls.length, 1);
  assert.equal(onOutgoing.mock.calls.length, 1);
});

test('request by response too early', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const onStartLine = mock.fn(() => {});
  const onIncoming = mock.fn(() => {});
  const onOutgoing = mock.fn(() => {});

  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.write(encodeHttp({
      headers: {
        server: 'quan',
      },
      body: 'ok',
    }));
    socket.on('close', handleCloseOnSocket);
  });

  server.listen(port);

  try {
    await request(
      {
        body: 'quan1',
        headers: { name: 'aaa' },
        onRequest: async () => {
          await waitFor(300);
          assert.equal(handleCloseOnSocket.mock.calls.length, 0);
        },
        onStartLine,
        onIncoming,
        onOutgoing,
      },
      connect(port),
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.message, 'request is not send, but received chunk');
  }
  await waitFor(500);
  server.close();
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(handleDataOnSocket.mock.calls.length, 0);
  assert.equal(onStartLine.mock.calls.length, 0);
  assert.equal(onIncoming.mock.calls.length, 0);
  assert.equal(onOutgoing.mock.calls.length, 0);
});

test('request onBody', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write('HTTP/1.1 200 OK\r\nServer: quan\r\nContent-Length: 5\r\n\r\nc');
    }, 50);
    setTimeout(() => {
      socket.write('bb');
    }, 100);
    setTimeout(() => {
      socket.write('11');
    }, 150);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onBody = mock.fn(() => {});

  const ret = await request(
    {
      onBody,
    },
    connect(port),
  );
  assert.equal(ret.body.toString(), '');
  assert.equal(ret.headers['content-length'], 5);
  assert.equal(ret.statusCode, 200);
  assert.equal(onBody.mock.calls.length, 3);
  assert.equal(
    Buffer.concat(onBody.mock.calls.map((d) => d.arguments[0])).toString(),
    'cbb11',
  );
  server.close();
});

test('request onHeader trigger error', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.write('HTTP/1.1 200 OK\r\nServer: quan\r\nContent-Length: 5\r\n\r\ncbbee');
    }, 50);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onBody = mock.fn(() => {});
  const onHeader = mock.fn(async () => {
    await waitFor(100);
    throw new Error('cccc');
  });

  try {
    await request(
      {
        body: 'quan1',
        onHeader,
        onBody,
      },
      connect(port),
    );
    throw new Error('xxxx');
  } catch (error) {
    assert.equal(error.message, 'cccc');
    assert.equal(onBody.mock.calls.length, 0);
  }
  server.close();
  await waitFor(100);
  assert.equal(
    handleCloseOnSocket.mock.calls.length,
    1,
  );
});

test('request onStartLine trigger error', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write(encodeHttp({
        headers: {
          server: 'quan',
        },
        body: 'ok',
      }));
    }, 50);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const onIncoming = mock.fn(() => {
  });
  const onStartLine = mock.fn(async () => {
    await waitFor(300);
    throw new Error('bbbb');
  });
  const onHeader = mock.fn(() => {
  });
  try {
    await request(
      {
        body: 'quan1',
        headers: { name: 'aaa' },
        onStartLine,
        onIncoming,
        onHeader,
      },
      connect(port),
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.message, 'bbbb');
  }
  await waitFor(500);
  assert.equal(onStartLine.mock.calls.length, 1);
  assert.equal(onIncoming.mock.calls.length, 1);
  assert.equal(onHeader.mock.calls.length, 0);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);

  server.close();
});

test('request onBody trigger error', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write('HTTP/1.1 200 OK\r\nServer: quan\r\nContent-Length: 6\r\n\r\n11');
    }, 50);
    setTimeout(() => {
      socket.write('22');
    }, 100);
    setTimeout(() => {
      socket.write('33');
    }, 150);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onBody = mock.fn((chunk) => {
    if (chunk.toString() === '22') {
      throw new Error('cccc');
    }
  });

  try {
    await request(
      {
        onBody,
      },
      connect(port),
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.message, 'cccc');
  }
  server.close();
  assert.equal(onBody.mock.calls.length, 2);
  await waitFor(100);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});

test('request onBody with stream', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write('HTTP/1.1 200 OK\r\nServer: quan\r\nContent-Length: 6\r\n\r\n11');
    }, 50);
    setTimeout(() => {
      socket.write('22');
    }, 100);
    setTimeout(() => {
      socket.write('33');
    }, 150);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onBody = new PassThrough();
  const onHeader = mock.fn(() => {
    assert(onBody.eventNames().includes('drain'));
    assert(onBody.eventNames().includes('close'));
  });
  const ret = await request(
    {
      onBody,
      onHeader,
    },
    connect(port),
  );
  assert.equal(ret.body.toString(), '');
  const bufList = [];
  onBody.on('data', (chunk) => {
    bufList.push(chunk);
  });
  setTimeout(() => {
    assert.equal(Buffer.concat(bufList).toString(), '112233');
  }, 200);
  assert(!onBody.destroyed);
  assert(!onBody.eventNames().includes('drain'));
  assert(!onBody.eventNames().includes('close'));
  server.close();
  await waitFor(100);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});
