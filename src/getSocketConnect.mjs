import net from 'node:net';
import assert from 'node:assert';
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
  if (protocol === 'https:') {
    const options = {
      host: hostname || '127.0.0.1',
      port,
      noDelay: true,
      highWaterMark: 16384,
      ALPNProtocols: ['http/1.1'],
      rejectUnauthorized,
      secureContext: tls.createSecureContext({
        secureProtocol: 'TLSv1_2_method',
      }),
    };
    if (options.port == null) {
      options.port = 443;
    }
    if (servername) {
      options.servername = servername;
    }
    return tls.connect(options);
  }
  assert(protocol === 'http:');
  const options = {
    noDelay: true,
    highWaterMark: 64 * 1024,
    host: hostname || '127.0.0.1',
    port,
  };
  if (options.port == null) {
    options.port = 80;
  }
  return net.connect(options);
};
