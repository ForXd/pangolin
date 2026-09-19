import assert from 'node:assert/strict';
import test from 'node:test';
import { getReleaseStatus } from '../scripts/release-status.mjs';
import { verifyRelease } from '../scripts/verify-release.mjs';

const source = 'a'.repeat(40);
const options = { name: '@zllling/pangolin', version: '2.0.0', refType: 'branch', refName: 'main' };
const response = (status, data = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => data,
});
test('release allows only main or the exact stable version tag', async () => {
  assert.deepEqual(await getReleaseStatus(options, async () => response(404)), {
    published: false,
    version: '2.0.0',
    tag: 'v2.0.0',
  });
  for (const extra of [
    { refName: 'feature' },
    { refType: 'tag', refName: 'v1.0.0' },
    { version: '2.0.0-beta.1' },
  ]) {
    await assert.rejects(
      getReleaseStatus({ ...options, ...extra }, () => assert.fail('invalid ref queried registry')),
    );
  }
  const result = await getReleaseStatus(
    { ...options, refType: 'tag', refName: 'v2.0.0' },
    async () => response(404),
  );
  assert.equal(result.published, false);
});
test('published releases recover the original source commit; registry errors never mean unpublished', async () => {
  assert.equal(
    (
      await getReleaseStatus(options, async () =>
        response(200, { version: '2.0.0', gitHead: source }),
      )
    ).commit,
    source,
  );
  for (const status of [401, 429, 500])
    await assert.rejects(getReleaseStatus(options, async () => response(status)));
  await assert.rejects(getReleaseStatus(options, async () => response(200, { version: '2.0.0' })));
  await assert.rejects(
    getReleaseStatus(options, async () => response(200, { version: '3.0.0', gitHead: source })),
  );
});
test('release integrity verification retries propagation but rejects mismatched artifacts', async () => {
  const expected = {
    name: options.name,
    version: options.version,
    integrity: 'sha512-test',
    commit: source,
  };
  const published = {
    version: expected.version,
    gitHead: source,
    dist: { integrity: expected.integrity },
  };
  let attempts = 0;
  await verifyRelease(expected, {
    request: async () => (++attempts < 3 ? response(404) : response(200, published)),
    sleep: async () => {},
    attempts: 3,
  });
  assert.equal(attempts, 3);
  for (const bad of [
    { ...published, gitHead: 'b'.repeat(40) },
    { ...published, dist: { integrity: 'wrong' } },
  ]) {
    await assert.rejects(
      verifyRelease(expected, { request: async () => response(200, bad), attempts: 1 }),
    );
  }
  await assert.rejects(
    verifyRelease(expected, {
      request: async () => response(404),
      sleep: async () => {},
      attempts: 2,
    }),
  );
  await assert.rejects(
    verifyRelease(expected, { request: async () => response(403), attempts: 1 }),
  );
});
