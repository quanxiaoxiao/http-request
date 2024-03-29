/* eslint no-use-before-define: 0 */
import assert from 'node:assert';
import net from 'node:net';
import { Buffer } from 'node:buffer';
import { encodeHttp, decodeHttpResponse } from '@quanxiaoxiao/http-utils';
import { createConnector } from '@quanxiaoxiao/socket';
import {
  SocketConnectError,
  SocketCloseError,
  SocketConnectTimeoutError,
} from './errors.mjs';

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

  return new Promise((resolve, reject) => {
    const state = {
      isActive: true,
      isConnect: false,
      isRequestBodyAttachEvents: false,
      isResponseOnBodyAttachEvents: false,
      tick: null,
      connector: null,
      bytesIncoming: 0,
      bytesOutgoing: 0,
      decode: null,
      encodeRequest: null,

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

    if (onBody && onBody.write) {
      assert(onBody.writable);
    }

    function calcTime() {
      return performance.now() - state.timeOnStart;
    }

    function clearRequestBodyStreamEvents() {
      if (state.isRequestBodyAttachEvents) {
        state.isRequestBodyAttachEvents = false;
        state.request.body.off('close', handleCloseOnRequestBody);
        state.request.body.off('end', handleEndOnRequestBody);
        state.request.body.off('data', handleDataOnRequestBody);
        state.request.body.off('error', handleErrorOnRequestBody);
      }
    }

    function emitError(error) {
      clearRequestBodyStreamEvents();
      if (state.isResponseOnBodyAttachEvents) {
        state.isResponseOnBodyAttachEvents = false;
        onBody.off('drain', handleDrainOnBody);
        onBody.off('close', handleCloseOnBody);
        if (!onBody.destroyed) {
          onBody.destroy();
        }
      }
      if (state.connector && signal && !signal.aborted) {
        signal.removeEventListener('abort', handleAbortOnSignal);
      }
      if (state.isActive) {
        state.isActive = false;
        const errObj = typeof error === 'string' ? new Error(error) : error;
        errObj.isConnect = state.isConnect;
        reject(errObj);
      }
    }

    function outgoing(chunk) {
      assert(state.isActive);
      const size = chunk.length;
      if (size > 0) {
        try {
          state.bytesOutgoing += size;
          if (onOutgoing) {
            onOutgoing(chunk);
          }
          const ret = state.connector.write(chunk);
          if (!ret && state.isRequestBodyAttachEvents) {
            state.request.body.pause();
          }
        } catch (error) {
          state.connector();
          emitError(error);
        }
      }
    }

    function handleDataOnRequestBody(chunk) {
      assert(state.encodeRequest);
      state.request.bytesBody += chunk.length;
      if (state.isActive) {
        outgoing(state.encodeRequest(chunk));
      } else {
        state.request.body.off('data', handleDataOnRequestBody);
      }
    }

    function handleEndOnRequestBody() {
      state.isRequestBodyAttachEvents = false;
      state.request.body.off('close', handleCloseOnRequestBody);
      state.request.body.off('data', handleDataOnRequestBody);
      state.request.body.off('error', handleErrorOnRequestBody);
      if (state.isActive) {
        outgoing(state.encodeRequest());
      }
      state.timeOnRequestEnd = calcTime();
    }

    function handleCloseOnRequestBody() {
      state.isRequestBodyAttachEvents = false;
      state.request.body.off('end', handleEndOnRequestBody);
      state.request.body.off('data', handleDataOnRequestBody);
      state.request.body.off('error', handleErrorOnRequestBody);
      state.connector();
      emitError('request body stream close');
    }

    function handleErrorOnRequestBody(error) {
      state.isRequestBodyAttachEvents = false;
      state.request.body.off('end', handleEndOnRequestBody);
      state.request.body.off('data', handleDataOnRequestBody);
      state.request.body.off('close', handleCloseOnRequestBody);
      state.connector();
      emitError(error);
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
            assert(state.isActive);
          }
        },
        onHeader: async (ret) => {
          assert(state.isActive);
          state.timeOnResponseHeader = calcTime();
          state.response.headers = ret.headers;
          state.response.headersRaw = ret.headersRaw;
          if (onHeader) {
            await onHeader(getState());
            assert(state.isActive);
          }
        },
        onBody: (bodyChunk) => {
          assert(state.isActive);
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = calcTime();
          }
          state.response.bytesBody += bodyChunk.length;
          if (onBody) {
            if (onBody.write) {
              assert(onBody.writable);
              if (onBody.write(bodyChunk) === false) {
                state.connector.pause();
              }
            } else {
              onBody(bodyChunk);
            }
          } else {
            state.response.body = Buffer.concat([
              state.response.body,
              bodyChunk,
            ]);
          }
        },
        onEnd: () => {
          assert(state.isActive);
          state.isActive = false;
          state.timeOnResponseEnd = calcTime();
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = state.timeOnResponseEnd;
          }
          if (state.isResponseOnBodyAttachEvents) {
            state.isResponseOnBodyAttachEvents = false;
            onBody.off('drain', handleDrainOnBody);
            onBody.off('close', handleCloseOnBody);
          }
          if (signal) {
            signal.removeEventListener('abort', handleAbortOnSignal);
          }
          resolve(getState());
          state.connector.end();
        },
      });
    }

    function pipe() {
      state.encodeRequest = encodeHttp({
        path: state.request.path,
        method: state.request.method,
        headers: state.request.headers,
        body: state.request.body,
        onHeader: (chunkRequestHeaders) => {
          assert(!state.isRequestBodyAttachEvents);
          if (state.isActive) {
            state.timeOnRequestSend = calcTime();
            outgoing(Buffer.concat([chunkRequestHeaders, Buffer.from('\r\n')]));
            state.isRequestBodyAttachEvents = true;
            state.request.body.once('error', handleErrorOnRequestBody);
            state.request.body.once('close', handleCloseOnRequestBody);
            state.request.body.once('end', handleEndOnRequestBody);
            state.request.body.on('data', handleDataOnRequestBody);
            if (state.request.body.isPaused()) {
              state.request.body.resume();
            }
          }
        },
      });
    }

    function handleAbortOnSignal() {
      clearRequestBodyStreamEvents();
      clearTick();
      if (state.isResponseOnBodyAttachEvents) {
        state.isResponseOnBodyAttachEvents = false;
        onBody.off('drain', handleDrainOnBody);
        onBody.off('close', handleCloseOnBody);
      }
      if (state.isActive) {
        state.isActive = false;
        state.connector();
        reject(new Error('abort'));
      }
    }

    function handleDrainOnBody() {
      state.connector.resume();
    }

    function clearTick() {
      if (state.tick) {
        clearTimeout(state.tick);
        state.tick = null;
      }
    }

    function handleCloseOnBody() {
      if (state.isResponseOnBodyAttachEvents) {
        state.isResponseOnBodyAttachEvents = false;
        onBody.off('drain', handleDrainOnBody);
      }
      clearTick();
      state.connector();
      emitError('onBody stream close error');
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
          assert(state.isActive);
          clearTick();
          state.isConnect = true;
          state.timeOnConnect = calcTime();
          if (onRequest) {
            await onRequest(state.request);
            assert(state.isActive);
          }
          if (state.request.body && state.request.body.pipe) {
            if (!state.request.body.readable) {
              throw new Error('request body stream unable read');
            }
            pipe();
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
          assert(state.isActive);
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
                  state.connector();
                  emitError(error);
                },
              );
          }
        },
        onDrain: () => {
          if (state.isActive
            && state.isRequestBodyAttachEvents
            && state.request.body.isPaused()
          ) {
            state.request.body.resume();
          }
        },
        onError: (error) => {
          if (state.isConnect) {
            emitError(error);
          } else {
            clearTick();
            emitError(new SocketConnectError());
          }
        },
        onClose: () => {
          clearTick();
          emitError(new SocketCloseError());
        },
      },
      () => socket,
    );

    state.tick = setTimeout(() => {
      state.tick = null;
      if (state.isActive) {
        state.connector();
        emitError(new SocketConnectTimeoutError());
      }
    }, 1000 * 15);

    if (signal) {
      signal.addEventListener('abort', handleAbortOnSignal, { once: true });
    }

    if (onBody && onBody.write) {
      state.isResponseOnBodyAttachEvents = true;
      onBody.on('drain', handleDrainOnBody);
      onBody.once('close', handleCloseOnBody);
    }
  });
};
