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
      },

      response: {
        body: Buffer.from([]),
        statusCode: null,
        httpVersion: null,
        statusText: null,
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
      if (state.isActive) {
        state.isActive = false;
        if (state.connector && signal && !signal.aborted) {
          signal.removeEventListener('abort', handleAbortOnSignal);
        }
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
          emitError(error);
          state.connector();
        }
      }
    }

    async function handleConnect() {
      if (onRequest) {
        try {
          await onRequest(state.request);
        } catch (error) {
          emitError(error);
          state.connector();
        }
      }
      if (state.isActive) {
        if (state.request.body && state.request.body.pipe) {
          if (!state.request.body.readable) {
            state.connector();
            emitError('request body stream unable read');
          } else {
            pipe();
          }
        } else {
          state.timeOnRequestSend = calcTime();
          try {
            outgoing(encodeHttp(state.request));
          } catch (error) {
            state.connector();
            emitError(error);
          }
        }
      }
    }

    function handleDataOnRequestBody(chunk) {
      assert(state.encodeRequest);
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
    }

    function handleCloseOnRequestBody() {
      state.isRequestBodyAttachEvents = false;
      state.request.body.off('end', handleEndOnRequestBody);
      state.request.body.off('data', handleDataOnRequestBody);
      state.request.body.off('error', handleErrorOnRequestBody);
      emitError('request body stream close');
      state.connector();
    }

    function handleErrorOnRequestBody(error) {
      state.isRequestBodyAttachEvents = false;
      state.request.body.off('end', handleEndOnRequestBody);
      state.request.body.off('data', handleDataOnRequestBody);
      state.request.body.off('close', handleCloseOnRequestBody);
      emitError(error);
      state.connector();
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
          }
        },
        onHeader: async (ret) => {
          assert(state.isActive);
          state.timeOnResponseHeader = calcTime();
          state.response.headers = ret.headers;
          state.response.headersRaw = ret.headersRaw;
          if (onHeader) {
            await onHeader(getState());
          }
        },
        onBody: (bodyChunk) => {
          assert(state.isActive);
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = calcTime();
          }
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
      try {
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
      } catch (error) {
        state.connector();
        emitError(error);
      }
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
      emitError('onBody stream close error');
      state.connector();
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

        dateTime: state.dateTime,
        timeOnConnect: state.timeOnConnect,
        timeOnRequestSend: state.timeOnRequestSend,
        timeOnResponse: state.timeOnResponse,
        timeOnResponseStartLine: state.timeOnResponseStartLine,
        timeOnResponseHeader: state.timeOnResponseHeader,
        timeOnResponseBody: state.timeOnResponseBody,
        timeOnResponseEnd: state.timeOnResponseEnd,
      };
    }

    state.connector = createConnector(
      {
        onConnect: () => {
          assert(state.isActive);
          assert(!state.isConnect);
          clearTick();
          state.isConnect = true;
          state.timeOnConnect = calcTime();
          handleConnect();
        },
        onData: async (chunk) => {
          assert(state.isActive);
          if (state.timeOnRequestSend == null) {
            state.connector();
            emitError('request is not send, but received chunk');
          } else {
            const size = chunk.length;
            state.bytesIncoming += size;
            if (!state.decode) {
              state.timeOnResponse = calcTime();
              bindResponseDecode();
            }
            if (size > 0) {
              try {
                if (onIncoming) {
                  onIncoming(chunk);
                }
                await state.decode(chunk);
              } catch (error) {
                state.connector();
                emitError(error);
              }
            }
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
