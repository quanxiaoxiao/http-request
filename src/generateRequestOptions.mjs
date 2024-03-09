import assert from 'node:assert';
import _ from 'lodash';
import {
  convertObjectToArray,
  getValue,
  setHeaders,
} from '@quanxiaoxiao/http-utils';

export default ({
  hostname,
  path,
  method,
  headers,
  body = null,
}) => {
  assert(!!hostname);
  const result = {
    path,
    method,
    headers,
    body,
  };
  if (!result.method) {
    result.method = 'GET';
  }
  if (!result.path) {
    result.path = '/';
  }
  if (result.headers) {
    if (!Array.isArray(result.headers)) {
      assert(_.isPlainObject(result.headers));
      result.headers = convertObjectToArray(result.headers);
    }
  } else {
    result.headers = ['Host', hostname];
  }
  if (!getValue(result.headers, 'host')) {
    result.headers = setHeaders(result.headers, {
      Host: hostname,
    });
  }
  return result;
};
