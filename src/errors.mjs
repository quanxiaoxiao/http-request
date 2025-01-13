import { DecodeHttpError } from '@quanxiaoxiao/http-utils';

const getRemoteAddress = (obj) => {
  if (!obj) {
    return null;
  }
  if (typeof obj === 'function') {
    return null;
  }
  const result = {
    hostname: obj.hostname || '127.0.0.1',
    port: obj.port,
  };
  if (result.port == null) {
    if (obj.protocol === 'https:') {
      result.port = 443;
    } else {
      result.port = 80;
    }
  }
  return `${result.hostname}:${result.port}`;
};

class SocketCloseError extends Error {
  constructor(options) {
    super();
    this.code = 'ERR_SOCKET_CLOSE';
    const remoteAddress = getRemoteAddress(options);
    if (remoteAddress) {
      this.message = `${remoteAddress} SOCKET_CLOSE`;
    } else {
      this.message = 'SOCKET_CLOSE';
    }
  }
}

class DoAbortError extends Error {
  constructor() {
    super();
    this.code = 'ABORT_ERR';
    this.message = 'abort';
  }
}

class HttpResponseTimeoutError extends Error {
  constructor(options) {
    super();
    this.code = 'ERR_HTTP_RESPONSE_TIMEOUT';
    const remoteAddress = getRemoteAddress(options);
    if (remoteAddress) {
      this.message = `${remoteAddress} HTTP_RESPONSE_TIMEOUT`;
    } else {
      this.message = 'HTTP_RESPONSE_TIMEOUT';
    }
  }
}

class SocketConnectionTimeoutError extends Error {
  constructor(options) {
    super();
    this.code = 'ERR_SOCKET_CONNECTION_TIMEOUT';
    const remoteAddress = getRemoteAddress(options);
    if (remoteAddress) {
      this.message = `${remoteAddress} CONNECTION_TIMEOUT`;
    } else {
      this.message = 'CONNECTION_TIMEOUT';
    }
  }
}

export {
  DecodeHttpError,
  DoAbortError,
  HttpResponseTimeoutError,
  SocketCloseError,
  SocketConnectionTimeoutError,
};
