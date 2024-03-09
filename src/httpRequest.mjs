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
      onStartLine,
      onHeader,
      onRequest,
      onBody,
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
