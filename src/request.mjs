import assert from 'node:assert';
import { Buffer } from 'node:buffer';
import net from 'node:net';
import process from 'node:process';
import { Readable, Writable } from 'node:stream';
import tls from 'node:tls';

import {
  convertObjectToArray,
  decodeHttpResponse,
  encodeHttp,
  getHeaderValue,
  isHttpStream,
  setHeaders,
} from '@quanxiaoxiao/http-utils';
import {
  wrapStreamRead,
  wrapStreamWrite,
} from '@quanxiaoxiao/node-utils';
import { createConnector } from '@quanxiaoxiao/socket';
import { waitTick } from '@quanxiaoxiao/utils';

import {
  DoAbortError,
  HttpResponseTimeoutError,
  SocketCloseError,
  SocketConnectionTimeoutError,
} from './errors.mjs';
import getSocketConnect from './getSocketConnect.mjs';

export default (
  options,
  getConnect,
) => {
  const {
    signal,
    onRequest,
    onRequestEnd,
    onConnect,
    onStartLine,
    onHeader,
    onEnd,
    onBody,
    onChunkOutgoing,
    onChunkIncoming,
    keepAlive,
    timeoutResponse,
  } = options;

  if (signal) {
    assert(!signal.aborted);
  }

  const socket = typeof getConnect === 'function' ? getConnect() : getSocketConnect(getConnect);
  assert(socket && socket instanceof net.Socket);

  if (onBody) {
    assert(typeof onBody === 'function' || onBody instanceof Writable);
  }

  const controller = new AbortController();

  return new Promise((resolve, reject) => {
    const state = {
      connector: null,
      bytesIncoming: 0,
      bytesOutgoing: 0,
      decode: null,

      isEventSignalBind: false,
      isConnectClose: false,
      isResponseEndEmit: false,

      dateTime: Date.now(),
      timeOnStart: performance.now(),
      timeOnConnect: null,
      timeOnSecureConnect: null,
      timeOnRequestSend: null,
      timeOnRequestEnd: null,
      timeOnResponse: null,
      timeOnResponseStartLine: null,
      timeOnResponseHeader: null,
      timeOnResponseBody: null,
      timeOnResponseEnd: null,
      timeOnLastIncoming: null,
      timeOnLastOutgoing: null,

      request: {
        path: options.path || '/',
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body ?? null,
        _headers: [],
        bytesBody: 0,
        ...Object.hasOwnProperty.call(options, 'data') ? { data: options.data } : {},
      },

      response: {
        body: null,
        statusCode: null,
        httpVersion: null,
        statusText: null,
        bytesBody: 0,
        headers: {},
        headersRaw: [],
      },
    };

    const tickWaitWithResponse = timeoutResponse != null
      ? waitTick(timeoutResponse, () => {
        if (state.timeOnResponseStartLine == null) {
          emitError(new HttpResponseTimeoutError(getConnect)); // eslint-disable-line no-use-before-define
        }
      })
      : () => {};

    function calcTime() {
      return performance.now() - state.timeOnStart;
    }

    function unbindSignalEvent() {
      if (state.isEventSignalBind) {
        state.isEventSignalBind = false;
        signal.removeEventListener('abort', handleAbortOnSignal); // eslint-disable-line no-use-before-define
      }
    }

    function emitError(error) {
      unbindSignalEvent();
      tickWaitWithResponse();
      if (!controller.signal.aborted) {
        controller.abort();
        const errObj = typeof error === 'string' ? new Error(error) : error;
        errObj.isConnect = state.timeOnConnect != null;
        errObj.state = getState(); // eslint-disable-line no-use-before-define
        reject(errObj);
      }
    }

    function doChunkOutgoing(chunk) {
      const size = chunk.length;
      if (size > 0) {
        try {
          state.bytesOutgoing += size;
          if (onChunkOutgoing) {
            onChunkOutgoing(chunk);
          }
          const ret = state.connector.write(chunk);
          state.timeOnLastOutgoing = calcTime();
          if (ret === false
            && state.request.body instanceof Readable
            && !state.request.body.isPaused()
          ) {
            state.request.body.pause();
          }
        } catch (error) {
          emitError(error);
        }
      }
    }

    function emitResponseEnd() {
      unbindSignalEvent();
      if (!state.isResponseEndEmit) {
        state.isResponseEndEmit = true;
        if (!controller.signal.aborted) {
          resolve(getState()); // eslint-disable-line no-use-before-define
        }
        if (!state.isConnectClose) {
          if (keepAlive) {
            state.connector.detach();
          } else {
            try {
              state.connector.end();
            } catch (error) { // eslint-disable-line
              // ignore
            }
          }
        }
      }
    }

    function bindResponseDecode() {
      state.decode = decodeHttpResponse({
        onStartLine: async (ret) => {
          state.response.statusCode = ret.statusCode;
          state.response.httpVersion = ret.httpVersion;
          state.response.statusText = ret.statusText;
          state.timeOnResponseStartLine = calcTime();
          tickWaitWithResponse();
          if (onStartLine) {
            await onStartLine(getState()); // eslint-disable-line no-use-before-define
            assert(!controller.signal.aborted);
          }
        },
        onHeader: async (ret) => {
          state.timeOnResponseHeader = calcTime();
          state.response.headers = ret.headers;
          state.response.headersRaw = ret.headersRaw;
          if (onHeader) {
            await onHeader(getState()); // eslint-disable-line no-use-before-define
            assert(!controller.signal.aborted);
          }
          if (isHttpStream(ret.headers)) {
            assert(onBody instanceof Writable);
          }
        },
        onBody: (bodyChunk) => {
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = calcTime();
          }
          state.response.bytesBody += bodyChunk.length;
          if (state.response._write) {
            state.response._write(bodyChunk);
          } else if (onBody) {
            onBody(bodyChunk);
          } else {
            if (state.response.body == null) {
              state.response.body = Buffer.from([]);
            }
            state.response.body = Buffer.concat([
              state.response.body,
              bodyChunk,
            ]);
          }
        },
        onEnd: async () => {
          state.timeOnResponseEnd = calcTime();
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = state.timeOnResponseEnd;
          }
          if (onEnd) {
            await onEnd(getState()); // eslint-disable-line no-use-before-define
            assert(!controller.signal.aborted);
          }
          if (state.response._write) {
            state.response._write(emitResponseEnd);
          } else {
            emitResponseEnd();
          }
        },
      });
    }

    function handleAbortOnSignal() {
      state.isEventSignalBind = false;
      emitError(new DoAbortError());
    }

    function getState() {
      return {
        bytesIncoming: state.bytesIncoming,
        bytesOutgoing: state.bytesOutgoing,
        httpVersion: state.response.httpVersion,
        statusCode: state.response.statusCode,
        statusText: state.response.statusText,
        headersRaw: state.response.headersRaw,
        headers: state.response.headers,
        body: state.response.body,
        bytesRequestBody: state.request.bytesBody,
        bytesResponseBody: state.response.bytesBody,

        dateTime: state.dateTime,
        timeOnLastIncoming: state.timeOnLastIncoming,
        timeOnLastOutgoing: state.timeOnLastOutgoing,
        timeOnConnect: state.timeOnConnect,
        ...socket instanceof tls.TLSSocket ? {
          timeOnSecureConnect: state.timeOnSecureConnect,
        } : {},
        timeOnRequestSend: state.timeOnRequestSend,
        timeOnRequestEnd: state.timeOnRequestEnd,
        timeOnResponse: state.timeOnResponse,
        timeOnResponseStartLine: state.timeOnResponseStartLine,
        timeOnResponseHeader: state.timeOnResponseHeader,
        timeOnResponseBody: state.timeOnResponseBody,
        timeOnResponseEnd: state.timeOnResponseEnd,
      };
    }

    if (state.request.headers) {
      state.request._headers = Array.isArray(state.request.headers)
        ? [...state.request.headers]
        : convertObjectToArray(state.request.headers);
      if (typeof getConnect !== 'function' && !getHeaderValue(state.request._headers, 'host')) {
        state.request._headers.push('Host');
        state.request._headers.push(`${getConnect.hostname || '127.0.0.1'}:${getConnect.port}`);
      }
    }

    if (Object.hasOwnProperty.call(state.request, 'data')) {
      state.request.body = state.request.data == null
        ? null
        : Buffer.from(JSON.stringify(state.request.data));
      if (state.request.body) {
        state.request._headers = setHeaders(state.request._headers, {
          'Content-Type': 'application/json; charset=utf-8',
        });
      }
    }

    if (socket instanceof tls.TLSSocket && socket.readyState === 'opening') {
      socket.once('connect', () => {
        state.timeOnConnect = calcTime();
      });
    }

    state.connector = createConnector(
      {
        onConnect: async () => {
          if (socket instanceof tls.TLSSocket) {
            state.timeOnSecureConnect = calcTime();
          } else {
            state.timeOnConnect = calcTime();
          }
          if (onConnect) {
            await onConnect();
            assert(!controller.signal.aborted);
          }
          if (onRequest) {
            await onRequest(state.request, getState());
            assert(!controller.signal.aborted);
          }
          if (state.request.body instanceof Readable) {
            assert(state.request.body.readable);
            const encodeRequest = encodeHttp({
              path: state.request.path,
              method: state.request.method,
              headers: state.request._headers,
              body: state.request.body,
              onHeader: (chunkRequestHeaders) => {
                if (!controller.signal.aborted) {
                  doChunkOutgoing(chunkRequestHeaders);
                  state.timeOnRequestSend = calcTime();
                }
              },
            });

            process.nextTick(() => {
              if (!controller.signal.aborted) {
                try {
                  wrapStreamRead({
                    stream: state.request.body,
                    signal: controller.signal,
                    onData: (chunk) => {
                      state.request.bytesBody += chunk.length;
                      const buf = encodeRequest(chunk);
                      if (state.response.statusCode == null) {
                        doChunkOutgoing(buf);
                      }
                    },
                    onEnd: () => {
                      state.timeOnRequestEnd = calcTime();
                      if (state.response.statusCode == null) {
                        doChunkOutgoing(encodeRequest());
                      }
                      if (onRequestEnd) {
                        onRequestEnd(getState());
                      }
                    },
                    onError: (error) => {
                      emitError(error);
                    },
                  });
                  setTimeout(() => {
                    if (state.request.body.isPaused()) {
                      state.request.body.resume();
                    }
                  });
                } catch (error) {
                  emitError(error);
                }
              }
            });
          } else {
            if (state.request.body != null) {
              assert(Buffer.isBuffer(state.request.body) || typeof state.request.body === 'string');
              state.request.bytesBody = Buffer.byteLength(state.request.body);
            }
            doChunkOutgoing(encodeHttp({
              ...state.request,
              headers: state.request._headers,
            }));
            state.timeOnRequestSend = calcTime();
            state.timeOnRequestEnd = state.timeOnRequestSend;
            if (onRequestEnd) {
              await onRequestEnd(getState());
            }
          }
        },
        onData: (chunk) => {
          assert(!controller.signal.aborted);
          assert(state.timeOnRequestSend != null);
          const size = chunk.length;
          state.bytesIncoming += size;
          state.timeOnLastIncoming = calcTime();
          if (!state.decode) {
            state.timeOnResponse = state.timeOnLastIncoming;
            bindResponseDecode();
          }
          if (size > 0) {
            if (onChunkIncoming) {
              onChunkIncoming(chunk);
            }
            state.decode(chunk)
              .then(
                () => {},
                (error) => {
                  emitError(error);
                },
              );
          }
        },
        onDrain: () => {
          if (!controller.signal.aborted
            && state.request.body instanceof Readable
            && state.request.body.isPaused()
          ) {
            state.request.body.resume();
          }
        },
        onError: (error) => {
          state.isConnectClose = true;
          if (error.code === 'ERR_SOCKET_CONNECTION_TIMEOUT') {
            emitError(new SocketConnectionTimeoutError(getConnect));
          } else {
            emitError(error);
          }
        },
        onClose: () => {
          state.isConnectClose = true;
          if (state.timeOnResponseEnd == null) {
            if (state.timeOnResponseHeader != null && isHttpStream(state.response.headers)) {
              state.response._write();
            } else {
              emitError(new SocketCloseError(getConnect));
            }
          }
        },
      },
      () => socket,
      controller.signal,
    );

    if (onBody instanceof Writable) {
      try {
        state.response._write = wrapStreamWrite({
          signal: controller.signal,
          stream: onBody,
          onPause: () => {
            if (!controller.signal.aborted) {
              state.connector.pause();
            }
          },
          onDrain: () => {
            if (!controller.signal.aborted) {
              state.connector.resume();
            }
          },
          onError: (error) => {
            emitError(error);
          },
        });
      } catch (error) {
        emitError(error);
      }
    }

    if (signal && !controller.signal.aborted) {
      state.isEventSignalBind = true;
      signal.addEventListener('abort', handleAbortOnSignal, { once: true });
    }
  });
};
