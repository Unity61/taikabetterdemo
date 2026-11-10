// Testes de segurança e de fluxo, contra um `wrangler dev` próprio (banco separado em .wrangler/teste).
// Turnstile e Mercado Pago são substituídos por um servidor falso local, então nada sai para a internet.
// Uso: npm test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = 8798, FALSO = 8799, BASE = `http://127.0.0.1:${PORTA}`, ORIGEM = BASE;
const persist = path.join(raiz, '.wrangler', 'teste'), credFile = path.join(persist, 'cred.txt');
const SEGREDO = 'segredo-webhook-de-teste';
const wr = path.join(raiz, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
let dev, falso, cred = {};
const pagamentos = new Map(); // id -> pagamento devolvido pelo Mercado Pago falso

function lerCred() { const c = {}; for (const l of fs.readFileSync(credFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) c[m[1]] = m[2]; } return c; }
async function req(metodo, caminho, o = {}) {
  const headers = { ...(o.headers || {}) };
  if (o.body !== undefined && !o.bruto) headers['content-type'] = 'application/json';
  if (o.sessao) { headers.cookie = o.sessao.cookie; if (metodo !== 'GET' && o.csrf !== false) headers['x-csrf-token'] = o.csrf || o.sessao.csrf; }
  if (metodo !== 'GET' && o.origem !== false) headers.origin = o.origem || ORIGEM;
  const r = await fetch(BASE + caminho, { method: metodo, headers, body: o.body === undefined ? undefined : o.bruto ? o.body : JSON.stringify(o.body), redirect: 'manual' });
  let j = null; const txt = await r.text(); try { j = JSON.parse(txt); } catch {}
  return { status: r.status, j, txt, headers: r.headers };
}
async function entrar(usuario, senha, turnstile = 'token-ok') {
  const r = await req('POST', '/api/admin/login', { body: { usuario, senha, turnstile } });
  if (r.status !== 200) return { r };
  const sc = r.headers.get('set-cookie');
  return { r, setCookie: sc, cookie: sc.split(';')[0], csrf: r.j.csrf };
}
const versao = async () => (await req('GET', '/api/cardapio')).j;
let DONO, EQUIPE, MENU;
const itemSimples = () => MENU.categorias.flatMap((c) => c.itens).find((i) => i.grupos.length === 0 && !i.pausado);
const itemComObrigatorio = () => MENU.categorias.flatMap((c) => c.itens).find((i) => i.grupos.length === 1 && MENU.grupos.find((g) => g.id === i.grupos[0]).min >= 1);
const pedidoBase = (extra = {}) => ({ tipo: 'entrega', bairro: MENU.entrega.bairros[0][0], endereco: 'Rua de Teste, 10', cliente: { nome: 'Cliente Teste', telefone: '91900000000' }, pagamento: 'dinheiro', itens: [{ id: itemSimples().id, q: 2, opcoes: [] }], ...extra });

before(async () => {
  fs.rmSync(persist, { recursive: true, force: true });
  execFileSync(process.execPath, [path.join(raiz, 'scripts', 'seed.mjs'), '--persist-to', persist, '--cred', credFile, '--sem-fotos'], { cwd: raiz, stdio: 'pipe' });
  cred = lerCred();
  falso = http.createServer((q, s) => {
    let corpo = ''; q.on('data', (d) => { corpo += d; }); q.on('end', () => {
      const u = new URL(q.url, 'http://x'); const ok = (o, st = 200) => { s.writeHead(st, { 'content-type': 'application/json' }); s.end(JSON.stringify(o)); };
      if (u.pathname === '/turnstile') return ok({ success: /name="response"\r\n\r\ntoken-ok\r\n/.test(corpo) });
      if (u.pathname === '/checkout/preferences') return ok({ id: 'pref', init_point: 'https://www.mercadopago.com.br/producao-nao-usar', sandbox_init_point: 'https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=teste' });
      if (u.pathname === '/v1/payments/search') return ok({ results: [...pagamentos.values()].filter((p) => p.external_reference === u.searchParams.get('external_reference')) });
      const m = u.pathname.match(/^\/v1\/payments\/([\w-]+)$/);
      if (m) return pagamentos.has(m[1]) ? ok(pagamentos.get(m[1])) : ok({ message: 'not found' }, 404);
      ok({}, 404);
    });
  }).listen(FALSO, '127.0.0.1');
  dev = spawn(process.execPath, [wr, 'dev', '--port', String(PORTA), '--persist-to', persist, '--var', `TURNSTILE_VERIFY_URL:http://127.0.0.1:${FALSO}/turnstile`, '--var', 'TURNSTILE_SECRET:segredo-turnstile-de-teste',
    '--var', 'MP_ACCESS_TOKEN:TEST-credencial-ficticia', '--var', `MP_WEBHOOK_SECRET:${SEGREDO}`, '--var', `MP_API_BASE:http://127.0.0.1:${FALSO}`], { cwd: raiz, stdio: 'ignore' });
  for (let i = 0; i < 90; i++) { try { if ((await fetch(BASE + '/api/cardapio')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); if (i === 89) throw new Error('wrangler dev não subiu'); }
  DONO = await entrar(cred.DONO_USUARIO, cred.DONO_SENHA); assert.equal(DONO.r.status, 200, 'login do dono');
  EQUIPE = await entrar(cred.EQUIPE_USUARIO, cred.EQUIPE_SENHA); assert.equal(EQUIPE.r.status, 200, 'login da equipe');
  assert.equal((await req('PUT', '/api/admin/config/status', { sessao: DONO, body: { modo: 'aberto' } })).status, 200);
  MENU = await versao();
});
after(() => {
  falso?.close();
  if (dev) { try { if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(dev.pid), '/T', '/F'], { stdio: 'ignore' }); else dev.kill('SIGKILL'); } catch {} }
});

const ROTAS_ADMIN = [
  ['GET', 'eu'], ['POST', 'logout'], ['GET', 'pedidos'], ['POST', 'pedidos/1/status', { status: 'aceito' }], ['GET', 'historico'], ['GET', 'resumo'], ['POST', 'senha', { atual: 'x', nova: 'yyyyyyyyyyyy' }],
  ['GET', 'cardapio'], ['POST', 'categorias', { nome: 'Invasão' }], ['PUT', 'categorias/1', { nome: 'Invasão' }], ['DELETE', 'categorias/1'], ['POST', 'categorias/ordem', { ids: [2, 1] }],
  ['POST', 'itens', { categoria: 1, nome: 'Invasão', preco: 1 }], ['PUT', 'itens/10684730', { categoria: 1, nome: 'Invasão', preco: 1 }], ['DELETE', 'itens/10684730'], ['POST', 'itens/ordem', { ids: [10684730] }],
  ['POST', 'itens/10684730/pausa', { pausado: true }], ['PUT', 'itens/10684730/foto'], ['DELETE', 'itens/10684730/foto'], ['POST', 'grupos', { nome: 'x', min: 0, max: 1, opcoes: [{ nome: 'a', preco: 0 }] }],
  ['PUT', 'grupos/1', { nome: 'x', min: 0, max: 1, opcoes: [{ nome: 'a', preco: 0 }] }], ['DELETE', 'grupos/1'], ['POST', 'opcoes/1/pausa', { pausado: true }], ['GET', 'config'], ['PUT', 'config/status', { modo: 'fechado' }],
  ['PUT', 'config/loja', {}], ['PUT', 'config/pagamento', {}], ['GET', 'cupons'], ['POST', 'cupons', { codigo: 'GRATIS', tipo: 'pct', valor: 100 }], ['PUT', 'cupons/1', { codigo: 'GRATIS', tipo: 'pct', valor: 100 }], ['DELETE', 'cupons/1'],
  ['GET', 'clientes'], ['GET', 'equipe'], ['POST', 'equipe', { usuario: 'invasor', nome: 'x', papel: 'dono', senha: 'senha-do-invasor-123' }], ['PUT', 'equipe/1', { nome: 'x', papel: 'dono', senha: 'senha-do-invasor-123' }], ['DELETE', 'equipe/1'],
  ['GET', 'auditoria'], ['GET', 'transacoes'], ['GET', 'rota-que-nao-existe']
];
const estado = async () => { const c = await versao(); const cfg = await req('GET', '/api/admin/config', { sessao: DONO }); const eq = await req('GET', '/api/admin/equipe', { sessao: DONO }); const cu = await req('GET', '/api/admin/cupons', { sessao: DONO }); return JSON.stringify([c.versao, cfg.j, eq.j, cu.j]); };

test('visitante lê cardápio e status da loja', async () => {
  const r = await req('GET', '/api/cardapio');
  assert.equal(r.status, 200); assert.equal(r.j.loja.aberta, true); assert.ok(r.j.categorias.length >= 19);
  assert.ok(!r.txt.includes('senha') && !r.txt.includes('pbkdf2'));
});

test('sem cookie, nenhuma rota do painel responde e nada muda', async () => {
  const antes = await estado();
  for (const [m, c, b] of ROTAS_ADMIN) {
    const r = await req(m, '/api/admin/' + c, { body: b ?? (m === 'GET' || m === 'DELETE' ? undefined : {}) });
    assert.equal(r.status, 401, `${m} ${c} sem cookie deveria dar 401, deu ${r.status}`);
  }
  assert.equal(await estado(), antes, 'os dados não podem ter mudado');
});

test('cookie forjado é recusado, mesmo com cabeçalho CSRF', async () => {
  const antes = await estado();
  const falsos = [crypto.randomBytes(32).toString('base64url'), 'a'.repeat(43), "' OR 1=1 --", DONO.cookie.split('=')[1].slice(0, -2) + 'zz'];
  for (const f of falsos) for (const [m, c, b] of ROTAS_ADMIN.filter((x) => x[1] !== 'logout')) {
    const s = { cookie: '__Host-taika_sessao=' + f, csrf: 'qualquer' };
    const r = await req(m, '/api/admin/' + c, { sessao: s, body: b ?? (m === 'GET' || m === 'DELETE' ? undefined : {}) });
    assert.equal(r.status, 401, `${m} ${c} com cookie forjado deveria dar 401, deu ${r.status}`);
  }
  assert.equal(await estado(), antes);
});

test('cookie de sessão: __Host-, HttpOnly, Secure, SameSite=Strict', () => {
  const c = DONO.setCookie;
  assert.match(c, /^__Host-taika_sessao=[A-Za-z0-9_-]{40,}/); assert.match(c, /HttpOnly/i); assert.match(c, /Secure/i); assert.match(c, /SameSite=Strict/i); assert.match(c, /Path=\//);
  assert.ok(!JSON.stringify(DONO.r.j).includes(DONO.cookie.split('=')[1]), 'o token não pode vir no corpo');
});

test('login: mesma resposta para usuário inexistente e senha errada; Turnstile obrigatório', async () => {
  const a = await req('POST', '/api/admin/login', { body: { usuario: cred.DONO_USUARIO, senha: 'senha-errada-000', turnstile: 'token-ok' } });
  const b = await req('POST', '/api/admin/login', { body: { usuario: 'nao-existe-' + Date.now(), senha: 'senha-errada-000', turnstile: 'token-ok' } });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.txt, b.txt);
  assert.equal(a.headers.get('set-cookie'), null);
  const t = await req('POST', '/api/admin/login', { body: { usuario: cred.DONO_USUARIO, senha: cred.DONO_SENHA, turnstile: 'token-ruim' } });
  assert.equal(t.status, 400, 'senha certa com Turnstile inválido não entra');
  const s = await req('POST', '/api/admin/login', { body: { usuario: cred.DONO_USUARIO, senha: cred.DONO_SENHA } });
  assert.equal(s.status, 400, 'sem token do Turnstile não entra');
  const inj = await req('POST', '/api/admin/login', { body: { usuario: "dono' OR '1'='1", senha: "' OR '1'='1", turnstile: 'token-ok' } });
  assert.equal(inj.status, 401);
  const o = await req('POST', '/api/admin/login', { body: { usuario: cred.DONO_USUARIO, senha: cred.DONO_SENHA, turnstile: 'token-ok' }, origem: 'https://site-malicioso.example' });
  assert.equal(o.status, 403, 'login vindo de outra origem é recusado');
});

test('login: bloqueio após 5 falhas, igual para conta real ou inexistente', async () => {
  for (const u of ['fantasma-' + Date.now(), 'bloqueio-real']) {
    if (u === 'bloqueio-real') assert.equal((await req('POST', '/api/admin/equipe', { sessao: DONO, body: { usuario: u, nome: 'Bloqueio', papel: 'equipe', senha: 'senha-correta-12345' } })).status, 201);
    for (let i = 0; i < 5; i++) assert.equal((await req('POST', '/api/admin/login', { body: { usuario: u, senha: 'errada-' + i, turnstile: 'token-ok' } })).status, 401);
    const r = await req('POST', '/api/admin/login', { body: { usuario: u, senha: 'senha-correta-12345', turnstile: 'token-ok' } });
    assert.equal(r.status, 429, 'a 6ª tentativa é bloqueada, mesmo com a senha certa');
  }
});

test('CSRF: sem token, token errado ou origem errada não alteram nada', async () => {
  const corpo = { modo: 'fechado' };
  assert.equal((await req('PUT', '/api/admin/config/status', { sessao: DONO, csrf: false, body: corpo })).status, 403);
  assert.equal((await req('PUT', '/api/admin/config/status', { sessao: DONO, csrf: 'errado', body: corpo })).status, 403);
  assert.equal((await req('PUT', '/api/admin/config/status', { sessao: DONO, csrf: EQUIPE.csrf, body: corpo })).status, 403, 'token CSRF de outra sessão não vale');
  assert.equal((await req('PUT', '/api/admin/config/status', { sessao: DONO, origem: 'https://site-malicioso.example', body: corpo })).status, 403);
  assert.equal((await req('PUT', '/api/admin/config/status', { sessao: DONO, origem: false, body: corpo })).status, 403);
  assert.equal((await versao()).loja.modo, 'aberto');
});

test('equipe não executa ações de dono', async () => {
  const antes = await estado();
  const proibidas = ROTAS_ADMIN.filter(([m, c]) => !['eu', 'logout', 'pedidos', 'pedidos/1/status', 'historico', 'senha', 'cardapio', 'config', 'itens/10684730/pausa', 'opcoes/1/pausa', 'rota-que-nao-existe'].includes(c) || (c === 'config' && m !== 'GET'));
  assert.ok(proibidas.length >= 25);
  for (const [m, c, b] of proibidas) {
    const r = await req(m, '/api/admin/' + c, { sessao: EQUIPE, body: b ?? (m === 'GET' || m === 'DELETE' ? undefined : {}) });
    assert.equal(r.status, 403, `equipe em ${m} ${c} deveria dar 403, deu ${r.status}`);
  }
  assert.equal(await estado(), antes);
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: EQUIPE })).status, 200);
  assert.equal((await req('POST', '/api/admin/itens/10684730/pausa', { sessao: EQUIPE, body: { pausado: false } })).status, 200);
});

