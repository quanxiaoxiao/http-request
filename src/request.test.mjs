import assert from 'node:assert';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import { test, mock } from 'node:test';
import _ from 'lodash';
import { waitFor } from '@quanxiaoxiao/utils';
import {
  encodeHttp,
  decodeHttpRequest,
  DecodeHttpError,
} from '@quanxiaoxiao/http-utils';
import getSocketConnect from './getSocketConnect.mjs';
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

test('request signal aborted',  () => {
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

test('request socket unable connect 1',  async () => {
  const port = getPort();
  try {
    await request(
      {
        path: '/aaa',
      },
      () => {
        const socket = net.Socket();
        socket.connect({
          host: '127.0.0.1',
          port,
        });
        return socket;
      },
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.isConnect, false);
  }
});

test('request socket unable connect 2',  async () => {
  try {
    await request(
      {
        path: '/aaa',
      },
      () => getSocketConnect({ port: 9989 }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.isConnect, false);
  }
  await waitFor();
});

test('request',  async () => {
  const port = getPort();

  const handleDataOnSocket = mock.fn(() => {});

  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write(encodeHttp({
        statusCode: 204,
        headers: { server: 'quan' },
        body: null,
      }));
    }, 80);
  });

  server.listen(port);

  const controller = new AbortController();

  const ret = await request(
    {
      signal: controller.signal,
    },
    () => getSocketConnect({ port })
  );
  assert(!controller.signal.aborted);
  assert.equal(ret.statusCode, 204);
  await waitFor(100);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
});

test('request onBody with stream, response with empty',  async () => {
  const port = getPort();

  const handleDataOnSocket = mock.fn(() => {});

  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write(encodeHttp({
        statusCode: 204,
        headers: { server: 'quan' },
        body: null,
      }));
    }, 80);
  });

  server.listen(port);

  const onBody = new PassThrough();

  const ret = await request(
    {
      onBody,
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 204);
  await waitFor(100);
  assert(onBody.destroyed);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
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
    await request({}, () => getSocketConnect({ port }));
    throw new Error('xxx');
  } catch (error) {
    assert(error.isConnect);
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
    await request({}, () => getSocketConnect({ port }));
    throw new Error('xxx');
  } catch (error) {
    assert(error.isConnect);
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
      () => getSocketConnect({ port }),
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
    assert.equal(state.body, null);
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
  const onChunkIncoming = mock.fn((chunk) => {
    assert.equal(chunk.toString(), 'HTTP/1.1 200 OK\r\nserver: quan\r\nContent-Length: 2\r\n\r\nok');
  });
  const onChunkOutgoing = mock.fn((chunk) => {
    assert.equal(onChunkIncoming.mock.calls.length, 0);
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
      onChunkOutgoing,
      onChunkIncoming,
    },
    () => getSocketConnect({ port }),
  );
  server.close();
  assert.equal(ret.body.toString(), 'ok');
  assert.deepEqual(ret.headers, { server: 'quan', 'content-length': 2 });
  assert.deepEqual(ret.headersRaw, ['server', 'quan', 'Content-Length', '2']);
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.bytesResponseBody, 2);
  assert.equal(ret.bytesRequestBody, 5);
  await waitFor(100);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
  assert.equal(onStartLine.mock.calls.length, 1);
  assert.equal(onHeader.mock.calls.length, 1);
  assert.equal(onChunkIncoming.mock.calls.length, 1);
  assert.equal(onChunkOutgoing.mock.calls.length, 1);
});

