/* eslint no-use-before-define: 0 */
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

const validateInputs = (signal, options) => {
  if (signal) {
    assert(!signal.aborted, 'Signal should not be aborted');
  }

  if (options.onBody) {
    assert(
      typeof options.onBody === 'function' || options.onBody instanceof Writable,
      'onBody must be a function or Writable stream',
    );
  }
};

const calcTime = (state) => {
  return performance.now() - state.timeOnStart;
};

const createInitialState = (options) => {
  return {
    connector: null,
    socket: null,
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
};

const getSocketInstance = (getConnect) => {
  const socket = typeof getConnect === 'function' ? getConnect() : getSocketConnect(getConnect);
  assert(socket && socket instanceof net.Socket, 'Socket must be a valid net.Socket instance');
  return socket;
};

const createResponseTimeout = (timeoutResponse, callback) => {
  return timeoutResponse != null
    ? waitTick(timeoutResponse, callback)
    : () => {};
};

const createStateSnapshot = (state) => {
  const baseState = {
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
    timeOnRequestSend: state.timeOnRequestSend,
    timeOnRequestEnd: state.timeOnRequestEnd,
    timeOnResponse: state.timeOnResponse,
    timeOnResponseStartLine: state.timeOnResponseStartLine,
    timeOnResponseHeader: state.timeOnResponseHeader,
    timeOnResponseBody: state.timeOnResponseBody,
    timeOnResponseEnd: state.timeOnResponseEnd,
  };

  if (state.socket instanceof tls.TLSSocket) {
    baseState.timeOnSecureConnect = state.timeOnSecureConnect;
  }

  return baseState;
};

const createErrorObject = (error, state) => {
  const errorObj = typeof error === 'string' ? new Error(error) : error;
  errorObj.isConnect = state.timeOnConnect != null;
  errorObj.state = createStateSnapshot(state);
  return errorObj;
};

const initializeRequest = (state, getConnect) => {
  if (state.request.headers) {
    state.request._headers = Array.isArray(state.request.headers)
      ? [...state.request.headers]
      : convertObjectToArray(state.request.headers);

    if (typeof getConnect !== 'function' && !getHeaderValue(state.request._headers, 'host')) {
      const hostname = getConnect.hostname || '127.0.0.1';
      const port = getConnect.port;
      state.request._headers.push('Host', `${hostname}:${port}`);
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
};

const handleTLSConnection = (state) => {
  if (state.socket instanceof tls.TLSSocket && state.socket.readyState === 'opening') {
    state.socket.once('connect', () => {
      state.timeOnConnect = calcTime(state);
    });
  }
};

const setupResponseStreamWrite = (onBody, state, controller, emitError) => {
  if (!(onBody instanceof Writable)) return;

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
      onError: emitError,
    });
  } catch (error) {
    emitError(error);
  }
};

const bindAbortSignal = (signal, controller, state, handleAbortOnSignal) => {
  if (signal && !controller.signal.aborted) {
    state.isEventSignalBind = true;
    signal.addEventListener('abort', handleAbortOnSignal, { once: true });
  }
};

const handleStreamRequest = (state, controller, doChunkOutgoing, onRequestEnd, emitError) => {
  assert(state.request.body.readable, 'Request body stream must be readable');

  const encodeRequest = encodeHttp({
    path: state.request.path,
    method: state.request.method,
    headers: state.request._headers,
    body: state.request.body,
    onHeader: (chunkRequestHeaders) => {
      if (!controller.signal.aborted) {
        doChunkOutgoing(chunkRequestHeaders);
        state.timeOnRequestSend = calcTime(state);
      }
    },
  });

  process.nextTick(() => {
    if (controller.signal.aborted) return;

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
          state.timeOnRequestEnd = calcTime(state);
          if (state.response.statusCode == null) {
            doChunkOutgoing(encodeRequest());
          }
          onRequestEnd?.(createStateSnapshot(state));
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
  });
};

const handleBufferRequest = async (state, doChunkOutgoing, onRequestEnd) => {
  if (state.request.body != null) {
    assert(
      Buffer.isBuffer(state.request.body) || typeof state.request.body === 'string',
      'Request body must be Buffer or string',
    );
    state.request.bytesBody = Buffer.byteLength(state.request.body);
  }

  doChunkOutgoing(encodeHttp({
    ...state.request,
    headers: state.request._headers,
  }));

  state.timeOnRequestSend = calcTime(state);
  state.timeOnRequestEnd = state.timeOnRequestSend;

  if (onRequestEnd) {
    await onRequestEnd(createStateSnapshot(state));
  }
};

const sendRequest = async (state, controller, doChunkOutgoing, onRequestEnd, emitError) => {
  if (state.request.body instanceof Readable) {
    await handleStreamRequest(state, controller, doChunkOutgoing, onRequestEnd, emitError);
  } else {
    await handleBufferRequest(state, doChunkOutgoing, onRequestEnd);
  }
};

