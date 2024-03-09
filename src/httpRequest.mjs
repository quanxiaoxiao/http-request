import net from 'node:net';
import request from './request.mjs';
import generateRequestOptions from './generateRequestOptions.mjs';

export default async ({
  hostname,
  path,
  port = 80,
  method,
  body,
  headers,
  signal,
  onBody,
  onIncoming,
  onOutgoing,
  onStartLine,
  onHeader,
  onRequest,
  onResponse,
}) => {
  const responseItem = await request(
    {
      ...generateRequestOptions({
        hostname,
        path,
        method,
        headers,
        body,
      }),
      signal,
      onBody,
      onStartLine,
      onHeader,
      onRequest,
      onResponse,
      onIncoming,
      onOutgoing,
    },
    () => {
      const socket = new net.Socket();
      socket.connect({
        host: hostname,
        port,
        noDelay: true,
      });
      return socket;
    },
  );

  return responseItem;
};
