/* eslint no-use-before-define: 0 */
import assert from 'node:assert';
import net from 'node:net';
import process from 'node:process';
import { Writable, Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import { encodeHttp, decodeHttpResponse } from '@quanxiaoxiao/http-utils';
import {
  wrapStreamWrite,
  wrapStreamRead,
} from '@quanxiaoxiao/node-utils';
import { createConnector } from '@quanxiaoxiao/socket';

export default (
  options,
  getConnect,
) => {
  assert(typeof getConnect === 'function');

  const {
    signal,
    onRequest,
    onStartLine,
    onHeader,
    onBody,
    onOutgoing,
    onIncoming,
  } = options;

  if (signal) {
    assert(!signal.aborted);
  }

  const socket = getConnect();

  assert(socket && socket instanceof net.Socket);

  const controller = new AbortController();

  return new Promise((resolve, reject) => {
    const state = {
      isConnect: false,
      tick: null,
      connector: null,
      bytesIncoming: 0,
      bytesOutgoing: 0,
      decode: null,

      isEventSignalBind: false,

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
        body: options.body || null,
        bytesBody: 0,
      },

      response: {
        body: Buffer.from([]),
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
      clearTick();
      if (!controller.signal.aborted) {
        controller.abort();
        const errObj = typeof error === 'string' ? new Error(error) : error;
        errObj.isConnect = state.isConnect;
        reject(errObj);
      }
    }

    function outgoing(chunk) {
      const size = chunk.length;
      if (size > 0) {
        try {
          state.bytesOutgoing += size;
          if (onOutgoing) {
            onOutgoing(chunk);
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

    function bindResponseDecode() {
      state.decode = decodeHttpResponse({
        onStartLine: async (ret) => {
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
            state.response.body = Buffer.concat([
              state.response.body,
              bodyChunk,
            ]);
          }
        },
        onEnd: () => {
          state.timeOnResponseEnd = calcTime();
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = state.timeOnResponseEnd;
          }
          if (state.response._write) {
            state.response._write();
          } else {
            unbindSignalEvent();
            state.connector.end();
            resolve(getState());
          }
        },
      });
    }

    function handleAbortOnSignal() {
      clearTick();
      state.isEventSignalBind = false;
      emitError(new Error('abort'));
    }

    function clearTick() {
      if (state.tick) {
        clearTimeout(state.tick);
        state.tick = null;
      }
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
          assert(!controller.signal.aborted);
          clearTick();
          state.isConnect = true;
          state.timeOnConnect = calcTime();
          if (onRequest) {
            await onRequest(state.request);
            assert(!controller.signal.aborted);
          }
          if (state.request.body instanceof Readable) {
            const encodeRequest = encodeHttp({
              path: state.request.path,
              method: state.request.method,
              headers: state.request.headers,
              body: state.request.body,
              onHeader: (chunkRequestHeaders) => {
                if (!controller.signal.aborted) {
                  state.timeOnRequestSend = calcTime();
                  outgoing(Buffer.concat([chunkRequestHeaders, Buffer.from('\r\n')]));
                  if (state.request.body.isPaused()) {
                    state.request.body.resume();
                  }
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
                      outgoing(encodeRequest(chunk));
                    },
                    onEnd: () => {
                      outgoing(encodeRequest());
                      state.timeOnRequestEnd = calcTime();
                    },
                    onError: (error) => {
                      emitError(error);
                    },
                  });
                } catch (error) {
                  emitError(error);
                }
              }
            });
          } else {
            state.timeOnRequestSend = calcTime();
            if (state.request.body) {
              state.request.bytesBody = Buffer.byteLength(state.request.body);
            }
            outgoing(encodeHttp(state.request));
            state.timeOnRequestEnd = calcTime();
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
            if (onIncoming) {
              onIncoming(chunk);
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
          assert(!controller.signal.aborted);
          if (state.request.body instanceof Readable
            && state.request.body.isPaused()
          ) {
            state.request.body.resume();
          }
        },
        onError: (error) => {
          emitError(error);
        },
        onClose: () => {
          emitError(new Error('Socket Close Error'));
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
            assert(!controller.signal.aborted);
            state.connector.pause();
          },
          onDrain: () => {
            assert(!controller.signal.aborted);
            state.connector.resume();
          },
          onError: (error) => {
            emitError(error);
          },
          onEnd: () => {
            assert(!controller.signal.aborted);
            unbindSignalEvent();
            state.connector.end();
            resolve(getState());
          },
        });
      } catch (error) {
        emitError(error);
      }
    }

    if (!controller.signal.aborted) {
      state.tick = setTimeout(() => {
        state.tick = null;
        emitError(new Error('Socket Connect Timeout Error'));
      }, 1000 * 15);
    }

    if (signal && !controller.signal.aborted) {
      state.isEventSignalBind = true;
      signal.addEventListener('abort', handleAbortOnSignal, { once: true });
    }
  });
};
