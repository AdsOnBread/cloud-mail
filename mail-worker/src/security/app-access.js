import jwtUtils from '../utils/jwt-utils';

const COOKIE = '__Host-cloudmail_access';
const localCookie = 'cloudmail_access_local';
const lifetime = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

export async function equalSecret(a, b) {
	if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
	const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', encoder.encode(s))));
	return crypto.subtle.timingSafeEqual(x, y);
}

function cookieName(url) { return url.protocol === 'https:' ? COOKIE : localCookie; }
function signingContext(env) { return { env: { jwt_secret: env.app_access_secret } }; }
function error(message, code, status = 403) {
	return Response.json({ code: status, error: code, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function allowedOrigin(req, env) {
	const origin = req.headers.get('Origin');
	const allowed = (env.browser_origins || '').split(',').map(s => s.trim()).filter(Boolean);
	return !origin || origin === new URL(req.url).origin || allowed.includes(origin);
}

// D1 makes the counter atomic across isolates. It also works before initial schema setup.
export async function rateLimit(req, env, scope) {
	const ip = req.headers.get('CF-Connecting-IP') || 'local';
	const hash = await crypto.subtle.digest('SHA-256', encoder.encode(`${scope}:${ip}`));
	const key = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
	const bucket = Math.floor(Date.now() / 60000);
	await env.db.prepare('CREATE TABLE IF NOT EXISTS app_auth_limits (key TEXT PRIMARY KEY, bucket INTEGER NOT NULL, count INTEGER NOT NULL)').run();
	const row = await env.db.prepare(`INSERT INTO app_auth_limits(key,bucket,count) VALUES (?,?,1)
		ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,
		count=CASE WHEN bucket=excluded.bucket THEN count+1 ELSE 1 END RETURNING count`).bind(key, bucket).first();
	return row.count <= 10;
}

export async function hasAppAccess(req, env) {
	if (!env.app_access_secret) return false;
	if (await equalSecret(req.headers.get('X-Cloudmail-App-Secret'), env.app_access_secret)) return true;
	const name = cookieName(new URL(req.url));
	const raw = (req.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
	if (!raw) return false;
	const token = await jwtUtils.verifyToken(signingContext(env), raw);
	return token?.purpose === 'installation-access' && Number.isFinite(token.exp) && token.exp > Date.now() / 1000;
}

export async function accessGate(req, env) {
	const url = new URL(req.url);
	if (!allowedOrigin(req, env)) return error('This browser origin is not allowed.', 'ORIGIN_NOT_ALLOWED');
	if (req.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: {
			'Access-Control-Allow-Origin': req.headers.get('Origin') || url.origin,
			'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Cloudmail-App-Secret, X-Cloudmail-Init-Secret',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Vary': 'Origin'
		} });
	}
	if (url.pathname === '/unlock' && req.method === 'GET') return unlockPage();
	if (!env.app_access_secret) return error('Installation access is not configured. Set app_access_secret before using Cloudmail.', 'APP_ACCESS_UNCONFIGURED', 503);
	if (url.pathname === '/api/access/unlock' && req.method === 'POST') {
		if (!await rateLimit(req, env, 'unlock')) return error('Too many attempts. Try again in a minute.', 'RATE_LIMITED', 429);
		if (Number(req.headers.get('Content-Length') || 0) > 4096) return error('Request is too large.', 'INVALID_REQUEST', 413);
		let secret;
		try {
			const reader=req.body?.getReader(); const chunks=[]; let length=0;
			if (!reader) return error('Enter the installation secret.', 'INVALID_REQUEST', 400);
			while (true) { const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();return error('Request is too large.','INVALID_REQUEST',413);}chunks.push(value); }
			const buffer=new Uint8Array(length);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
			secret=JSON.parse(new TextDecoder().decode(buffer)).secret;
		} catch { return error('Enter the installation secret.', 'INVALID_REQUEST', 400); }
		if (!await equalSecret(secret, env.app_access_secret)) return error('Incorrect installation secret.', 'APP_ACCESS_REQUIRED');
		const jwt = await jwtUtils.generateToken(signingContext(env), { purpose: 'installation-access' }, lifetime);
		return Response.json({ code: 200, data: { unlocked: true } }, { headers: {
			'Set-Cookie': `${cookieName(url)}=${jwt}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime}${url.protocol === 'https:' ? '; Secure' : ''}`,
			'Cache-Control': 'no-store'
		} });
	}
	if (!await hasAppAccess(req, env)) {
		if (!url.pathname.startsWith('/api/') && req.method === 'GET') return Response.redirect(url.origin + '/unlock', 302);
		return error('Unlock this Cloudmail installation.', 'APP_ACCESS_REQUIRED');
	}
	if (url.pathname === '/api/access/status') return Response.json({ code: 200, data: { unlocked: true } }, { headers: { 'Cache-Control': 'no-store' } });
	if (url.pathname === '/api/login' && !await rateLimit(req, env, 'login')) return error('Too many sign-in attempts. Try again in a minute.', 'RATE_LIMITED', 429);
	return null;
}

function unlockPage() {
	return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlock Cloudmail</title>
	<style>html{color-scheme:light dark;font:17px system-ui;background:light-dark(#f2f2f7,#111)}body{min-height:90vh;display:grid;place-items:center;margin:20px}main{max-width:340px;width:100%;padding:32px;border-radius:24px;background:light-dark(white,#222);box-shadow:0 12px 60px #0001}h1{letter-spacing:-1px}input,button{box-sizing:border-box;width:100%;font:inherit;padding:14px;border-radius:12px;margin-top:14px;border:1px solid #8885}button{background:#007aff;color:white;border:0;cursor:pointer}p{color:light-dark(#555,#aaa);line-height:1.5}#error{color:light-dark(#b42318,#ff8e85);min-height:24px}</style>
	<main><div aria-hidden="true" style="font-size:40px">✉</div><h1>Cloudmail</h1><p>Enter your installation secret to continue. Then sign in to your own mailbox.</p><form><label for="secret">Installation secret</label><input id="secret" type="password" autocomplete="off" required maxlength="512" autofocus><button>Unlock Cloudmail</button><p id="error" role="alert"></p></form></main>
	<script>document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const b=document.querySelector('button');b.disabled=true;try{const r=await fetch('/api/access/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:document.querySelector('input').value})});const d=await r.json();if(!r.ok)throw Error(d.message);location.replace('/')}catch(e){document.querySelector('#error').textContent=e.message}finally{b.disabled=false}})</script></html>`, { headers: {
		'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
		'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
		'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
	} });
}
