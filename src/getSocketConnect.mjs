import assert from 'node:assert';
import net from 'node:net';
import tls from 'node:tls';

const PROTOCOLS = {
  HTTP: 'http:',
  HTTPS: 'https:',
};

const DEFAULT_PORTS = {
  [PROTOCOLS.HTTP]: 80,
  [PROTOCOLS.HTTPS]: 443,
};

const BUFFER_SIZES = {
  HTTP: 64 * 1024,
  HTTPS: 16384,
};

const validateInputs = ({ port, protocol }) => {
  if (port != null) {
    assert(
      Number.isInteger(port) && port >= 0 && port <= 65535,
      'port must be an integer between 0 and 65535',
    );
  }

  assert(
    Object.values(PROTOCOLS).includes(protocol),
    `protocol must be either '${PROTOCOLS.HTTP}' or '${PROTOCOLS.HTTPS}'`,
  );
};

const createTlsConnection = (commonOptions, { servername, rejectUnauthorized }) => {
  const tlsOptions = {
    ALPNProtocols: ['http/1.1'],
    rejectUnauthorized,
    secureContext: tls.createSecureContext({
      secureProtocol: 'TLSv1_2_method',
    }),
    ...(servername && { servername }),
  };

  return tls.connect({ ...commonOptions, ...tlsOptions });
};

export default ({
  hostname,
  port,
  protocol = PROTOCOLS.HTTP,
  servername,
  rejectUnauthorized = true,
}) => {
  validateInputs({ port, protocol });
  const isHttps = protocol === PROTOCOLS.HTTPS;
  const targetPort = port ?? DEFAULT_PORTS[protocol];

  const commonOptions = {
    host: hostname,
    port: targetPort,
    noDelay: true,
    highWaterMark: isHttps ? BUFFER_SIZES.HTTPS : BUFFER_SIZES.HTTP,
  };

  if (isHttps) {
    return createTlsConnection(commonOptions, { servername, rejectUnauthorized });
  }

  assert(protocol === 'http:', 'Protocol must be either `http:` or `https:`');
  return net.connect(commonOptions);
};
