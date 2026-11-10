import { Env, Erro, agora, aleatorio, sha256, igual, hmacHex, conferirSenha, HASH_FALSO, lerJson, texto, json, contar, registrar, chaveIp } from './util';

export const COOKIE = '__Host-taika_sessao';
const OCIOSO = 30 * 60;       // sessão expira após 30 min sem uso
const ABSOLUTO = 12 * 60 * 60; // e, de qualquer forma, 12 h após o login
const JANELA = 15 * 60;
const MAX_USUARIO = 5, MAX_IP = 30;

export interface Usuario { id: number; usuario: string; nome: string; papel: 'dono' | 'equipe'; }
export interface Sessao { usuario: Usuario; tokenHash: string; csrf: string; }
// O token CSRF é derivado do token da sessão (que só existe no cookie HttpOnly), então vale em várias abas e morre com a sessão.
const csrfDe = (token: string) => hmacHex(token, 'taika-csrf-v1');

function lerCookie(req: Request): string | null {
  for (const p of (req.headers.get('cookie') || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0 && p.slice(0, i).trim() === COOKIE) return p.slice(i + 1).trim();
  }
  return null;
}
const cookie = (valor: string, maxAge: number) => `${COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export async function sessaoAtual(req: Request, env: Env): Promise<Sessao | null> {
  const tok = lerCookie(req);
  if (!tok || tok.length < 40 || tok.length > 64 || !/^[A-Za-z0-9_-]+$/.test(tok)) return null;
  const th = await sha256(tok);
  const r = await env.DB.prepare(
    'SELECT s.csrf_hash, s.criado, s.visto, u.id, u.usuario, u.nome, u.papel, u.ativo FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?'
  ).bind(th).first<{ csrf_hash: string; criado: number; visto: number; id: number; usuario: string; nome: string; papel: 'dono' | 'equipe'; ativo: number }>();
  if (!r) return null;
  const t = agora();
  if (!r.ativo || t - r.criado > ABSOLUTO || t - r.visto > OCIOSO) {
    await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(th).run();
    return null;
  }
  if (t - r.visto > 30) await env.DB.prepare('UPDATE sessoes SET visto = ? WHERE token_hash = ?').bind(t, th).run();
  return { usuario: { id: r.id, usuario: r.usuario, nome: r.nome, papel: r.papel }, tokenHash: th, csrf: await csrfDe(tok) };
}

function mesmaOrigem(req: Request): boolean {
  const o = req.headers.get('origin');
  return !!o && o === new URL(req.url).origin;
}

/** Exige sessão válida. Em requisições que alteram dados exige também mesma origem e token CSRF. */
export async function exigir(req: Request, env: Env, papel?: 'dono'): Promise<Sessao> {
  const s = await sessaoAtual(req, env);
  if (!s) throw new Erro(401, 'Sessão expirada. Entre novamente.');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!mesmaOrigem(req)) throw new Erro(403, 'Origem não permitida.');
    const c = req.headers.get('x-csrf-token') || '';
    if (!c || !(await igual(c, s.csrf))) throw new Erro(403, 'Token CSRF inválido.');
  }
  if (papel === 'dono' && s.usuario.papel !== 'dono') throw new Erro(403, 'Apenas o dono pode fazer isso.');
  return s;
}

export async function auditar(env: Env, u: { id: number | null; usuario: string }, acao: string, alvo = '', detalhe: unknown = ''): Promise<void> {
  const d = typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe);
  await env.DB.prepare('INSERT INTO auditoria (usuario_id, usuario, acao, alvo, detalhe, em) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(u.id, u.usuario, acao, alvo, d.slice(0, 2000), agora()).run();
}

async function turnstile(req: Request, env: Env, token: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) throw new Erro(503, 'Verificação anti-robô não configurada (TURNSTILE_SECRET).');
  if (!token || token.length > 2048) return false;
  const f = new FormData();
  f.set('secret', env.TURNSTILE_SECRET);
  f.set('response', token);
  const ip = req.headers.get('cf-connecting-ip');
  if (ip) f.set('remoteip', ip);
  try {
    const r = await fetch(env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f });
    const j = await r.json<{ success?: boolean }>();
    return j.success === true;
  } catch { return false; }
}

export async function login(req: Request, env: Env): Promise<Response> {
  if (!mesmaOrigem(req)) throw new Erro(403, 'Origem não permitida.');
  const b = await lerJson(req, 8 * 1024);
  const usuario = texto(b.usuario, 'usuário', { min: 1, max: 60 }).toLowerCase();
  const senha = typeof b.senha === 'string' && b.senha.length >= 1 && b.senha.length <= 200 ? b.senha : '';
  if (!senha) throw new Erro(400, 'Preencha a senha.');
  const ku = 'login-u:' + (await sha256('u|' + usuario)).slice(0, 24), ki = await chaveIp(req, 'login-ip');
  // O bloqueio vale para qualquer nome, exista ou não, para não revelar quais contas existem.
  if ((await contar(env, ku, JANELA)) >= MAX_USUARIO || (await contar(env, ki, JANELA)) >= MAX_IP)
    throw new Erro(429, 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
  if (!(await turnstile(req, env, typeof b.turnstile === 'string' ? b.turnstile : '')))
    throw new Erro(400, 'Verificação anti-robô falhou. Recarregue a página e tente de novo.');
  const u = await env.DB.prepare('SELECT id, usuario, nome, papel, ativo, senha_hash FROM usuarios WHERE usuario = ?').bind(usuario)
    .first<{ id: number; usuario: string; nome: string; papel: 'dono' | 'equipe'; ativo: number; senha_hash: string }>();
  const senhaOk = await conferirSenha(senha, u ? u.senha_hash : HASH_FALSO);
  if (!u || !u.ativo || !senhaOk) {
    await registrar(env, ku); await registrar(env, ki);
    await auditar(env, { id: null, usuario: '-' }, 'login.falha');
    throw new Erro(401, 'Usuário ou senha inválidos.');
  }
  const token = aleatorio(32), csrf = await csrfDe(token), t = agora();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM limites WHERE chave = ?').bind(ku),
    env.DB.prepare('DELETE FROM sessoes WHERE criado < ?').bind(t - ABSOLUTO),
    env.DB.prepare('INSERT INTO sessoes (token_hash, usuario_id, csrf_hash, criado, visto) VALUES (?, ?, ?, ?, ?)').bind(await sha256(token), u.id, '', t, t)
  ]);
  await auditar(env, u, 'login');
  return json({ usuario: { usuario: u.usuario, nome: u.nome, papel: u.papel }, csrf }, 200, { 'set-cookie': cookie(token, ABSOLUTO) });
}

export async function logout(req: Request, env: Env): Promise<Response> {
  const s = await exigir(req, env);
  await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(s.tokenHash).run();
  await auditar(env, s.usuario, 'logout');
  return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
}

/** Devolve o usuário e o token CSRF da sessão (o painel pede isso ao carregar a página). */
export async function eu(req: Request, env: Env): Promise<Response> {
  const s = await sessaoAtual(req, env);
  if (!s) throw new Erro(401, 'Sessão expirada. Entre novamente.');
  return json({ usuario: s.usuario, csrf: s.csrf });
}
