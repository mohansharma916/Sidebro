import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

test('server/src/types.ts is identical to shared/types.ts', () => {
  const shared = fs.readFileSync(new URL('../../shared/types.ts', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
  assert.equal(server, shared, 'Copy shared/types.ts to server/src/types.ts after editing it');
});
