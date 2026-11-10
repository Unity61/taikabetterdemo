// Ferramenta de desenvolvimento: faz uma chamada à API do painel local como dono ou equipe.
// Lê as credenciais de ../credenciais-demo.txt e nunca as imprime.
// Uso: node tests/api-painel.mjs [--equipe] <MÉTODO> <caminho> [json]
import fs from 'node:fs';
const args = process.argv.slice(2), equipe = args[0] === '--equipe' ? !!args.shift() : false;
const [metodo, caminho, corpo] = args, BASE = process.env.TAIKA_URL || 'http://127.0.0.1:8787';
const c = {}; for (const l of fs.readFileSync(new URL('../../credenciais-demo.txt', import.meta.url), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) c[m[1]] = m[2]; }
const p = equipe ? 'EQUIPE' : 'DONO';
const l = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ usuario: c[p + '_USUARIO'], senha: c[p + '_SENHA'], turnstile: 'XXXX.DUMMY.TOKEN.XXXX' }) });
if (!l.ok) { console.error('login falhou:', l.status, (await l.json()).erro); process.exit(1); }
const cookie = l.headers.get('set-cookie').split(';')[0], { csrf } = await l.json();
const h = { cookie, origin: BASE, 'x-csrf-token': csrf, ...(corpo ? { 'content-type': 'application/json' } : {}) };
const r = await fetch(BASE + '/api/admin/' + caminho, { method: metodo, headers: h, body: corpo });
console.log(r.status, JSON.stringify(await r.json().catch(() => null)).slice(0, +(process.env.MAX || 600)));
await fetch(BASE + '/api/admin/logout', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' });
