import { Env, Erro, agora, json, hmacHex, igual } from './util';
import { pedidoPorToken } from './publico';

const API = 'https://api.mercadopago.com';
const base = (env: Env) => (env.MP_API_BASE || API).replace(/\/+$/, '');

/**
 * mercadopago: credencial de TESTE. Vale o prefixo TEST- ou uma credencial APP_USR- de uma conta de teste
 * (vendedor de teste), confirmada na própria API pela tag "test_user". simulado: nenhuma credencial.
 * bloqueado: há uma credencial que não é de teste (ou não deu para confirmar); este projeto se recusa a usá-la.
 */
type Modo = 'mercadopago' | 'simulado' | 'bloqueado';
const contasTeste = new Map<string, boolean>();

async function contaDeTeste(env: Env, t: string): Promise<boolean | null> {
  const chave = base(env) + ' ' + t;
  if (contasTeste.has(chave)) return contasTeste.get(chave)!;
  try {
    const r = await fetch(base(env) + '/users/me', { headers: { authorization: 'Bearer ' + t } });
    if (r.status === 401 || r.status === 403) { contasTeste.set(chave, false); return false; }
    if (!r.ok) return null;
    const u = await r.json<{ tags?: unknown }>();
    const teste = Array.isArray(u.tags) && u.tags.includes('test_user');
    contasTeste.set(chave, teste);
    return teste;
  } catch { return null; }
}

export async function modoOnline(env: Env): Promise<Modo> {
  const t = (env.MP_ACCESS_TOKEN || '').trim();
  if (!t) return 'simulado';
  if (t.startsWith('TEST-')) return 'mercadopago';
  if (t.startsWith('APP_USR-') && (await contaDeTeste(env, t)) === true) return 'mercadopago';
  return 'bloqueado';
}

async function mp<T>(env: Env, caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(base(env) + caminho, { ...init, headers: { authorization: 'Bearer ' + env.MP_ACCESS_TOKEN!.trim(), 'content-type': 'application/json', ...(init?.headers || {}) } });
  if (!r.ok) throw new Erro(502, 'O Mercado Pago não respondeu como esperado.');
  return r.json<T>();
}

