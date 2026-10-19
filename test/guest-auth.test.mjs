import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySharedFirebaseUser, resetSharedAuthCache } from '../api/_shared-auth.js';
const originalFetch = global.fetch;
test('guest requests always recheck rules-protected grants and cannot write', async () => {
  resetSharedAuthCache();
  let allowed = true, reads = 0;
  global.fetch = async url => {
    if (url.includes('accounts:lookup')) return Response.json({ users: [{ localId: 'guest_test' }] });
    reads++;
    return allowed ? Response.json({ fields: { trains: { booleanValue: true } } }) : new Response('', { status: 403 });
  };
  try {
    const req = { method: 'GET', headers: { authorization: 'Bearer guest-token' } };
    assert.equal((await verifySharedFirebaseUser(req, 'trains')).uid, 'guest_test');
    await verifySharedFirebaseUser(req, 'trains'); assert.equal(reads, 2);
    allowed = false;
    await assert.rejects(verifySharedFirebaseUser(req, 'trains'), { status: 403 });
    allowed = true;
    await assert.rejects(verifySharedFirebaseUser({ ...req, method: 'POST' }, 'trains'), { status: 403 });
    await assert.rejects(verifySharedFirebaseUser(req, 'barrier'), { status: 403 });
  } finally { global.fetch = originalFetch; resetSharedAuthCache(); }
});
test('a guest-looking UID never bypasses Google token verification', async () => {
  global.fetch = async () => new Response('{}', { status: 401 });
  try { await assert.rejects(verifySharedFirebaseUser({ headers: { authorization: 'Bearer forged' } }, 'trains'), { status: 401 }); }
  finally { global.fetch = originalFetch; }
});
