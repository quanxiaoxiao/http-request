import assert from 'node:assert';
import net from 'node:net';
import process from 'node:process';
import { Writable, Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import {
  encodeHttp,
  decodeHttpResponse,
  isHttpStream,
} from '@quanxiaoxiao/http-utils';
import {
  wrapStreamWrite,
  wrapStreamRead,
} from '@quanxiaoxiao/node-utils';
import { createConnector } from '@quanxiaoxiao/socket';
import {
  SocketCloseError,
  DoAbortError,
} from './errors.mjs';

export default (
  options,
  getConnect,
  keepAlive,
) => {
  assert(typeof getConnect === 'function');

  const {
    signal,
    onRequest,
    onStartLine,
    onHeader,
    onEnd,
    onBody,
    onChunkOutgoing,
    onChunkIncoming,
  } = options;

  if (signal) {
    assert(!signal.aborted);
  }

  const socket = getConnect();

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
      timeOnRequestSend: null,
      timeOnRequestEnd: null,
      timeOnResponse: null,
      timeOnResponseStartLine: null,
      timeOnResponseHeader: null,
      timeOnResponseBody: null,
      timeOnResponseEnd: null,

      request: {
        path: options.path || '/',
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body ?? null,
        bytesBody: 0,
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

    function calcTime() {
      return performance.now() - state.timeOnStart;
    }

    function unbindSignalEvent() {
      if (state.isEventSignalBind) {
        state.isEventSignalBind = false;
        signal.removeEventListener('abort', handleAbortOnSignal);
      }
    }

    function emitError(error) {
      unbindSignalEvent();
      if (!controller.signal.aborted) {
        controller.abort();
        const errObj = typeof error === 'string' ? new Error(error) : error;
        errObj.isConnect = state.timeOnConnect != null;
        errObj.state = getState();
        reject(errObj);
      }
    }

    function doOutgoing(chunk) {
      const size = chunk.length;
      if (size > 0) {
        try {
          state.bytesOutgoing += size;
          if (onChunkOutgoing) {
            onChunkOutgoing(chunk);
          }
          const ret = state.connector.write(chunk);
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
          resolve(getState());
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
          if (state.request.body instanceof Readable
            && !state.request.body.readableEnded
          ) {
            state.request.body.end();
          }
          state.response.statusCode = ret.statusCode;
          state.response.httpVersion = ret.httpVersion;
          state.response.statusText = ret.statusText;
          state.timeOnResponseStartLine = calcTime();
          if (onStartLine) {
            await onStartLine(getState());
            assert(!controller.signal.aborted);
          }
        },
        onHeader: async (ret) => {
          state.timeOnResponseHeader = calcTime();
          state.response.headers = ret.headers;
          state.response.headersRaw = ret.headersRaw;
          if (onHeader) {
            await onHeader(getState());
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
            await onEnd(getState());
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
        timeOnConnect: state.timeOnConnect,
        timeOnRequestSend: state.timeOnRequestSend,
        timeOnRequestEnd: state.timeOnRequestEnd,
        timeOnResponse: state.timeOnResponse,
        timeOnResponseStartLine: state.timeOnResponseStartLine,
        timeOnResponseHeader: state.timeOnResponseHeader,
        timeOnResponseBody: state.timeOnResponseBody,
        timeOnResponseEnd: state.timeOnResponseEnd,
      };
    }

    state.connector = createConnector(
      {
        onConnect: async () => {
          state.timeOnConnect = calcTime();
          if (onRequest) {
            await onRequest(state.request, getState());
            assert(!controller.signal.aborted);
          }
          if (state.request.body instanceof Readable) {
            assert(state.request.body.readable);
            const encodeRequest = encodeHttp({
              path: state.request.path,
              method: state.request.method,
              headers: state.request.headers,
              body: state.request.body,
              onHeader: (chunkRequestHeaders) => {
                if (!controller.signal.aborted) {
                  doOutgoing(chunkRequestHeaders);
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
                        doOutgoing(buf);
                      }
                    },
                    onEnd: () => {
                      state.timeOnRequestEnd = calcTime();
                      if (state.response.statusCode == null) {
                        doOutgoing(encodeRequest());
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
            doOutgoing(encodeHttp(state.request));
            state.timeOnRequestSend = calcTime();
            state.timeOnRequestEnd = state.timeOnRequestSend;
          }
        },
        onData: (chunk) => {
          assert(!controller.signal.aborted);
          assert(state.timeOnRequestSend != null);
          const size = chunk.length;
          state.bytesIncoming += size;
          if (!state.decode) {
            state.timeOnResponse = calcTime();
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
          emitError(error);
        },
        onClose: () => {
          state.isConnectClose = true;
          if (state.timeOnResponseEnd == null) {
            if (state.timeOnResponseHeader != null && isHttpStream(state.response.headers)) {
              state.response._write();
            } else {
              emitError(new SocketCloseError());
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
