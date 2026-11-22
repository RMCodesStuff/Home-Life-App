// Firebase, read-only, loaded lazily from gstatic only when an app is connected (or the user taps connect).
// Two named apps: `meals` (the meal planner) and `rack` (the rack session timer). Errors are mapped to
// 'not-connected' | 'permission' | 'network' | 'other'.
import { FIREBASE } from './connections.js';

export const FB_SDK = 'https://www.gstatic.com/firebasejs/13.3.0/';
const FLAG = (name) => `hl.fb.${name}`; // set after a successful connect, so the SDK is never fetched for people who never connected

let sdk = null;
async function loadSdk() {
  if (!sdk) {
    sdk = Promise.all([
      import(`${FB_SDK}firebase-app.js`),
      import(`${FB_SDK}firebase-auth.js`),
      import(`${FB_SDK}firebase-firestore.js`),
    ]).then(([app, auth, fs]) => ({ app, auth, fs })).catch((e) => { sdk = null; throw e; });
  }
  return sdk;
}

const apps = {};
async function appFor(name) {
  if (!FIREBASE[name]) throw Object.assign(new Error('unknown app'), { code: 'unknown' });
  if (!apps[name]) {
    apps[name] = (async () => {
      const { app, auth, fs } = await loadSdk();
      const existing = (app.getApps ? app.getApps() : []).find((a) => a.name === name);
      const a = existing || app.initializeApp(FIREBASE[name], name);
      const au = auth.getAuth(a);
      return { a, auth: au, db: fs.getFirestore(a), sdk: { auth, fs } };
    })().catch((e) => { delete apps[name]; throw e; });
  }
  return apps[name];
}
async function ready(au, authSdk) {
  if (typeof au.authStateReady === 'function') { await au.authStateReady(); return; }
  await new Promise((resolve) => { const off = authSdk.onAuthStateChanged(au, () => { off(); resolve(); }); });
}

/** 'not-connected' | 'permission' | 'network' | 'other' for any Firebase (or loader) error. Pure. */
export function mapFbError(e) {
  const code = String((e && e.code) || '').replace(/^(auth|firestore)\//, '');
  if (['not-connected', 'unauthenticated', 'user-token-expired', 'requires-recent-login', 'user-signed-out', 'no-current-user'].includes(code)) return 'not-connected';
  if (['permission-denied', 'unauthorized-domain', 'operation-not-allowed', 'user-disabled'].includes(code)) return 'permission';
  if (['unavailable', 'network-request-failed', 'deadline-exceeded', 'failed-precondition', 'internal-error-offline'].includes(code)) return 'network';
  if (!code && /failed to fetch|networkerror|load failed|importing a module/i.test(String((e && e.message) || ''))) return 'network';
  return 'other';
}
const fail = (e) => { const kind = mapFbError(e); throw Object.assign(new Error(kind), { kind, code: e && e.code }); };

const hasFlag = (name) => { try { return !!localStorage.getItem(FLAG(name)); } catch { return false; } };
const setFlag = (name, on) => { try { if (on) localStorage.setItem(FLAG(name), '1'); else localStorage.removeItem(FLAG(name)); } catch { /* ignore */ } };

/** {connected, uid?, name?, kind?}. Never loads the SDK unless this app was connected before. */
export async function fbStatus(name) {
  if (!hasFlag(name)) return { connected: false, kind: 'not-connected' };
  try {
    const { auth, sdk: s } = await appFor(name);
    await ready(auth, s.auth);
    const u = auth.currentUser;
    if (!u) return { connected: false, kind: 'not-connected' };
    return { connected: true, uid: u.uid, name: String(u.displayName || '').split(' ')[0].toLowerCase() };
  } catch (e) { return { connected: false, kind: mapFbError(e) }; }
}

/** Google sign-in popup; call only from a click. Resolves like fbStatus, throws {kind}. */
export async function fbConnect(name) {
  try {
    const { auth, sdk: s } = await appFor(name);
    const res = await s.auth.signInWithPopup(auth, new s.auth.GoogleAuthProvider());
    setFlag(name, true);
    const u = (res && res.user) || auth.currentUser;
    return { connected: true, uid: u && u.uid, name: String((u && u.displayName) || '').split(' ')[0].toLowerCase() };
  } catch (e) { return fail(e); }
}

export async function fbDisconnect(name) {
  setFlag(name, false);
  try { const { auth, sdk: s } = await appFor(name); await s.auth.signOut(auth); } catch { /* already gone */ }
}

async function signedIn(name) {
  if (!hasFlag(name)) throw Object.assign(new Error('not-connected'), { code: 'not-connected' });
  const x = await appFor(name);
  await ready(x.auth, x.sdk.auth);
  if (!x.auth.currentUser) throw Object.assign(new Error('not-connected'), { code: 'not-connected' });
  return x;
}

/** One document's data, or null when it doesn't exist. Throws {kind}. */
export async function fbGetDoc(name, path) {
  try {
    const { db, sdk: s } = await signedIn(name);
    const snap = await s.fs.getDoc(s.fs.doc(db, path));
    return snap.exists() ? snap.data() : null;
  } catch (e) { return fail(e); }
}

/** Several documents: [{path, data|null}] in order. Throws {kind} if any read fails. */
export async function fbGetDocs(name, paths) {
  try {
    const { db, sdk: s } = await signedIn(name);
    const snaps = await Promise.all(paths.map((p) => s.fs.getDoc(s.fs.doc(db, p))));
    return snaps.map((snap, i) => ({ path: paths[i], data: snap.exists() ? snap.data() : null }));
  } catch (e) { return fail(e); }
}
