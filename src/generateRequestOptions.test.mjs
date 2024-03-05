import test from 'node:test';
import assert from 'node:assert';
import generateRequestOptions from './generateRequestOptions.mjs';

test('generateRequestOptions', () => {
  assert.throws(() => {
    generateRequestOptions({
      hostname: '',
      path: '/aaa',
      method: 'GET',
      body: null,
    });
  });
  assert.throws(() => {
    generateRequestOptions({
      hostname: 'www.test.com',
      path: '/aaa',
      headers: 'aaa',
      method: 'GET',
      body: null,
    });
  });
  let ret = generateRequestOptions({
    hostname: 'www.test.com',
    path: '/aaa',
    method: 'GET',
    body: null,
  });
  assert.deepEqual(ret, {
    path: '/aaa',
    headers: ['Host', 'www.test.com'],
    method: 'GET',
    body: null,
  });
  ret = generateRequestOptions({
    hostname: 'www.test.com',
    path: '/aaa',
    headers: {
      host: 'www.bbb.com',
      Name: 'aaa',
    },
    method: 'GET',
    body: null,
  });
  assert.deepEqual(ret, {
    path: '/aaa',
    headers: ['host', 'www.bbb.com', 'Name', 'aaa'],
    method: 'GET',
    body: null,
  });
  ret = generateRequestOptions({
    hostname: 'www.test.com',
    path: '/aaa',
    headers: ['host', 'www.bbb.com', 'foo', 'bar'],
    method: 'GET',
    body: null,
  });
  assert.deepEqual(ret, {
    path: '/aaa',
    headers: ['host', 'www.bbb.com', 'foo', 'bar'],
    method: 'GET',
    body: null,
  });
  ret = generateRequestOptions({
    hostname: 'www.test.com',
    path: '/aaa',
    headers: ['foo', 'bar'],
    method: 'GET',
    body: null,
  });
  assert.deepEqual(ret, {
    path: '/aaa',
    headers: ['foo', 'bar', 'Host', 'www.test.com'],
    method: 'GET',
    body: null,
  });
  ret = generateRequestOptions({
    hostname: 'www.test.com',
    path: '/aaa',
    headers: {
      Name: 'aaa',
    },
    method: 'GET',
    body: null,
  });
  assert.deepEqual(ret, {
    path: '/aaa',
    headers: ['Name', 'aaa', 'Host', 'www.test.com'],
    method: 'GET',
    body: null,
  });
});