test('request by response too early', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const onStartLine = mock.fn(() => {});
  const onChunkIncoming = mock.fn(() => {});
  const onChunkOutgoing = mock.fn(() => {});

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

  const ret = await request(
    {
      body: 'quan1',
      headers: { name: 'aaa' },
      onRequest: async () => {
        await waitFor(300);
        assert.equal(handleCloseOnSocket.mock.calls.length, 0);
      },
      onStartLine,
      onChunkIncoming,
      onChunkOutgoing,
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 200);
  assert.equal(ret.body.toString(), 'ok');
  await waitFor(500);
  server.close();
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
  assert.equal(onStartLine.mock.calls.length, 1);
  assert.equal(onChunkIncoming.mock.calls.length, 1);
  assert.equal(onChunkOutgoing.mock.calls.length, 1);
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
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.body, null);
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
      () => getSocketConnect({ port }),
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
  const controller = new AbortController();
  const onChunkIncoming = mock.fn(() => {
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
        signal: controller.signal,
        onStartLine,
        onChunkIncoming,
        onHeader,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.message, 'bbbb');
  }
  await waitFor(500);
  assert(!controller.signal.aborted);
  assert.equal(onStartLine.mock.calls.length, 1);
  assert.equal(onChunkIncoming.mock.calls.length, 1);
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
      () => getSocketConnect({ port }),
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

  const bufList = [];
  const onBody = new PassThrough();
  onBody.on('data', (chunk) => {
    bufList.push(chunk);
  });
  const onHeader = mock.fn(() => {
    assert(onBody.eventNames().includes('drain'));
    assert(onBody.eventNames().includes('close'));
  });
  const ret = await request(
    {
      onBody,
      onHeader,
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.body, null);
  assert(onBody.destroyed);
  assert(!onBody.eventNames().includes('close'));
  assert(!onBody.eventNames().includes('drain'));
  server.close();
  await waitFor(1000);
  assert.equal(Buffer.concat(bufList).toString(), '112233');
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});

test('request onBody with stream close', async () => {
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
      assert(socket.destroyed);
    }, 200);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onBody = new PassThrough();

  setTimeout(() => {
    assert(!onBody.destroyed);
    onBody.destroy();
  }, 150);

  try {
    await request(
      {
        onBody,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxxx');
  } catch (error) {
    assert(error.isConnect);
  }
  assert(onBody.destroyed);
  server.close();
  await waitFor(100);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});

test('request onBody with stream, at onHeader trigger error', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write('HTTP/1.1 200 OK\r\nServer: quan\r\nContent-Length: 6\r\n\r\n11');
    }, 50);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onBody = new PassThrough();
  const onHeader = mock.fn(() => {
    assert(onBody.eventNames().includes('drain'));
    assert(onBody.eventNames().includes('close'));
    throw new Error('sss');
  });

  try {
    await request(
      {
        onHeader,
        onBody,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxxx');
  } catch (error) {
    assert.equal(error.message, 'sss');
  }
  assert(onHeader.mock.calls.length, 1);
  assert(!onBody.eventNames().includes('drain'));
  assert(!onBody.eventNames().includes('close'));
  server.close();
  await waitFor(100);
  assert(onBody.destroyed);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});

test('request signal', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write('HTTP/1.1 200 OK\r\nServer: quan\r\nContent-Length: 6\r\n\r\n112233');
    }, 50);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const controller = new AbortController();
  const onHeader = mock.fn(() => {
  });
  const onStartLine = mock.fn(() => {
    assert(!controller.signal.aborted);
    controller.abort();
  });
  try {
    await request(
      {
        onHeader,
        onStartLine,
        signal: controller.signal,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxxx');
  } catch (error) {
    assert.equal(error.message, 'abort');
  }
  assert.equal(onStartLine.mock.calls.length, 1);
  assert.equal(onHeader.mock.calls.length, 0);
  server.close();
  await waitFor(100);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});

test('request outgoing trigger error',  async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const onChunkOutgoing = mock.fn(() => {
    throw new Error('cccccc');
  });
  try {
    await request(
      {
        onChunkOutgoing,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxxx');
  } catch (error) {
    assert.equal(error.message, 'cccccc');
  }
  await waitFor(200);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 0);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});

