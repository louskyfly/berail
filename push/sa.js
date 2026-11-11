// Jeton d'accès Google à partir du compte de service (accès admin à la base).
const crypto = require('crypto');
let cache = { t: null, exp: 0 };
module.exports = async function saToken(sa) {
  if (cache.t && cache.exp > Date.now() + 60000) return cache.t;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const body = b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(sa.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + body + '.' + sig }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('sa_token: ' + JSON.stringify(j));
  cache = { t: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cache.t;
};
