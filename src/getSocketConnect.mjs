import assert from 'node:assert';
import net from 'node:net';
import tls from 'node:tls';

export default ({
  hostname,
  port,
  protocol = 'http:',
  servername,
  rejectUnauthorized = true,
}) => {
  if (port != null) {
    assert(port >= 0 && port <= 65535 && Number.isInteger(port));
  }
  const isHttps = protocol === 'https:';
  const defaultPort = isHttps ? 443 : 80;

  const commonOptions = {
    host: hostname,
    port: port ?? defaultPort,
    noDelay: true,
    highWaterMark: isHttps ? 16384 : 64 * 1024,
  };

  if (isHttps) {
    const tlsOptions = {
      ALPNProtocols: ['http/1.1'],
      rejectUnauthorized,
      secureContext: tls.createSecureContext({
        secureProtocol: 'TLSv1_2_method',
      }),
      ...(servername && { servername }),
    };

    return tls.connect(Object.assign(commonOptions, tlsOptions));
  }

  assert(protocol === 'http:', 'Protocol must be either `http:` or `https:`');
  return net.connect(commonOptions);
};