test('request body with stream', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const count = 30;
  const content = 'aabbcc';
  const server = net.createServer((socket) => {
    const decode = decodeHttpRequest();
    socket.on('data', (chunk) => {
      decode(chunk).then((ret) => {
        if (ret.complete) {
          assert.equal(ret.path, '/abc');
          assert.equal(ret.method, 'POST');
          assert.deepEqual(ret.headers, { 'transfer-encoding': 'chunked' });
          assert.equal(
            ret.body.toString(),
            _.times(count).map((i) => `${content}:${i}`).join(''),
          );
          socket.write(encodeHttp({
            headers: {
              server: 'quan',
            },
            body: 'ok',
          }));
        }
      });
    });
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const body = new PassThrough();
  let i = 0;
  const tick = setInterval(() => {
    body.write(Buffer.from(`${content}:${i}`));
    i++;
    if (i >= count) {
      clearInterval(tick);
      if (!body.writableEnded) {
        body.end();
      }
    }
  }, 10);
  const ret = await request(
    {
      path: '/abc',
      method: 'POST',
      body,
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 200);
  assert(body.destroyed);
  await waitFor(200);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  server.close();
});

test('request body with stream, before send is closed', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onRequest = mock.fn((options) => {
    assert(options.body.readable);
    options.body.destroy();
    assert(!options.body.readable);
  });

  try {
    const body = new PassThrough();
    await request(
      {
        onRequest,
        body,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert(error.isConnect);
  }

  await waitFor(100);
  server.close();
  assert.equal(onRequest.mock.calls.length, 1);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
});

test('request body with stream, stream by close', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onRequest = mock.fn((options) => {
    assert(!options.body.eventNames().includes('end'));
    assert(!options.body.eventNames().includes('data'));
    setTimeout(() => {
      options.body.write(Buffer.from('aa'));
      assert(options.body.eventNames().includes('end'));
      assert(options.body.eventNames().includes('data'));
    }, 20);
    setTimeout(() => {
      options.body.destroy();
    }, 50);
  });

  const body = new PassThrough();
  try {
    await request(
      {
        onRequest,
        body,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert(error.isConnect);
    assert(!body.eventNames().includes('end'));
    assert(!body.eventNames().includes('data'));
  }

  await waitFor(100);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 2);
  assert.equal(handleDataOnSocket.mock.calls[1].arguments[0].toString(), '2\r\naa\r\n');
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
});

test('request body with stream, stream trigger error', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onRequest = mock.fn((options) => {
    assert(!options.body.eventNames().includes('end'));
    assert(!options.body.eventNames().includes('data'));
    setTimeout(() => {
      options.body.write(Buffer.from('aa'));
      assert(options.body.eventNames().includes('end'));
      assert(options.body.eventNames().includes('data'));
    }, 20);
    setTimeout(() => {
      options.body.emit('error', new Error('aaaaaa'));
    }, 50);
  });

  const body = new PassThrough();
  try {
    await request(
      {
        onRequest,
        body,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.message, 'aaaaaa');
  }

  await waitFor(100);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 2);
  assert.equal(handleDataOnSocket.mock.calls[1].arguments[0].toString(), '2\r\naa\r\n');
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
});

test('request request options invalid', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onRequest = mock.fn((options) => {
    assert.deepEqual(options.headers, { name: 'aa' });
    options.headers = ['name', 'bb', 'good'];
  });

  try {
    await request(
      {
        headers: {
          name: 'aa',
        },
        onRequest,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
  }

  await waitFor(100);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 0);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
});

test('request request options invalid 2', async () => {
  const port = getPort();
  const handleDataOnSocket = mock.fn(() => {});
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const onRequest = mock.fn((options) => {
    assert.deepEqual(options.headers, { name: 'aa' });
    options.headers = ['name', 'bb', 'good'];
  });

  try {
    const body = new PassThrough();
    await request(
      {
        headers: {
          name: 'aa',
        },
        body,
        onRequest,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert(error instanceof assert.AssertionError);
  }

  await waitFor(100);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 0);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  assert.equal(onRequest.mock.calls.length, 1);
});

test('request body stream', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    const decode = decodeHttpRequest();
    socket.on('data', (chunk) => {
      decode(chunk).then((ret) => {
        if (ret.complete) {
          socket.write(encodeHttp({
            headers: {
              server: 'quan',
            },
            body: 'ok',
          }));
        }
      });
    });
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const content = 'aaabbbccc';
  const body = new PassThrough();
  let i = 0;
  let isPause = false;
  const onRequest = mock.fn(() => {
    setTimeout(() => {
      assert(!body.isPaused());
      body.once('pause', () => {
        isPause = true;
      });
      body.once('resume', () => {
        setTimeout(() => {
          body.end();
        }, 10);
      });
      while (!isPause) {
        body.write(`${_.times(1000).map(() => content).join('')}:${i}`);
        i++;
      }
    }, 10);
  });
  await request(
    {
      headers: {
        name: 'aa',
      },
      onRequest,
      body,
    },
    () => getSocketConnect({ port }),
  );
  await waitFor(100);
  assert(!body.eventNames().includes('pause'));
  assert(!body.eventNames().includes('resume'));
  assert.equal(onRequest.mock.calls.length, 1);
  server.close();
});

test('request remote socket close, stream body unbind events', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    socket.on('close', handleCloseOnSocket);
    setTimeout(() => {
      socket.destroy();
    }, 100);
  });
  server.listen(port);
  const body = new PassThrough();
  const onRequest = mock.fn(() => {
    setTimeout(() => {
      assert(body.eventNames().includes('end'));
      assert(body.eventNames().includes('data'));
      assert(body.eventNames().includes('error'));
      assert(body.eventNames().includes('close'));
    }, 10);
  });
  try {
    await request(
      {
        headers: {
          name: 'aa',
        },
        onRequest,
        body,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxxx');
  } catch (error) {
    assert(error.isConnect);
  }
  assert(!body.eventNames().includes('end'));
  assert(!body.eventNames().includes('data'));
  assert(!body.eventNames().includes('close'));
  await waitFor(1000);
  assert(!body.eventNames().includes('error'));
  server.close();
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});

test('request remote socket close, stream body unbind events 2', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);
  const controller = new AbortController();
  const body = new PassThrough();
  const onRequest = mock.fn(() => {
    setTimeout(() => {
      assert(body.eventNames().includes('end'));
      assert(body.eventNames().includes('data'));
      assert(body.eventNames().includes('error'));
      assert(body.eventNames().includes('close'));
      controller.abort();
    }, 10);
  });
  try {
    await request(
      {
        headers: {
          name: 'aa',
        },
        signal: controller.signal,
        onRequest,
        body,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxxx');
  } catch (error) {
    assert.equal(error.message, 'abort');
  }
  assert(!body.eventNames().includes('end'));
  assert(!body.eventNames().includes('data'));
  assert(!body.eventNames().includes('close'));
  await waitFor(1000);
  assert(!body.eventNames().includes('error'));
  server.close();
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
});

test('request onBody with stream', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const content = 'aabbccddeee';
  const server = net.createServer((socket) => {
    const encode = encodeHttp({
      headers: {
        name: 'quan',
      },
    });
    socket.on('data', () => {});
    let i = 0;
    setTimeout(() => {
      while (i < 1000) {
        socket.write(encode(Buffer.from(`${_.times(1000).map(() => content).join('')}:${i}`)));
        i++;
      }
      socket.write(encode());
    }, 20);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  const filename = `test_${Date.now()}_1`;
  const pathname = path.resolve(process.cwd(), filename);
  const onBody = fs.createWriteStream(pathname);

  const onRequest = mock.fn(() => {
    assert(onBody.eventNames().includes('drain'));
    assert(onBody.eventNames().includes('close'));
  });

  const ret = await request(
    {
      path: '/aaaaa',
      headers: {
        name: 'aa',
      },
      body: null,
      onRequest,
      onBody,
    },
    () => getSocketConnect({ port }),
  );

  server.close();

  assert.equal(ret.body, null);
  assert(!onBody.eventNames().includes('drain'));
  assert(!onBody.eventNames().includes('close'));
  await waitFor(100);
  assert(onBody.destroyed);
  assert(!onBody.writable);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  const buf = fs.readFileSync(pathname);
  assert(/:999$/.test(buf.toString()));
  fs.unlinkSync(pathname);
});

test('request onBody with stream close', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const content = 'aabbccddeee';
  const filename = `test_${Date.now()}_222`;
  const pathname = path.resolve(process.cwd(), filename);
  const onBody = fs.createWriteStream(pathname);
  let isClose = false;
  const server = net.createServer((socket) => {
    const encode = encodeHttp({
      headers: {
        name: 'quan',
      },
    });
    socket.on('data', () => {});
    setTimeout(() => {
      let i = 0;
      const tick = setInterval(() => {
        socket.write(encode(Buffer.from(`${_.times(1000).map(() => content).join('')}:${i}`)));
        i++;
        if (isClose) {
          clearInterval(tick);
          setTimeout(() => {
            socket.destroy();
          }, 100);
        }
      });
    }, 50);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  let i = 0;

  const handleDrain = () => {
    i++;
    if (i >= 12) {
      onBody.off('drain', handleDrain);
      isClose = true;
    }
  };

  onBody.on('drain', handleDrain);

  try {
    await request(
      {
        path: '/aaaaa',
        headers: {
          name: 'aa',
        },
        body: null,
        onBody,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert(isClose);
    assert.equal(error.isConnect, true);
  }

  server.close();

  assert(!onBody.eventNames().includes('drain'));
  assert(!onBody.eventNames().includes('close'));
  await waitFor(1000);
  assert(!onBody.eventNames().includes('error'));
  assert(onBody.destroyed);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  fs.unlinkSync(pathname);
});

test('request onBody with stream close 2', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const content = 'aabbccddeee';
  const filename = `test_${Date.now()}_3`;
  const pathname = path.resolve(process.cwd(), filename);
  const onBody = fs.createWriteStream(pathname);
  let isClose = false;
  const server = net.createServer((socket) => {
    const encode = encodeHttp({
      headers: {
        name: 'quan',
      },
    });
    socket.on('data', () => {});
    socket.on('error', () => {});
    setTimeout(() => {
      let i = 0;
      const tick = setInterval(() => {
        i++;
        if (isClose) {
          clearInterval(tick);
        } else {
          socket.write(encode(Buffer.from(`${_.times(1000).map(() => content).join('')}:${i}`)));
        }
      });
    }, 20);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  let i = 0;

  const handleDrain = () => {
    i++;
    if (i >= 50) {
      onBody.off('drain', handleDrain);
      isClose = true;
      assert(!onBody.destroyed);
      onBody.destroy();
    }
  };

  // onBody.on('error', () => {});

  onBody.on('drain', handleDrain);

  try {
    await request(
      {
        path: '/aaaaa',
        headers: {
          name: 'aa',
        },
        body: null,
        onBody,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert(error.message !== 'xxx');
    assert(isClose);
  }

  server.close();

  assert(!onBody.eventNames().includes('drain'));
  assert(!onBody.eventNames().includes('close'));
  await waitFor(100);
  assert(onBody.destroyed);
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  fs.unlinkSync(pathname);
});

test('request onEnd', async () => {
  const port = getPort();

  const handleDataOnSocket = mock.fn(() => {});

  const server = net.createServer((socket) => {
    socket.on('data', handleDataOnSocket);
    setTimeout(() => {
      socket.write(encodeHttp({
        headers: { server: 'quan' },
        body: 'aaa',
      }));
    }, 80);
  });

  server.listen(port);

  const onEnd = mock.fn(() => {});

  const ret = await request(
    {
      onEnd,
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(onEnd.mock.calls.length, 1);
  assert.deepEqual(onEnd.mock.calls[0].arguments[0], ret);
  await waitFor(100);
  server.close();
  assert.equal(handleDataOnSocket.mock.calls.length, 1);
});

test('request onBody with stream by signal', async () => {
  const port = getPort();
  const handleCloseOnSocket = mock.fn(() => {});
  const content = 'aabbccddeee';
  const filename = `test_${Date.now()}_3`;
  const pathname = path.resolve(process.cwd(), filename);
  const onBody = fs.createWriteStream(pathname);
  const controller = new AbortController();
  const server = net.createServer((socket) => {
    const encode = encodeHttp({
      headers: {
        name: 'quan',
      },
    });
    socket.on('error', () => {});
    socket.on('data', () => {});
    setTimeout(() => {
      let i = 0;
      const tick = setInterval(() => {
        i++;
        if (controller.signal.aborted) {
          clearInterval(tick);
        } else {
          socket.write(encode(Buffer.from(`${_.times(1000).map(() => content).join('')}:${i}`)));
        }
      });
    }, 20);
    socket.on('close', handleCloseOnSocket);
  });
  server.listen(port);

  let i = 0;

  const handleDrain = () => {
    i++;
    if (i >= 50) {
      onBody.off('drain', handleDrain);
      assert(!onBody.destroyed);
      controller.abort();
    }
  };

  onBody.on('drain', handleDrain);

  try {
    await request(
      {
        path: '/aaaaa',
        headers: {
          name: 'aa',
        },
        signal: controller.signal,
        body: null,
        onBody,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxx');
  } catch (error) {
    assert.equal(error.message, 'abort');
  }

  server.close();

  assert(!onBody.eventNames().includes('drain'));
  assert(!onBody.eventNames().includes('close'));
  await waitFor(100);
  assert(onBody.destroyed);
  assert(controller.signal.aborted);
  onBody.end();
  assert.equal(handleCloseOnSocket.mock.calls.length, 1);
  await waitFor(10);
  fs.unlinkSync(pathname);
});

test('request onBody stream no resume, but socket is close', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.end(encodeHttp({
        headers: { server: 'quan' },
        body: 'aaa',
      }));
    }, 80);
  });

  server.listen(port);
  const onBody = new PassThrough();
  const onEnd = mock.fn(() => {
    onBody.on('data', () => {});
  });
  await request(
    {
      path: '/aaaaa',
      headers: {
        name: 'aa',
      },
      body: null,
      onBody,
      onEnd,
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(onEnd.mock.calls.length, 1);
  await waitFor(200);
  server.close();
});

test('request response chunk invalid', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.end(encodeHttp({
        method: 'POST',
        path: '/aaaa',
        headers: { server: 'quan' },
        body: 'aaa',
      }));
    }, 80);
  });

  server.listen(port);
  await waitFor(100);
  try {
    await request(
      {
        path: '/aaaaa',
        headers: {
          name: 'aa',
        },
        body: null,
      },
      () => getSocketConnect({ port }),
    );
    throw new Error('xxxxx');
  } catch (error) {
    assert(error instanceof DecodeHttpError);
  }
  await waitFor(200);
  server.close();
});

test('request response with stream', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.write(`HTTP/1.1 200 OK\r\nServer: quan\r\n\r\naaaa`);
    }, 100);
    setTimeout(() => {
      socket.write('bbbb');
    }, 200);
    setTimeout(() => {
      socket.write('cccc');
    }, 300);
    setTimeout(() => {
      socket.end();
    }, 500);
  });

  server.listen(port);
  await waitFor(100);
  const onBody = new PassThrough();
  const onData = mock.fn(() => {});
  onBody.on('data', onData);
  request(
    {
      path: '/aaaaa',
      headers: {
        name: 'aa',
      },
      body: null,
      onBody,
    },
    () => getSocketConnect({ port }),
  );
  await waitFor(1000);
  assert(onBody.writableEnded);
  assert.equal(onData.mock.calls.length, 3);
  assert.equal(onData.mock.calls[0].arguments[0].toString(), 'aaaa');
  assert.equal(onData.mock.calls[1].arguments[0].toString(), 'bbbb');
  assert.equal(onData.mock.calls[2].arguments[0].toString(), 'cccc');
  server.close();
});

