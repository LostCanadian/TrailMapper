import assert from 'node:assert/strict';
import test from 'node:test';

import { lookupElevation } from './elevation.mjs';

test('queries NRCan with its documented latitude and longitude parameters', async () => {
  let requestedUrl;
  const result = await lookupElevation(49.8352, -124.5247, async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ altitude: 112.75 }) };
  });

  assert.equal(requestedUrl.origin + requestedUrl.pathname, 'https://api.nrcan.gc.ca/elevation/cdem/altitude');
  assert.equal(requestedUrl.searchParams.get('lat'), '49.8352');
  assert.equal(requestedUrl.searchParams.get('lon'), '-124.5247');
  assert.deepEqual(result, { elevation: 112.75, provider: 'NRCan CDEM' });
});

test('accepts numeric altitude strings returned by NRCan', async () => {
  const result = await lookupElevation(49, -124, async () => ({
    ok: true,
    json: async () => ({ altitude: '87.5' })
  }));

  assert.equal(result.elevation, 87.5);
});

test('falls back when NRCan cannot be reached', async () => {
  const requests = [];
  const result = await lookupElevation(49, -124, async (url) => {
    requests.push(url.toString());
    if (requests.length === 1) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => ({ elevation: [91] }) };
  });

  assert.match(requests[1], /^https:\/\/api\.open-meteo\.com\/v1\/elevation/);
  assert.deepEqual(result, { elevation: 91, provider: 'Open-Meteo' });
});
