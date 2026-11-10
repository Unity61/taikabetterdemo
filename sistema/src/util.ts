export interface Env {
  DB: D1Database;
  FOTOS: R2Bucket;
  ASSETS: Fetcher;
  TURNSTILE_SITEKEY: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_VERIFY_URL?: string;
  MP_ACCESS_TOKEN?: string;
  MP_WEBHOOK_SECRET?: string;
  MP_API_BASE?: string;
}

export class Erro extends Error {
  constructor(public status: number, public mensagem: string, public extra?: Record<string, unknown>) { super(mensagem); }
}

export const agora = () => Math.floor(Date.now() / 1000);

export function json(dados: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dados), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

export async function lerJson(req: Request, max = 64 * 1024): Promise<Record<string, unknown>> {
  const ct = (req.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('application/json')) throw new Erro(415, 'Envie os dados em JSON.');
  const buf = await req.arrayBuffer();
  if (buf.byteLength > max) throw new Erro(413, 'Requisição grande demais.');
  let v: unknown;
  try { v = JSON.parse(new TextDecoder().decode(buf)); } catch { throw new Erro(400, 'JSON inválido.'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Erro(400, 'JSON inválido.');
  return v as Record<string, unknown>;
}

/* ── validação de entrada ── */
// Remove caracteres de controle; o conteúdo é sempre escapado na saída, isto só evita lixo no banco.
const limpar = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
export function texto(v: unknown, campo: string, o: { min?: number; max: number; opcional?: boolean } = { max: 200 }): string {
  if (v === undefined || v === null || v === '') { if (o.opcional || !o.min) return ''; throw new Erro(400, `Preencha o campo ${campo}.`); }
  if (typeof v !== 'string') throw new Erro(400, `Campo ${campo} inválido.`);
  const s = limpar(v);
  if (s.length < (o.min || 0)) throw new Erro(400, `Preencha o campo ${campo}.`);
  if (s.length > o.max) throw new Erro(400, `Campo ${campo} longo demais (máximo ${o.max}).`);
  return s;
}
export function inteiro(v: unknown, campo: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Erro(400, `Campo ${campo} inválido.`);
  return v;
}
export function bool(v: unknown, campo: string): boolean {
  if (typeof v !== 'boolean') throw new Erro(400, `Campo ${campo} inválido.`);
  return v;
}
export function umDe<T extends string>(v: unknown, campo: string, lista: readonly T[]): T {
  if (typeof v !== 'string' || !lista.includes(v as T)) throw new Erro(400, `Campo ${campo} inválido.`);
  return v as T;
}
export function lista(v: unknown, campo: string, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw new Erro(400, `Campo ${campo} inválido.`);
  return v;
}
export function objeto(v: unknown, campo: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Erro(400, `Campo ${campo} inválido.`);
  return v as Record<string, unknown>;
}

/* ── criptografia ── */
const enc = new TextEncoder();
export const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
export const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...(b instanceof Uint8Array ? b : new Uint8Array(b))));
export const deB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export function aleatorio(bytes = 32): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return b64(a).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}
export async function hmacHex(segredo: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
/** Comparação em tempo constante (compara os hashes, então o tamanho não vaza). */
export async function igual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const p = new Uint8Array(x), q = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < p.length; i++) d |= p[i] ^ q[i];
  return d === 0;
}

export const ITERACOES = 600000;
async function pbkdf2(senha: string, sal: Uint8Array, iter: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iter }, k, 256));
}
export async function hashSenha(senha: string): Promise<string> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERACOES}$${b64(sal)}$${b64(await pbkdf2(senha, sal, ITERACOES))}`;
}
export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const p = guardado.split('$');
  if (p.length !== 4 || p[0] !== 'pbkdf2-sha256') return false;
  const iter = +p[1];
  if (!Number.isInteger(iter) || iter < 100000 || iter > 5000000) return false;
  const h = await pbkdf2(senha, deB64(p[2]), iter);
  return igual(b64(h), p[3]);
}
// Hash usado quando o usuário não existe, para o tempo de resposta ser o mesmo.
export const HASH_FALSO = `pbkdf2-sha256$${ITERACOES}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

/* ── limite de tentativas ── */
export async function chaveIp(req: Request, prefixo: string): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  return prefixo + ':' + (await sha256('ip|' + ip)).slice(0, 24);
}
export async function contar(env: Env, chave: string, janela: number): Promise<number> {
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM limites WHERE chave = ? AND em > ?').bind(chave, agora() - janela).first<{ n: number }>();
  return r?.n ?? 0;
}
export async function registrar(env: Env, chave: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO limites (chave, em) VALUES (?, ?)').bind(chave, agora()),
    env.DB.prepare('DELETE FROM limites WHERE em < ?').bind(agora() - 86400)
  ]);
}

/* ── configuração da loja ── */
export interface Horario { dia: number; ativo: boolean; abre: string; fecha: string; }
export interface Config {
  loja: { nome: string; boasVindas: string; sobre: string; telefone: string; whatsapp: boolean; fuso: string; endereco: { rua: string; bairro: string; cidade: string; uf: string; complemento: string; lat?: number; lng?: number } };
  horarios: Horario[];
  status: { modo: 'auto' | 'aberto' | 'fechado' };
  entrega: { ativa: boolean; bairros: [string, number][]; raios: [number, number][]; tempoMin: number; tempoMax: number; pedidoMinimo: number; gratisAcima: number };
  retirada: { ativa: boolean; minutos: number; descontoPct: number };
  pagamento: { dinheiro: boolean; debito: string[]; credito: string[]; online: boolean };
}
export async function lerConfig(env: Env): Promise<Config> {
  const r = await env.DB.prepare('SELECT chave, valor FROM config').all<{ chave: string; valor: string }>();
  const c: Record<string, unknown> = {};
  for (const l of r.results) c[l.chave] = JSON.parse(l.valor);
  return c as unknown as Config;
}

export function horaLocal(fuso: string, ts = Date.now()): { dia: number; min: number; data: string; offset: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: fuso, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ts));
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  const local = Date.UTC(+g('year'), +g('month') - 1, +g('day'), +g('hour'), +g('minute'), +g('second'));
  return { dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), min: +g('hour') * 60 + +g('minute'), data: `${g('year')}-${g('month')}-${g('day')}`, offset: Math.round((local - ts) / 1000) };
}
/** Início (epoch, segundos) do dia local `data` (AAAA-MM-DD) no fuso da loja. */
export function inicioDoDia(fuso: string, data: string): number {
  const [a, m, d] = data.split('-').map(Number);
  const utc = Date.UTC(a, m - 1, d) / 1000;
  return utc - horaLocal(fuso, utc * 1000).offset;
}
const minutos = (h: string) => { const p = h.split(':'); return +p[0] * 60 + +p[1]; };
export function lojaAberta(c: Config): boolean {
  if (c.status.modo === 'fechado') return false;
  if (c.status.modo === 'aberto') return true;
  const n = horaLocal(c.loja.fuso);
  const hoje = c.horarios[n.dia], ontem = c.horarios[(n.dia + 6) % 7];
  if (hoje?.ativo) { const a = minutos(hoje.abre), f = minutos(hoje.fecha); if (f > a ? n.min >= a && n.min < f : n.min >= a) return true; }
  if (ontem?.ativo) { const a = minutos(ontem.abre), f = minutos(ontem.fecha); if (f <= a && n.min < f) return true; }
  return false;
}