test('request request body stream backpress', async () => {
  const port = getPort();
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_eadsfebcsww_7878`);
  const ws = fs.createWriteStream(pathname);
  const server = net.createServer((socket) => {
    ws.on('drain', () => {
      if (socket.isPaused()) {
        socket.resume();
      }
    });
    const decode = decodeHttpRequest({
      onBody: (chunk) => {
        const ret = ws.write(chunk);
        if (!ret) {
          socket.pause();
        }
      },
      onEnd: () => {
        socket.write(encodeHttp({
          statusCode: 200,
          headers: {
            name: 'foo',
          },
          body: 'aaaccc',
        }));
        ws.end();
      },
    });
    socket.on('data', (chunk) => {
      decode(chunk);
    });
  });
  server.listen(port);
  await waitFor(100);
  const requestBodyStream = new PassThrough();
  let isPaused = false;
  let i = 0;
  const count = 3000;
  const content = 'aaaaabbbbbbbbcccccccddddd___adfw';
  const walk = () => {
    while (!isPaused && i < count) {
      const s = `${_.times(800).map(() => content).join('')}:${i}`;
      const ret = requestBodyStream.write(s);
      if (ret === false) {
        isPaused = true;
      }
      i++;
    }
    if (i >= count && !requestBodyStream.writableEnded) {
      setTimeout(() => {
        if (!requestBodyStream.writableEnded) {
          requestBodyStream.end();
        }
      }, 500);
    }
  };
  const handleDrain = mock.fn(() => {
    isPaused = false;
    walk();
  });
  requestBodyStream.on('drain', handleDrain);
  const ret = await request(
    {
      path: '/aaa',
      onRequest: () => {
        setTimeout(() => {
          walk();
        }, 10);
      },
      body: requestBodyStream,
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 200);
  assert.deepEqual(ret.headers, { name: 'foo', 'content-length': 6 });
  assert(ws.writableEnded);
  assert(handleDrain.mock.calls.length > 1);
  const buf = fs.readFileSync(pathname);
  assert(new RegExp(`:${count - 1}$`).test(buf.toString()));
  fs.unlinkSync(pathname);
  server.close();
});

test('request response body stream backpress', async () => {
  const port = getPort();
  let isPaused = false;
  let i = 0;
  let isEnd = false;
  const count = 3000;
  const content = 'aaaaabbbbbbbbcccccccddddd___adfw';
  const pathname = path.resolve(process.cwd(), `test_${Date.now()}_iiwqw_7878`);
  const ws = fs.createWriteStream(pathname);
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    const encode = encodeHttp({
      headers: {
        server: 'quan',
      },
    });
    const walk = () => {
      while (!isPaused && i < count) {
        const s = `${_.times(800).map(() => content).join('')}:${i}`;
        const ret = socket.write(encode(s));
        if (ret === false) {
          isPaused = true;
        }
        i++;
      }
      if (i >= count && !isEnd) {
        setTimeout(() => {
          if (!isEnd) {
            isEnd = true;
            socket.write(encode());
          }
        }, 500);
      }
    };
    socket.on('drain', () => {
      isPaused = false;
      walk();
    });
    setTimeout(() => {
      walk();
    }, 100);
  });
  server.listen(port);
  await waitFor(100);
  const responseBodyStream = new PassThrough();
  responseBodyStream.pipe(ws);
  const ret = await request(
    {
      path: '/aaaaa',
      headers: {
        name: 'aa',
      },
      body: null,
      onBody: responseBodyStream,
    },
    () => getSocketConnect({ port }),
  );
  assert.equal(ret.statusCode, 200);
  assert.deepEqual(ret.headers, {  server: 'quan', 'transfer-encoding': 'chunked' });
  const buf = fs.readFileSync(pathname);
  assert(new RegExp(`:${count - 1}$`).test(buf.toString()));
  fs.unlinkSync(pathname);
  server.close();
});

test('request response 500', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.write('HTTP/1.1 500\r\nServer: quan\r\n\r\n');
    }, 80);
  });
  server.listen(port);
  await waitFor(100);
  const onBody = new PassThrough();
  const ret = await request(
    {
      onBody,
    },
    () => getSocketConnect({ port }),
  );
  assert.deepEqual(ret.headers, { server: 'quan', 'content-length': 0});
  await waitFor(200);
  assert.equal(onBody.destroyed, true);
  server.close();
});

test('request response 500', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.write('HTTP/1.1 500\r\nServer: quan\r\n\r\n');
    }, 80);
  });
  server.listen(port);
  await waitFor(100);
  const ret = await request(
    {
    },
    () => getSocketConnect({ port }),
  );
  assert.deepEqual(ret.headers, { server: 'quan', 'content-length': 0});
  server.close();
});

test('request onStartLine trigger error 11', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.write('HTTP/1.1 404\r\nServer: quan\r\nContent-Length: 4\r\n\r\naaaa');
    }, 80);
  });
  server.listen(port);
  await waitFor(100);
  const handleDataOnBody = mock.fn(() => {});
  const onBody = new PassThrough();
  onBody.on('data', handleDataOnBody);
  const onStartLine = mock.fn(() => {
    assert(!onBody.destroyed);
    throw new Error('xxxx');
  });
  try {
    await request(
      {
        onBody,
        onStartLine,
      },
      () => getSocketConnect({ port }),
    );
  } catch (error) {
    assert(error.message, 'xxxx');
  }
  assert(onBody.destroyed);
  assert(onStartLine.mock.calls.length, 1);
  await waitFor(100);
  assert.equal(handleDataOnBody.mock.calls.length, 0);
  server.close();
});

test('request response 111', async () => {
  const port = getPort();
  const server = net.createServer((socket) => {
    socket.on('data', () => {});
    setTimeout(() => {
      socket.write('HTTP/1.1 404\r\nServer: quan\r\nContent-Length: 0\r\n\r\n');
    }, 80);
  });
  server.listen(port);
  await waitFor(100);
  const pass = new PassThrough();
  pass.write('aaa');
  const onChunkOutgoing = mock.fn();
  const now = Date.now();
  const response = await request(
    {
      onChunkOutgoing,
      path: '/aa/bb',
      headers: {
        'content-length': 8,
      },
      body: pass,
    },
    () => getSocketConnect({ port }),
  );
  assert(!pass.readableEnded);
  assert(Date.now() - now <= 110);
  assert.equal(response.statusCode, 404);
  assert.equal(onChunkOutgoing.mock.calls.length, 2);
  assert.equal(
    Buffer.concat(onChunkOutgoing.mock.calls.map((d) => d.arguments[0])).toString(),
    'GET /aa/bb HTTP/1.1\r\nContent-Length: 8\r\n\r\naaa',
  );
  server.close();
});
