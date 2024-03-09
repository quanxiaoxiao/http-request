import tls from 'node:tls';
import net from 'node:net';
import request from './request.mjs';
import generateRequestOptions from './generateRequestOptions.mjs';

export default async ({
  hostname,
  path,
  port = 443,
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
  servername,
  ...other
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
      onIncoming,
      onOutgoing,
      onBody,
      onRequest,
    },
    () => {
      const options = {
        host: hostname,
        servername,
        port,
        secureContext: tls.createSecureContext({
          secureProtocol: 'TLSv1_2_method',
        }),
        noDelay: true,
        ...other,
      };
      if (!options.servername) {
        if (net.isIP(hostname) === 0) {
          options.servername = hostname;
        }
      }
      return tls.connect(options);
    },
  );

  return responseItem;
};
