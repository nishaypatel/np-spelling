// Shared sign-in check for the apps served through personal-apps-home.
//
// Every app on that domain signs in to the same Firebase project and is granted
// per app in Firestore appAccess/{uid}. This is the CommonJS copy of the file
// kept byte-identical in daily, fuel-prices and np-rtt-train: only the import
// and export lines differ, so copy fixes across rather than re-deriving them.
//
// Verifying costs two round trips to Google (the ID-token lookup and the grant
// read). A successful result is remembered for at most a minute — never past
// the token's own expiry — so a phone polling every few seconds pays them once
// a minute instead of on every request. The price is that revoking a grant can
// take up to a minute to bite, the same window NP Potholes accepts. Failures
// are never remembered, so a newly granted user is let in straight away.

const { createHash } = require('node:crypto');

const SHARED_FIREBASE_API_KEY = 'AIzaSyDRzzpk-stecVmxZpkgn2CJM4xgGWTPSUQ';
const SHARED_FIREBASE_PROJECT = 'np-personal-apps-nishaypatel';
const VERIFIED_TTL_MS = 60_000;
const VERIFIED_MAX = 200;

const verified = new Map();

// For tests: each case starts with nothing remembered.
function resetSharedAuthCache() {
  verified.clear();
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Read, not verified: it only shortens how long a result that Google has just
// confirmed is reused, so a forged value can never extend it.
function tokenExpiryMs(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
    const exp = Number(payload.exp) * 1000;
    return Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch {
    return null;
  }
}

function remember(key, user, idToken) {
  const now = Date.now();
  const expiresAt = Math.min(now + VERIFIED_TTL_MS, tokenExpiryMs(idToken) ?? Infinity);
  if (expiresAt <= now) return;
  for (const [k, entry] of verified) if (entry.expiresAt <= now) verified.delete(k);
  while (verified.size >= VERIFIED_MAX) verified.delete(verified.keys().next().value);
  verified.set(key, { user, expiresAt });
}

async function lookup(url, options) {
  try {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } catch {
    throw httpError('access_check_unavailable', 503);
  }
}

// Resolves to { uid, email } or throws an Error whose .status is 401, 403 or
// 503 and whose .message is missing_auth, invalid_token, app_access_denied or
// access_check_unavailable.
async function verifySharedFirebaseUser(req, requiredApp) {
  const authHeader = req.headers?.authorization || '';
  if (!authHeader.startsWith('Bearer ')) throw httpError('missing_auth', 401);
  const idToken = authHeader.slice(7);

  const key = `${createHash('sha256').update(idToken).digest('hex')}|${requiredApp || ''}`;
  const hit = verified.get(key);
  if (hit && hit.expiresAt > Date.now()) return { ...hit.user };
  if (hit) verified.delete(key);

  const account = await lookup(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${SHARED_FIREBASE_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) },
  );
  const user = account.payload.users?.[0];
  if (account.response.status >= 500) throw httpError('access_check_unavailable', 503);
  if (!account.response.ok || !user?.localId || !user?.email || user.emailVerified !== true) {
    throw httpError('invalid_token', 401);
  }

  if (requiredApp) {
    const grant = await lookup(
      `https://firestore.googleapis.com/v1/projects/${SHARED_FIREBASE_PROJECT}/databases/(default)/documents/appAccess/${encodeURIComponent(user.localId)}`,
      { headers: { Authorization: `Bearer ${idToken}` }, cache: 'no-store' },
    );
    if (grant.response.status >= 500) throw httpError('access_check_unavailable', 503);
    // 404 is "no grant document", which denies exactly like a false grant.
    if (!grant.response.ok || grant.payload.fields?.[requiredApp]?.booleanValue !== true) {
      throw httpError('app_access_denied', 403);
    }
  }

  const result = { uid: user.localId, email: user.email };
  remember(key, result, idToken);
  return { ...result };
}

const ERROR_TEXT = {
  missing_auth: 'Sign in required',
  invalid_token: 'Invalid sign-in',
  app_access_denied: 'App access denied',
  access_check_unavailable: 'Access check unavailable',
};

// For handlers that would rather not catch: writes the refusal itself and
// resolves to null, or resolves to the user.
async function authorizeSharedFirebaseRequest(req, res, requiredApp) {
  try {
    return await verifySharedFirebaseUser(req, requiredApp);
  } catch (error) {
    res.status(error.status || 503).json({ error: ERROR_TEXT[error.message] || ERROR_TEXT.access_check_unavailable });
    return null;
  }
}

module.exports = { verifySharedFirebaseUser, authorizeSharedFirebaseRequest, resetSharedAuthCache };
