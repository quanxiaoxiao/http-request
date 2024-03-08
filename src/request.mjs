/* eslint no-use-before-define: 0 */
import assert from 'node:assert';
import net from 'node:net';
import { Buffer } from 'node:buffer';
import { encodeHttp, decodeHttpResponse } from '@quanxiaoxiao/http-utils';
import { createConnector, errors } from '@quanxiaoxiao/about-net';

const {
  SocketConnectError,
  SocketCloseError,
  SocketConnectTimeoutError,
  ConnectorCreateError,
} = errors;

export default (
  options,
  getConnect,
) => {
  assert(typeof getConnect === 'function');

  const {
    path = '/',
    method = 'GET',
    body = null,
    headers,
    onRequest,
    onStartLine,
    onHeader,
    onBody,
    onOutgoing,
    onIncoming,
    signal,
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
      isBindDrainOnBody: false,
      tick: null,
      connector: null,
      bytesIncoming: 0,
      bytesOutgoing: 0,
      bytesBody: 0,
      body: Buffer.from([]),
      decode: null,
      statusCode: null,
      httpVersion: null,
      statusText: null,
      headers: {},
      headersRaw: [],
      encodeRequest: null,

      timeOnStart: performance.now(),
      timeOnConnect: null,
      timeOnRequestSend: null,
      timeOnResponse: null,
      timeOnResponseHeader: null,
      timeOnResponseBody: null,
      timeOnResponseEnd: null,
    };

    const requestOptions = {
      path,
      method,
      headers,
      body,
    };

    function calcTime() {
      return performance.now() - state.timeOnStart;
    }

    function emitError(error) {
      if (state.isActive) {
        state.isActive = false;
        if (state.connector && signal && !signal.aborted) {
          signal.removeEventListener('abort', handleAbortOnSignal);
        }
        const errObj = typeof error === 'string' ? new Error(error) : error;
        reject(errObj);
      }
      if (state.isBindDrainOnBody) {
        state.isBindDrainOnBody = false;
        onBody.off('drain', handleDrainOnBody);
        onBody.off('close', handleCloseOnBody);
        if (!onBody.destroyed) {
          onBody.destroy();
        }
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
            requestOptions.body.pause();
          }
        } catch (error) {
          handleError(error);
          state.connector();
        }
      }
    }

    async function handleConnect() {
      if (onRequest) {
        try {
          await onRequest(requestOptions);
        } catch (error) {
          handleError(error);
          state.connector();
        }
      }
      if (state.isActive) {
        if (requestOptions.body && requestOptions.body.pipe) {
          if (!requestOptions.body.readable) {
            state.connector();
            emitError('request body stream unable read');
          } else {
            pipe();
          }
        } else {
          try {
            state.timeOnRequestSend = calcTime();
            outgoing(encodeHttp(requestOptions));
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
        requestOptions.body.off('data', handleDataOnRequestBody);
      }
    }

    function handleEndOnRequestBody() {
      state.isRequestBodyAttachEvents = false;
      requestOptions.body.off('close', handleCloseOnRequestBody);
      requestOptions.body.off('data', handleDataOnRequestBody);
      requestOptions.body.off('error', handleErrorOnRequestBody);
      if (state.isActive) {
        outgoing(state.encodeRequest());
      }
    }

    function handleCloseOnRequestBody() {
      state.isRequestBodyAttachEvents = false;
      requestOptions.body.off('end', handleEndOnRequestBody);
      requestOptions.body.off('data', handleDataOnRequestBody);
      requestOptions.body.off('error', handleErrorOnRequestBody);
      emitError('request body stream close');
      state.connector();
    }

    function handleErrorOnRequestBody(error) {
      emitError(error);
      state.connector();
    }

    function clearRequestBodyStreamEvents() {
      if (state.isRequestBodyAttachEvents) {
        state.isRequestBodyAttachEvents = false;
        requestOptions.body.off('error', handleErrorOnRequestBody);
        requestOptions.body.off('close', handleCloseOnRequestBody);
        requestOptions.body.off('end', handleEndOnRequestBody);
        requestOptions.body.off('data', handleDataOnRequestBody);
      }
    }

    function bindResponseDecode() {
      state.decode = decodeHttpResponse({
        onStartLine: async (ret) => {
          state.statusCode = ret.statusCode;
          state.httpVersion = ret.httpVersion;
          state.statusText = ret.statusText;
          if (onStartLine) {
            await onStartLine(getState());
          }
        },
        onHeader: async (ret) => {
          assert(state.isActive);
          state.timeOnResponseHeader = calcTime();
          state.headers = ret.headers;
          state.headersRaw = ret.headersRaw;
          if (onHeader) {
            await onHeader(getState());
          }
        },
        onBody: (bodyChunk) => {
          assert(state.isActive);
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = calcTime();
          }
          state.bytesBody += bodyChunk.length;
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
            state.body = Buffer.concat([
              state.body,
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
          if (state.isBindDrainOnBody) {
            state.isBindDrainOnBody = false;
            onBody.off('drain', handleDrainOnBody);
            onBody.off('close', handleCloseOnBody);
            onBody.end();
          }
          if (signal) {
            signal.removeEventListener('abort', handleAbortOnSignal);
          }
          resolve(getState());
          state.connector.end();
        },
      });
    }

    function handleError(error) {
      emitError(error);
      clearRequestBodyStreamEvents();
      if (state.tick != null) {
        clearTimeout(state.tick);
        state.tick = null;
      }
    }

    function pipe() {
      try {
        state.encodeRequest = encodeHttp({
          path: requestOptions.path,
          method: requestOptions.method,
          headers: requestOptions.headers,
          body: requestOptions.body,
          onHeader: (chunkRequestHeaders) => {
            assert(!state.isRequestBodyAttachEvents);
            if (state.isActive) {
              state.timeOnRequestSend = calcTime();
              outgoing(Buffer.concat([chunkRequestHeaders, Buffer.from('\r\n')]));
              state.isRequestBodyAttachEvents = true;
              requestOptions.body.once('error', handleErrorOnRequestBody);
              requestOptions.body.once('close', handleCloseOnRequestBody);
              requestOptions.body.once('end', handleEndOnRequestBody);
              requestOptions.body.on('data', handleDataOnRequestBody);
              if (requestOptions.body.isPaused()) {
                requestOptions.body.resume();
              }
            }
          },
        });
      } catch (error) {
        state.connector();
        handleError(error);
      }
    }

    function handleAbortOnSignal() {
      if (state.isActive) {
        state.isActive = false;
        state.connector();
        clearRequestBodyStreamEvents();
        if (state.tick) {
          clearTimeout(state.tick);
          state.tick = null;
        }
        reject(new Error('abort'));
      }
    }

    function handleDrainOnBody() {
      state.connector.resume();
    }

    function handleCloseOnBody() {
      if (state.isBindDrainOnBody) {
        state.isBindDrainOnBody = false;
        onBody.off('drain', handleDrainOnBody);
      }
      handleError(new Error('onBody stream close error'));
      state.connector();
    }

    function getState() {
      return {
        bytesIncoming: state.bytesIncoming,
        bytesOutgoing: state.bytesOutgoing,
        bytesBody: state.bytesBody,
        httpVersion: state.httpVersion,
        statusCode: state.statusCode,
        statusText: state.statusText,
        headersRaw: state.headersRaw,
        headers: state.headers,
        body: state.body,
      };
    }

    state.connector = createConnector(
      {
        onConnect: () => {
          assert(state.isActive);
          assert(!state.isConnect);
          state.isConnect = true;
          state.timeOnConnect = calcTime();
          clearTimeout(state.tick);
          state.tick = null;
          handleConnect();
        },
        onData: async (chunk) => {
          assert(state.isActive);
          if (state.timeOnRequestSend == null) {
            state.connector();
            handleError(new Error('request is not send, but received chunk'));
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
                handleError(error);
              }
            }
          }
        },
        onDrain: () => {
          if (state.isActive
            && state.isRequestBodyAttachEvents
            && requestOptions.body.isPaused()
          ) {
            requestOptions.body.resume();
          }
        },
        onError: (error) => {
          if (state.isConnect) {
            handleError(error);
          } else {
            handleError(new SocketConnectError());
          }
        },
        onClose: () => {
          handleError(new SocketCloseError());
        },
      },
      () => socket,
    );

    if (!state.connector) {
      handleError(new ConnectorCreateError());
    } else if (state.isActive) {
      state.tick = setTimeout(() => {
        state.tick = null;
        if (state.isActive) {
          state.connector();
          clearRequestBodyStreamEvents();
          emitError(new SocketConnectTimeoutError());
        }
      }, 1000 * 50);

      if (signal) {
        signal.addEventListener('abort', handleAbortOnSignal, { once: true });
      }
      if (onBody && onBody.write) {
        assert(onBody.writable);
        state.isBindDrainOnBody = true;
        onBody.on('drain', handleDrainOnBody);
        onBody.once('close', handleCloseOnBody);
      }
    }
  });
};