const handleConnect = async (
  state, controller, onConnect, onRequest, onRequestEnd,
  doChunkOutgoing,
  emitError,
) => {
  if (state.socket instanceof tls.TLSSocket) {
    state.timeOnSecureConnect = calcTime(state);
  } else {
    state.timeOnConnect = calcTime(state);
  }

  if (onConnect) {
    await onConnect();
    assert(!controller.signal.aborted, 'Request aborted during onConnect');
  }

  if (onRequest) {
    await onRequest(state.request, createStateSnapshot(state));
    assert(!controller.signal.aborted, 'Request aborted during onRequest');
  }

  await sendRequest(state, controller, doChunkOutgoing, onRequestEnd, emitError);
};

const handleDrain = (state, controller) => {
  if (!controller.signal.aborted
    && state.request.body instanceof Readable
    && state.request.body.isPaused()
  ) {
    state.request.body.resume();
  }
};

const handleConnectorError = (error, state, emitError, getConnect) => {
  state.isConnectClose = true;
  const errorToEmit = error.code === 'ERR_SOCKET_CONNECTION_TIMEOUT'
    ? new SocketConnectionTimeoutError(getConnect)
    : error;
  emitError(errorToEmit);
};

const handleConnectorClose = (state, emitError, emitResponseEnd, getConnect) => {
  state.isConnectClose = true;
  if (state.timeOnResponseEnd == null) {
    if (state.timeOnResponseHeader != null && isHttpStream(state.response.headers)) {
      state.response._write?.();
    } else {
      emitError(new SocketCloseError(getConnect));
    }
  }
};

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

  validateInputs(signal, options);

  const state = createInitialState(options);
  const controller = new AbortController();
  const socket = getSocketInstance(getConnect);

  state.socket = socket;

  return new Promise((resolve, reject) => {
    function unbindSignalEvent() {
      if (state.isEventSignalBind) {
        state.isEventSignalBind = false;
        signal.removeEventListener('abort', handleAbortOnSignal);
      }
    }

    const tickWaitWithResponse = createResponseTimeout(timeoutResponse, () => {
      if (state.timeOnResponseStartLine == null) {
        emitError(new HttpResponseTimeoutError(getConnect));
      }
    });

    function emitError(error) {
      cleanup();
      if (!controller.signal.aborted) {
        controller.abort();
        const errorObj = createErrorObject(error, state);
        reject(errorObj);
      }
    }

    function cleanup() {
      unbindSignalEvent();
      tickWaitWithResponse();
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
          state.timeOnLastOutgoing = calcTime(state);
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
          resolve(createStateSnapshot(state));
        }
        if (!state.isConnectClose) {
          if (keepAlive) {
            state.connector.detach();
          } else {
            try {
              state.connector.end();
            } catch (error) {
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
          state.timeOnResponseStartLine = calcTime(state);
          tickWaitWithResponse();
          if (onStartLine) {
            await onStartLine(createStateSnapshot(state));
            assert(!controller.signal.aborted);
          }
        },
        onHeader: async (ret) => {
          state.timeOnResponseHeader = calcTime(state);
          state.response.headers = ret.headers;
          state.response.headersRaw = ret.headersRaw;
          if (onHeader) {
            await onHeader(createStateSnapshot(state));
            assert(!controller.signal.aborted);
          }
          if (isHttpStream(ret.headers)) {
            assert(onBody instanceof Writable);
          }
        },
        onBody: (bodyChunk) => {
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = calcTime(state);
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
          state.timeOnResponseEnd = calcTime(state);
          if (state.timeOnResponseBody == null) {
            state.timeOnResponseBody = state.timeOnResponseEnd;
          }
          if (onEnd) {
            await onEnd(createStateSnapshot(state));
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

    initializeRequest(state, getConnect);

    handleTLSConnection(state);

    const handleData = (chunk) => {
      assert(!controller.signal.aborted, 'Request should not be aborted when receiving data');
      assert(state.timeOnRequestSend != null, 'Request should be sent before receiving response');

      const size = chunk.length;
      state.bytesIncoming += size;
      state.timeOnLastIncoming = calcTime(state);

      if (!state.decode) {
        state.timeOnResponse = state.timeOnLastIncoming;
        bindResponseDecode();
      }

      if (size > 0) {
        onChunkIncoming?.(chunk);
        state.decode(chunk).catch(emitError);
      }
    };

    state.connector = createConnector(
      {
        onConnect: () => handleConnect(
          state, controller, onConnect, onRequest, onRequestEnd,
          doChunkOutgoing,
          emitError,
        ),
        onData: (chunk) => handleData(chunk),
        onDrain: () => handleDrain(state, controller),
        onError: (error) => handleConnectorError(error, state, emitError, getConnect),
        onClose: () => handleConnectorClose(state, emitError, emitResponseEnd, getConnect),
      },
      () => socket,
      controller.signal,
    );

    setupResponseStreamWrite(onBody, state, controller, emitError);
    bindAbortSignal(signal, controller, state, handleAbortOnSignal);
  });
};