export async function criarPreferencia(env: Env, req: Request, p: { id: number; ref: string; total: number }): Promise<string> {
  const origem = new URL(req.url).origin;
  const corpo: Record<string, unknown> = {
    items: [{ title: `Pedido nº ${p.id} · Taika Sushi`, quantity: 1, currency_id: 'BRL', unit_price: p.total / 100 }],
    external_reference: p.ref,
    back_urls: { success: origem + '/?pagamento=retorno', pending: origem + '/?pagamento=retorno', failure: origem + '/?pagamento=retorno' },
    payment_methods: { installments: 1 },
    statement_descriptor: 'TAIKA SUSHI'
  };
  // O Mercado Pago só aceita URL pública para notificações; em localhost a confirmação é feita pela consulta em conferirPagamento.
  if (origem.startsWith('https://')) corpo.notification_url = origem + '/api/pagamentos/webhook';
  const r = await mp<{ sandbox_init_point?: string }>(env, '/checkout/preferences', { method: 'POST', body: JSON.stringify(corpo), headers: { 'x-idempotency-key': p.ref } });
  if (!r.sandbox_init_point || !/^https:\/\//.test(r.sandbox_init_point)) throw new Erro(502, 'Preferência sem endereço de sandbox.');
  return r.sandbox_init_point;
}

interface Pagamento { id: number | string; status: string; external_reference?: string; transaction_amount?: number; currency_id?: string; payment_type_id?: string; }

/** Só marca como pago se o pagamento, lido direto da API, estiver aprovado, em BRL e com o valor exato do pedido. */
async function aplicar(env: Env, pg: Pagamento): Promise<boolean> {
  if (pg.status !== 'approved' || !pg.external_reference || pg.currency_id !== 'BRL' || typeof pg.transaction_amount !== 'number') return false;
  const p = await env.DB.prepare("SELECT id, total, pag_status FROM pedidos WHERE ref = ? AND pagamento = 'online'").bind(pg.external_reference).first<{ id: number; total: number; pag_status: string }>();
  if (!p || Math.round(pg.transaction_amount * 100) !== p.total) return false;
  if (p.pag_status === 'pago') return true;
  return marcarPago(env, p.id, 'pago', String(pg.id), pg.payment_type_id || '');
}

async function marcarPago(env: Env, id: number, como: 'pago' | 'simulado', pagId: string, metodo: string): Promise<boolean> {
  const t = agora();
  const r = await env.DB.prepare("UPDATE pedidos SET pag_status = ?, pag_id = ?, pag_metodo = ?, status = 'novo', criado = ?, atualizado = ? WHERE id = ? AND pag_status = 'pendente' AND status = 'aguardando_pagamento'")
    .bind(como, pagId, metodo, t, t, id).run();
  if (!r.meta.changes) return false;
  await env.DB.prepare("INSERT INTO pedido_eventos (pedido_id, status, usuario, em) VALUES (?, 'novo', NULL, ?)").bind(id, t).run();
  return true;
}

/** Chamado pelo site quando o cliente volta do checkout: o servidor consulta o Mercado Pago, nunca confia no navegador. */
export async function conferirPagamento(env: Env, token: string): Promise<Response> {
  const p = await pedidoPorToken(env, token);
  if (p.pagamento !== 'online') throw new Erro(400, 'Este pedido não é pago online.');
  if (p.pag_status !== 'pendente') return json({ pagStatus: p.pag_status });
  if ((await modoOnline(env)) !== 'mercadopago') throw new Erro(409, 'Pagamento online não configurado.');
  const r = await mp<{ results?: Pagamento[] }>(env, '/v1/payments/search?sort=date_created&criteria=desc&external_reference=' + encodeURIComponent(p.ref));
  for (const pg of r.results || []) if (pg.external_reference === p.ref && (await aplicar(env, pg))) return json({ pagStatus: 'pago' });
  return json({ pagStatus: 'pendente' });
}

export async function novoLink(env: Env, req: Request, token: string): Promise<Response> {
  const p = await pedidoPorToken(env, token);
  if (p.pagamento !== 'online' || p.pag_status !== 'pendente' || p.status !== 'aguardando_pagamento') throw new Erro(409, 'Este pedido não está aguardando pagamento.');
  if ((await modoOnline(env)) !== 'mercadopago') throw new Erro(409, 'Pagamento online não configurado.');
  return json({ url: await criarPreferencia(env, req, { id: p.id, ref: p.ref, total: p.total }) });
}

/** Só existe quando não há credenciais do Mercado Pago. O pedido fica marcado como "simulado", nunca como "pago". */
export async function pagamentoSimulado(env: Env, token: string): Promise<Response> {
  if ((await modoOnline(env)) !== 'simulado') throw new Erro(403, 'Pagamento simulado indisponível: há credenciais do Mercado Pago configuradas.');
  const p = await pedidoPorToken(env, token);
  if (p.pagamento !== 'online' || p.pag_status !== 'pendente') throw new Erro(409, 'Este pedido não está aguardando pagamento.');
  await marcarPago(env, p.id, 'simulado', 'simulado', 'simulado');
  return json({ pagStatus: 'simulado' });
}

/** Notificação do Mercado Pago: valida a assinatura, recusa repetições e confirma o pagamento na API antes de qualquer mudança. */
export async function webhook(req: Request, env: Env): Promise<Response> {
  const segredo = (env.MP_WEBHOOK_SECRET || '').trim();
  if (!segredo || (await modoOnline(env)) !== 'mercadopago') throw new Erro(503, 'Webhook não configurado.');
  const url = new URL(req.url);
  const bruto = await req.text();
  if (bruto.length > 16384) throw new Erro(413, 'Requisição grande demais.');
  let corpo: { type?: string; data?: { id?: string | number } } = {};
  try { corpo = bruto ? JSON.parse(bruto) : {}; } catch { throw new Erro(400, 'JSON inválido.'); }
  const dataId = String(url.searchParams.get('data.id') ?? corpo?.data?.id ?? '');
  const reqId = req.headers.get('x-request-id') || '';
  const partes: Record<string, string> = {};
  for (const p of (req.headers.get('x-signature') || '').split(',')) { const i = p.indexOf('='); if (i > 0) partes[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
  const ts = partes.ts || '', v1 = partes.v1 || '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(dataId) || !/^\d{9,16}$/.test(ts) || !/^[a-f0-9]{64}$/.test(v1) || reqId.length > 128) throw new Erro(401, 'Assinatura inválida.');
  const esperado = await hmacHex(segredo, `id:${dataId.toLowerCase()};request-id:${reqId};ts:${ts};`);
  if (!(await igual(esperado, v1))) throw new Erro(401, 'Assinatura inválida.');
  const seg = +ts > 1e11 ? Math.floor(+ts / 1000) : +ts;
  if (Math.abs(agora() - seg) > 600) throw new Erro(401, 'Notificação expirada.');
  const chave = `${dataId}:${ts}:${reqId}`;
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO webhooks (chave, em) VALUES (?, ?)').bind(chave, agora()).run();
  if (!ins.meta.changes) throw new Erro(409, 'Notificação repetida.');
  await env.DB.prepare('DELETE FROM webhooks WHERE em < ?').bind(agora() - 86400).run();
  const tipo = url.searchParams.get('type') || corpo.type || '';
  if (tipo !== 'payment') return json({ ok: true, ignorado: true });
  let pg: Pagamento;
  try { pg = await mp<Pagamento>(env, '/v1/payments/' + encodeURIComponent(dataId)); }
  catch (e) { await env.DB.prepare('DELETE FROM webhooks WHERE chave = ?').bind(chave).run(); throw e; }
  if (String(pg.id) !== dataId) return json({ ok: true, pago: false });
  return json({ ok: true, pago: await aplicar(env, pg) });
}
