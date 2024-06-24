/* eslint max-classes-per-file: 0 */
import { DecodeHttpError } from '@quanxiaoxiao/http-utils';

class SocketCloseError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Close Error';
  }
}

class NetConnectTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Net Connect Timeout Error';
  }
}

class DoAbortError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'abort';
  }
}

export {
  NetConnectTimeoutError,
  DoAbortError,
  SocketCloseError,
  DecodeHttpError,
};
