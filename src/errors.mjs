/* eslint max-classes-per-file: 0 */

export class SocketConnectError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Connect Error';
  }
}

export class SocketCloseError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Close Error';
  }
}

export class SocketConnectTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.message = message || 'Socket Connect Timeout';
  }
}
