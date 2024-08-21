import { DecodeHttpError } from '@quanxiaoxiao/http-utils';

class SocketCloseError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ERR_SOCKET_CLOSE';
    this.message = message || 'Socket Close Error';
  }
}

class NetConnectTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ERR_SOCKET_CONNECTION_TIMEOUT';
    this.message = message || 'Net Connect Timeout Error';
  }
}

class DoAbortError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ABORT_ERR';
    this.message = message || 'abort';
  }
}

class HttpResponseTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ERR_HTTP_RESPONSE_TIMEOUT';
    this.message = message || 'http response timeout';
  }
}

export {
  NetConnectTimeoutError,
  DoAbortError,
  SocketCloseError,
  DecodeHttpError,
  HttpResponseTimeoutError,
};