test('pedido: o servidor recalcula o total e ignora preço, total e status enviados', async () => {
  const it = itemSimples(), taxa = MENU.entrega.bairros[0][1];
  const r = await req('POST', '/api/pedidos', { body: pedidoBase({ total: 1, subtotal: 1, taxa: 0, desconto: 99999, status: 'concluido', pag_status: 'pago', itens: [{ id: it.id, q: 2, opcoes: [], preco: 1, total: 1, nome: 'grátis' }] }) });
  assert.equal(r.status, 201);
  assert.equal(r.j.total, it.preco * 2 + taxa); assert.equal(r.j.status, 'novo');
  const v = await req('GET', '/api/pedidos/' + r.j.token);
  assert.equal(v.j.total, it.preco * 2 + taxa); assert.equal(v.j.status, 'novo'); assert.equal(v.j.pagStatus, 'na_entrega'); assert.equal(v.j.itens[0].nome, it.nome);
});

test('pedido: entradas inválidas são recusadas', async () => {
  const ob = itemComObrigatorio(), simples = itemSimples();
  const casos = [
    [{ itens: [] }, 400], [{ itens: [{ id: simples.id, q: 0, opcoes: [] }] }, 400], [{ itens: [{ id: simples.id, q: -3, opcoes: [] }] }, 400], [{ itens: [{ id: simples.id, q: 1.5, opcoes: [] }] }, 400],
    [{ itens: [{ id: 999999999, q: 1, opcoes: [] }] }, 409], [{ itens: [{ id: ob.id, q: 1, opcoes: [] }] }, 400], [{ itens: [{ id: simples.id, q: 1, opcoes: [1] }] }, 400],
    [{ itens: [{ id: "1; DROP TABLE pedidos", q: 1, opcoes: [] }] }, 400], [{ bairro: 'Bairro Inventado' }, 400], [{ pagamento: 'fiado' }, 400], [{ tipo: 'teletransporte' }, 400],
    [{ cliente: { nome: 'A', telefone: '1' } }, 400], [{ cupom: 'NAOEXISTE' }, 400], [{ pagamento: 'dinheiro', troco: 1 }, 400], [{ endereco: '' }, 400]
  ];
  for (const [extra, st] of casos) { const r = await req('POST', '/api/pedidos', { body: pedidoBase(extra) }); assert.equal(r.status, st, JSON.stringify(extra) + ' → ' + r.status + ' ' + r.txt); }
  const txt = await req('POST', '/api/pedidos', { body: 'itens=1', bruto: true, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(txt.status, 415, 'formulário simples (sem preflight) não é aceito');
});

test('cupom é validado e calculado no servidor', async () => {
  const it = MENU.categorias.flatMap((c) => c.itens).filter((i) => i.grupos.length === 0).sort((a, b) => b.preco - a.preco)[0];
  const q = Math.ceil(5000 / it.preco), sub = it.preco * q, taxa = MENU.entrega.bairros[0][1];
  const r = await req('POST', '/api/pedidos', { body: pedidoBase({ cupom: 'taika10', desconto: sub, itens: [{ id: it.id, q, opcoes: [] }] }) });
  assert.equal(r.status, 201); assert.equal(r.j.desconto, Math.round(sub * 0.1)); assert.equal(r.j.total, sub - Math.round(sub * 0.1) + taxa);
});

test('status do pedido: só com o token do próprio pedido', async () => {
  const a = await req('POST', '/api/pedidos', { body: pedidoBase() }), b = await req('POST', '/api/pedidos', { body: pedidoBase({ cliente: { nome: 'Outra Pessoa', telefone: '91911112222' } }) });
  assert.ok(a.j.token.length >= 30 && a.j.token !== b.j.token);
  const va = await req('GET', '/api/pedidos/' + a.j.token);
  assert.equal(va.status, 200); assert.ok(!va.txt.includes('Outra Pessoa') && !va.txt.includes('91911112222'));
  for (const t of [String(a.j.numero), String(b.j.numero), 'x'.repeat(32), a.j.token.slice(0, -1) + (a.j.token.endsWith('A') ? 'B' : 'A'), '../admin/pedidos'])
    assert.equal((await req('GET', '/api/pedidos/' + encodeURIComponent(t))).status, 404);
  assert.equal((await req('POST', '/api/pedidos/' + a.j.token + '/status', { body: { status: 'concluido' } })).status, 404, 'cliente não muda status');
});

test('fluxo: pedido aparece no painel, é aceito e o cliente vê cada mudança', async () => {
  const p = await req('POST', '/api/pedidos', { body: pedidoBase({ tipo: 'retirada', bairro: undefined, endereco: undefined, pagamento: 'debito', obs: 'Sem cebolinha' }) });
  assert.equal(p.status, 201);
  const lista = await req('GET', '/api/admin/pedidos', { sessao: EQUIPE });
  const visto = lista.j.pedidos.find((x) => x.id === p.j.numero);
  assert.ok(visto, 'o pedido aparece no painel'); assert.equal(visto.status, 'novo'); assert.equal(visto.obs, 'Sem cebolinha'); assert.equal(visto.total, p.j.total);
  const st = (s, extra = {}) => req('POST', `/api/admin/pedidos/${p.j.numero}/status`, { sessao: EQUIPE, body: { status: s, ...extra } });
  assert.equal((await st('concluido')).status, 409, 'não pula etapas');
  assert.equal((await st('recusado')).status, 400, 'recusar exige motivo');
  for (const s of ['aceito', 'em_preparo']) { assert.equal((await st(s)).status, 200); assert.equal((await req('GET', '/api/pedidos/' + p.j.token)).j.status, s); }
  assert.equal((await st('saiu_entrega')).status, 409, 'pedido de retirada não sai para entrega');
  for (const s of ['pronto_retirada', 'concluido']) { assert.equal((await st(s)).status, 200); assert.equal((await req('GET', '/api/pedidos/' + p.j.token)).j.status, s); }
  assert.equal((await st('cancelado', { motivo: 'teste' })).status, 409, 'pedido concluído não muda mais');
  const r2 = await req('POST', '/api/pedidos', { body: pedidoBase() });
  assert.equal((await req('POST', `/api/admin/pedidos/${r2.j.numero}/status`, { sessao: DONO, body: { status: 'recusado', motivo: 'Item em falta' } })).status, 200);
  const v2 = (await req('GET', '/api/pedidos/' + r2.j.token)).j;
  assert.equal(v2.status, 'recusado'); assert.equal(v2.motivo, 'Item em falta');
});

test('editar preço, pausar item e fechar a loja refletem no site e nos pedidos', async () => {
  const it = itemSimples(), cat = MENU.categorias.find((c) => c.itens.some((i) => i.id === it.id));
  assert.equal((await req('PUT', '/api/admin/itens/' + it.id, { sessao: DONO, body: { categoria: cat.id, nome: it.nome, desc: it.desc, preco: it.preco + 150, grupos: [] } })).status, 200);
  const acha = async () => (await versao()).categorias.flatMap((c) => c.itens).find((i) => i.id === it.id);
  assert.equal((await acha()).preco, it.preco + 150);
  assert.equal((await req('POST', '/api/pedidos', { body: pedidoBase({ itens: [{ id: it.id, q: 1, opcoes: [] }] }) })).j.subtotal, it.preco + 150);
  assert.equal((await req('PUT', '/api/admin/itens/' + it.id, { sessao: DONO, body: { categoria: cat.id, nome: it.nome, desc: it.desc, preco: it.preco, grupos: [] } })).status, 200);
  assert.equal((await req('PUT', '/api/admin/itens/' + it.id, { sessao: DONO, body: { categoria: cat.id, nome: it.nome, preco: -5, grupos: [] } })).status, 400);
  assert.equal((await req('POST', `/api/admin/itens/${it.id}/pausa`, { sessao: EQUIPE, body: { pausado: true } })).status, 200);
  assert.equal((await acha()).pausado, true);
  assert.equal((await req('POST', '/api/pedidos', { body: pedidoBase({ itens: [{ id: it.id, q: 1, opcoes: [] }] }) })).status, 409, 'item esgotado não pode ser pedido');
  assert.equal((await req('POST', `/api/admin/itens/${it.id}/pausa`, { sessao: EQUIPE, body: { pausado: false } })).status, 200);
  assert.equal((await req('PUT', '/api/admin/config/status', { sessao: DONO, body: { modo: 'fechado' } })).status, 200);
  assert.equal((await versao()).loja.aberta, false);
  assert.equal((await req('POST', '/api/pedidos', { body: pedidoBase() })).status, 409, 'loja fechada não recebe pedido');
  assert.equal((await req('PUT', '/api/admin/config/status', { sessao: DONO, body: { modo: 'aberto' } })).status, 200);
});

const assinar = (id, ts, rid, segredo = SEGREDO) => crypto.createHmac('sha256', segredo).update(`id:${id};request-id:${rid};ts:${ts};`).digest('hex');
const notificar = (id, ts, rid, v1) => req('POST', `/api/pagamentos/webhook?data.id=${id}&type=payment`, { body: { type: 'payment', data: { id } }, origem: false, headers: { 'x-request-id': rid, ...(v1 === null ? {} : { 'x-signature': `ts=${ts},v1=${v1}` }) } });
test('pagamento online: só o webhook assinado e conferido na API marca como pago', async () => {
  const p = await req('POST', '/api/pedidos', { body: pedidoBase({ pagamento: 'online' }) });
  assert.equal(p.status, 201); assert.equal(p.j.status, 'aguardando_pagamento');
  assert.match(p.j.pagamento.url, /^https:\/\/sandbox\.mercadopago/, 'usa o endereço de sandbox, nunca o de produção');
  const ver = async () => (await req('GET', '/api/pedidos/' + p.j.token)).j;
  const ref = async () => { const h = await req('GET', '/api/admin/transacoes', { sessao: DONO }); return h.j.transacoes.find((t) => t.id === p.j.numero); };
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: DONO })).j.pedidos.some((x) => x.id === p.j.numero), false, 'pedido sem pagamento não entra na fila');
  assert.equal((await req('POST', `/api/pedidos/${p.j.token}/pagamento-simulado`, { body: {} })).status, 403, 'com credenciais configuradas não existe pagamento simulado');
  assert.equal((await req('POST', `/api/pedidos/${p.j.token}/conferir-pagamento`, { body: { pago: true, status: 'approved' } })).j.pagStatus, 'pendente', 'o navegador dizer "paguei" não muda nada');
  const ts = () => String(Date.now());
  assert.equal((await notificar('111', ts(), 'r1', null)).status, 401, 'sem assinatura');
  assert.equal((await notificar('111', ts(), 'r2', 'a'.repeat(64))).status, 401, 'assinatura inventada');
  let t = ts(); assert.equal((await notificar('111', t, 'r3', assinar('111', t, 'r3', 'outro-segredo'))).status, 401, 'assinada com outro segredo');
  t = ts(); assert.equal((await notificar('111', t, 'r4', assinar('222', t, 'r4'))).status, 401, 'assinatura de outro pagamento');
  const velho = String(Date.now() - 3600e3); assert.equal((await notificar('111', velho, 'r5', assinar('111', velho, 'r5'))).status, 401, 'notificação antiga');
  assert.equal((await ver()).status, 'aguardando_pagamento');
  // Assinatura válida, mas a API do Mercado Pago diz outra coisa: nada muda.
  const refPedido = crypto.randomBytes(4).toString('hex');
  pagamentos.set('111', { id: 111, status: 'approved', external_reference: 'ref-de-outro-pedido-' + refPedido, transaction_amount: p.j.total / 100, currency_id: 'BRL' });
  t = ts(); let r = await notificar('111', t, 'r6', assinar('111', t, 'r6')); assert.equal(r.status, 200); assert.equal(r.j.pago, false);
  assert.equal((await ver()).pagStatus, 'pendente');
  // Para os casos seguintes o teste precisa da referência real do pedido: o servidor a envia ao Mercado Pago, então o falso a devolve na busca.
  const real = await descobrirRef(p.j.total);
  pagamentos.set('112', { id: 112, status: 'pending', external_reference: real, transaction_amount: p.j.total / 100, currency_id: 'BRL' });
  t = ts(); r = await notificar('112', t, 'r7', assinar('112', t, 'r7')); assert.equal(r.j.pago, false, 'pagamento não aprovado');
  pagamentos.set('113', { id: 113, status: 'approved', external_reference: real, transaction_amount: 0.01, currency_id: 'BRL' });
  t = ts(); r = await notificar('113', t, 'r8', assinar('113', t, 'r8')); assert.equal(r.j.pago, false, 'valor pago diferente do total do pedido');
  assert.equal((await ver()).status, 'aguardando_pagamento');
  pagamentos.set('114', { id: 114, status: 'approved', external_reference: real, transaction_amount: p.j.total / 100, currency_id: 'BRL', payment_type_id: 'bank_transfer' });
  t = ts(); const v1 = assinar('114', t, 'r9'); r = await notificar('114', t, 'r9', v1);
  assert.equal(r.status, 200); assert.equal(r.j.pago, true);
  const fim = await ver(); assert.equal(fim.status, 'novo'); assert.equal(fim.pagStatus, 'pago');
  assert.equal((await ref()).pag_id, '114');
  assert.equal((await notificar('114', t, 'r9', v1)).status, 409, 'a mesma notificação repetida é recusada');
  assert.ok((await req('GET', '/api/admin/pedidos', { sessao: DONO })).j.pedidos.some((x) => x.id === p.j.numero), 'depois de pago, entra na fila');
});
// O Mercado Pago falso guarda a última external_reference recebida em /checkout/preferences? Não: lemos do próprio banco de teste via API de busca.
async function descobrirRef(total) {
  // A referência não é exposta por nenhuma rota pública (de propósito). No teste, lemos direto do banco local.
  const out = execFileSync(process.execPath, [wr, 'd1', 'execute', 'taika', '--local', '--persist-to', persist, '--json', '--command', `SELECT ref FROM pedidos WHERE pagamento = 'online' AND total = ${Number(total)} ORDER BY id DESC LIMIT 1`], { cwd: raiz, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  return JSON.parse(out.slice(out.indexOf('[')))[0].results[0].ref;
}

test('upload de foto: tipo e tamanho são conferidos pelo conteúdo', async () => {
  const it = itemSimples();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const env = (corpo, tipo, sessao = DONO) => req('PUT', `/api/admin/itens/${it.id}/foto`, { sessao, body: corpo, bruto: true, headers: { 'content-type': tipo } });
  assert.equal((await env(Buffer.from('<script>alert(1)</script>'), 'image/png')).status, 415, 'HTML disfarçado de PNG');
  assert.equal((await env(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml')).status, 415, 'SVG não é aceito');
  assert.equal((await env(png, 'image/jpeg')).status, 415, 'tipo declarado diferente do conteúdo');
  assert.equal((await env(Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]), 'image/png')).status, 413, 'acima de 2 MB');
  assert.equal((await env(png, 'image/png', EQUIPE)).status, 403);
  const ok = await env(png, 'image/png'); assert.equal(ok.status, 200);
  const f = await fetch(BASE + ok.j.foto); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/png'); assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await req('DELETE', `/api/admin/itens/${it.id}/foto`, { sessao: DONO })).status, 200);
  assert.equal((await fetch(BASE + ok.j.foto)).status, 404, 'foto removida some do armazenamento');
  assert.equal((await fetch(BASE + '/api/fotos/..%2F..%2Fsegredo')).status, 404);
});

test('busca do histórico usa parâmetros, não concatena SQL', async () => {
  for (const q of ["' OR 1=1 --", '%', "x'; DROP TABLE pedidos; --", '_']) {
    const r = await req('GET', '/api/admin/historico?q=' + encodeURIComponent(q), { sessao: DONO });
    assert.equal(r.status, 200); assert.equal(r.j.total, 0, `busca por ${q} não pode casar com tudo`);
  }
  assert.ok((await req('GET', '/api/admin/historico', { sessao: DONO })).j.total > 0, 'a tabela continua lá');
  assert.ok((await req('GET', '/api/admin/historico?q=Cliente%20Teste&status=concluido&tipo=retirada', { sessao: DONO })).j.total >= 1);
});

test('cabeçalhos de segurança e painel fora do site público', async () => {
  const p = await fetch(BASE + '/painel/'), s = await fetch(BASE + '/'), a = await fetch(BASE + '/api/cardapio');
  const csp = p.headers.get('content-security-policy');
  assert.ok(csp.includes("default-src 'none'") && csp.includes("frame-ancestors 'none'") && !csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  assert.match(p.headers.get('x-robots-tag'), /noindex/); assert.equal(p.headers.get('cache-control'), 'no-store');
  for (const r of [p, s, a]) { assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'DENY'); assert.ok(r.headers.get('strict-transport-security')); assert.ok(r.headers.get('content-security-policy')); }
  assert.ok(s.headers.get('content-security-policy').includes("script-src 'self'") && !/script-src[^;]*unsafe-inline/.test(s.headers.get('content-security-policy')));
  assert.equal(a.headers.get('access-control-allow-origin'), null, 'sem CORS aberto');
  const pub = path.join(raiz, 'public');
  for (const f of ['index.html', 'site.js', 'site.css']) assert.ok(!/\/painel|painel\/|painel\.(js|css)/i.test(fs.readFileSync(path.join(pub, f), 'utf8')), f + ' não pode ter link ou caminho para o painel');
  assert.ok(/<meta name="robots" content="noindex/.test(fs.readFileSync(path.join(pub, 'painel', 'index.html'), 'utf8')));
  assert.equal((await fetch(BASE + '/', { method: 'POST' })).status, 405);
});

test('auditoria registra quem fez o quê, sem senhas nem tokens', async () => {
  const r = await req('GET', '/api/admin/auditoria', { sessao: DONO });
  assert.equal(r.status, 200);
  const acoes = new Set(r.j.registros.map((x) => x.acao));
  for (const a of ['login', 'login.falha', 'pedido.status', 'item.preco', 'item.pausar', 'config.status', 'item.foto', 'equipe.criar']) assert.ok(acoes.has(a), 'falta registro de ' + a);
  const ped = r.j.registros.find((x) => x.acao === 'pedido.status'); assert.ok(ped.usuario && ped.em && ped.alvo.startsWith('#'));
  for (const segredo of [cred.DONO_SENHA, cred.EQUIPE_SENHA, DONO.cookie.split('=')[1], DONO.csrf, 'senha-correta-12345', 'pbkdf2']) assert.ok(!r.txt.includes(segredo), 'a auditoria não pode conter segredos');
});

test('trocar senha e desativar conta derrubam as sessões; logout invalida de verdade', async () => {
  assert.equal((await req('POST', '/api/admin/equipe', { sessao: DONO, body: { usuario: 'temporario', nome: 'Temp', papel: 'equipe', senha: 'senha-temporaria-1' } })).status, 201);
  const eq = (await req('GET', '/api/admin/equipe', { sessao: DONO })).j.equipe.find((u) => u.usuario === 'temporario');
  const t1 = await entrar('temporario', 'senha-temporaria-1'); assert.equal(t1.r.status, 200);
  assert.equal((await req('PUT', '/api/admin/equipe/' + eq.id, { sessao: DONO, body: { nome: 'Temp', papel: 'equipe', ativo: true, senha: 'senha-temporaria-2' } })).status, 200);
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: t1 })).status, 401, 'a sessão antiga cai quando a senha muda');
  const t2 = await entrar('temporario', 'senha-temporaria-2'); assert.equal(t2.r.status, 200);
  assert.equal((await req('PUT', '/api/admin/equipe/' + eq.id, { sessao: DONO, body: { nome: 'Temp', papel: 'equipe', ativo: false } })).status, 200);
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: t2 })).status, 401, 'conta desativada perde o acesso na hora');
  assert.equal((await entrar('temporario', 'senha-temporaria-2')).r.status, 401);
  assert.equal((await req('DELETE', '/api/admin/equipe/' + eq.id, { sessao: DONO })).status, 200);
  const eu = (await req('GET', '/api/admin/equipe', { sessao: DONO })).j.equipe.find((u) => u.usuario === cred.DONO_USUARIO);
  assert.equal((await req('PUT', '/api/admin/equipe/' + eu.id, { sessao: DONO, body: { nome: 'x', papel: 'equipe', ativo: true } })).status, 409, 'o dono não se rebaixa');
  const s = await entrar(cred.EQUIPE_USUARIO, cred.EQUIPE_SENHA);
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: s })).status, 200);
  assert.equal((await req('POST', '/api/admin/logout', { sessao: s, body: {} })).status, 200);
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: s })).status, 401, 'cookie antigo não vale depois do logout');
});

test('sessão expira por inatividade e por tempo total', async () => {
  const s1 = await entrar(cred.EQUIPE_USUARIO, cred.EQUIPE_SENHA), s2 = await entrar(cred.EQUIPE_USUARIO, cred.EQUIPE_SENHA);
  const hash = (s) => crypto.createHash('sha256').update(s.cookie.split('=')[1]).digest('hex');
  const sql = (c) => execFileSync(process.execPath, [wr, 'd1', 'execute', 'taika', '--local', '--persist-to', persist, '--command', c], { cwd: raiz, stdio: 'ignore' });
  const agora = Math.floor(Date.now() / 1000);
  sql(`UPDATE sessoes SET visto = ${agora - 31 * 60} WHERE token_hash = '${hash(s1)}'`);
  sql(`UPDATE sessoes SET criado = ${agora - 12 * 3600 - 60} WHERE token_hash = '${hash(s2)}'`);
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: s1 })).status, 401, '31 min sem uso');
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: s2 })).status, 401, 'mais de 12 h desde o login');
  assert.equal((await req('GET', '/api/admin/pedidos', { sessao: EQUIPE })).status, 200, 'sessão normal continua valendo');
});
