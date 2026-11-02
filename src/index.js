// Woodhouse Voucher Desk - password gate.
//
// Every request comes through here first (run_worker_first in
// wrangler.jsonc). Without a valid session cookie, the visitor gets the
// sign-in page and nothing else: not the app, not the voucher designs, not
// the PDF templates.
//
// The password is NOT in this code. It lives in the Worker secret
// ACCESS_PASSWORD (Workers & Pages -> vouchers -> Settings -> Variables and
// Secrets), which Cloudflare stores encrypted and never shows again. If the
// secret is missing, the site stays locked rather than open.
//
// Sessions are signed with a key derived from that secret, so changing the
// password signs everybody out.

const COOKIE = 'vd_session';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.ACCESS_PASSWORD;

    if (!secret) {
      return page(loginHtml({ notice: "This site hasn't been given a password yet, so it's locked. Add the ACCESS_PASSWORD secret in Cloudflare." }), 503);
    }

    if (url.pathname === '/logout') {
      return redirect('/', clearCookie());
    }

    if (url.pathname === '/login' && request.method === 'POST') {
      return login(request, env, secret, url);
    }

    if (await validSession(request, secret)) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('Cache-Control', 'private, no-store');
      return out;
    }

    // Not signed in. Page loads get the sign-in screen; anything else
    // (a PDF template, an image) gets a plain refusal.
    const wantsPage = request.method === 'GET' &&
      (request.headers.get('Accept') || '').includes('text/html');
    if (wantsPage) return page(loginHtml({ next: url.pathname + url.search }), 401);
    return new Response('Sign in required.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  },
};

/* -------------------------------------------------------------- sign in */

async function login(request, env, secret, url) {
  // Slow down guessing: at most a handful of tries per minute from one
  // address, using Cloudflare's rate limiter when it's available.
  if (env.LOGIN_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const { success } = await env.LOGIN_LIMIT.limit({ key: ip });
    if (!success) {
      return page(loginHtml({ error: 'Too many attempts. Wait a minute and try again.' }), 429);
    }
  }

  const form = await request.formData().catch(() => null);
  const given = String(form?.get('password') ?? '');
  const next = safeNext(String(form?.get('next') ?? '/'));

  if (!(await sameSecret(given, secret))) {
    return page(loginHtml({ error: "That password isn't right.", next }), 401);
  }

  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const token = `${exp}.${await sign(secret, String(exp))}`;
  const cookie = `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`;
  return redirect(next, cookie);
}

async function validSession(request, secret) {
  const raw = (request.headers.get('Cookie') || '')
    .split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  return timingSafeEqual(sig, await sign(secret, exp));
}

/* --------------------------------------------------------------- crypto */

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode('voucher-desk-session:' + secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function sign(secret, message) {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Compare by hashing both sides first, so the time taken says nothing about the password. */
async function sameSecret(a, b) {
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------------------------------------- helpers */

/** Only ever send people back to a path on this site. */
function safeNext(n) {
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/login') && !n.startsWith('/logout') ? n : '/';
}

function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function redirect(location, cookie) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

function page(html, status) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginHtml({ error = '', notice = '', next = '/' } = {}) {
  const msg = error || notice;
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in · Woodhouse Voucher Desk</title>
<style>
:root{--bg:#F1F4F1;--surface:#fff;--ink:#1E2923;--muted:#5B6A61;--line:#D6DDD7;--accent:#DF5F3E;--accent-ink:#fff;--accent-soft:#FBE7E0;--warn:#9A6300;--warn-soft:#FBEFD5;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121815;--surface:#1A221E;--ink:#E6ECE8;--muted:#9BA9A1;--line:#2E3933;--accent:#F0795A;--accent-ink:#1A0E0A;--accent-soft:#3A221B;--warn:#F2C26B;--warn-soft:#3A2E17;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--ink);font:15px/1.45 "Segoe UI",system-ui,-apple-system,sans-serif}
.card{width:100%;max-width:360px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:28px 24px}
.mark{width:42px;height:42px;border-radius:10px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;margin-bottom:14px}
h1{font-size:20px;margin:0 0 4px}
p{margin:0 0 20px;color:var(--muted);font-size:14px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input{width:100%;height:44px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font:inherit}
input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
button{margin-top:14px;width:100%;height:44px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:700;cursor:pointer}
button:hover{filter:brightness(.95)}
.msg{background:var(--warn-soft);color:var(--ink);border-radius:8px;padding:9px 12px;font-size:14px;margin-bottom:14px}
</style>
</head>
<body>
<main class="card">
  <div class="mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg></div>
  <h1>Voucher Desk</h1>
  <p>Woodhouse Adventure Park staff only.</p>
  ${msg ? `<div class="msg" role="alert">${esc(msg)}</div>` : ''}
  <form method="post" action="/login">
    <input type="hidden" name="next" value="${esc(safeNext(next))}">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>`;
}
