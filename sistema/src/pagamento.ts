import { Env, Erro, agora, json, hmacHex, igual, deB64 } from './util';
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

/* ── Pix (API de Orders do Mercado Pago) ── */
// O Pix vale 30 min: é o mesmo prazo em que o painel cancela pedidos online sem pagamento.
const PIX_VALIDADE = 'PT30M';
export interface Pix { codigo: string; expira: number; qr: boolean; }
interface Ordem {
  id: string; status: string; status_detail?: string; external_reference?: string; total_amount?: string; total_paid_amount?: string; currency?: string;
  transactions?: { payments?: { id?: string; status?: string; date_of_expiration?: string; payment_method?: { id?: string; qr_code?: string; qr_code_base64?: string } }[] };
}
const reais = (c: number) => (c / 100).toFixed(2);
const centavos = (v: unknown) => (typeof v === 'string' && /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(parseFloat(v) * 100) : NaN);

/** Cria (uma vez) a cobrança Pix do pedido e guarda o código copia e cola e o QR. Chamar de novo devolve a mesma cobrança. */
export async function cobrancaPix(env: Env, p: { id: number; ref: string; total: number }): Promise<Pix> {
  const atual = await env.DB.prepare('SELECT pix_ordem, pix_codigo, pix_qr, pix_expira FROM pedidos WHERE id = ?').bind(p.id)
    .first<{ pix_ordem: string | null; pix_codigo: string | null; pix_qr: string | null; pix_expira: number | null }>();
  if (atual?.pix_ordem && atual.pix_codigo) return { codigo: atual.pix_codigo, expira: atual.pix_expira || 0, qr: !!atual.pix_qr };
  if ((await modoOnline(env)) !== 'mercadopago') throw new Erro(409, 'Pagamento online não configurado.');
  const corpo = {
    type: 'online', processing_mode: 'automatic', external_reference: p.ref, total_amount: reais(p.total),
    description: `Pedido nº ${p.id} · Taika Sushi`,
    transactions: { payments: [{ amount: reais(p.total), payment_method: { id: 'pix', type: 'bank_transfer' }, expiration_time: PIX_VALIDADE }] },
    // Só credenciais de teste chegam aqui (modoOnline). No sandbox, o pagador "APRO" faz o Mercado Pago aprovar o Pix sozinho
    // quando o valor é R$ 50,00: é assim que se simula o cliente pagando. Outros valores ficam aguardando até expirar.
    payer: { email: 'test_payer@example.com', first_name: 'APRO' }
  };
  const o = await mp<Ordem>(env, '/v1/orders', { method: 'POST', body: JSON.stringify(corpo), headers: { 'x-idempotency-key': 'pix-' + p.ref } });
  const pg = o.transactions?.payments?.[0], codigo = pg?.payment_method?.qr_code || '', qr = pg?.payment_method?.qr_code_base64 || '';
  if (!o.id || !/^[A-Za-z0-9_-]{1,64}$/.test(o.id) || !/^000201/.test(codigo) || codigo.length > 1024) throw new Erro(502, 'O Mercado Pago não devolveu um Pix válido.');
  const exp = Date.parse(pg?.date_of_expiration || ''), expira = Number.isFinite(exp) ? Math.floor(exp / 1000) : agora() + 1800;
  const qrOk = /^[A-Za-z0-9+/]+={0,2}$/.test(qr) && qr.length < 200000 ? qr : null;
  await env.DB.prepare("UPDATE pedidos SET pix_ordem = ?, pix_codigo = ?, pix_qr = ?, pix_expira = ?, pag_metodo = 'pix' WHERE id = ? AND pix_ordem IS NULL")
    .bind(o.id, codigo, qrOk, expira, p.id).run();
  return { codigo, expira, qr: !!qrOk };
}

/** Só marca como pago se a ordem, lida direto da API, estiver paga por inteiro, em BRL, e for a ordem Pix deste pedido. */
async function aplicarOrdem(env: Env, o: Ordem): Promise<boolean> {
  if (o.status !== 'processed' || o.status_detail !== 'accredited' || o.currency !== 'BRL' || !o.external_reference) return false;
  const p = await env.DB.prepare("SELECT id, total, pag_status, pix_ordem FROM pedidos WHERE ref = ? AND pagamento = 'online'").bind(o.external_reference)
    .first<{ id: number; total: number; pag_status: string; pix_ordem: string | null }>();
  if (!p || p.pix_ordem !== o.id || centavos(o.total_paid_amount) !== p.total || centavos(o.total_amount) !== p.total) return false;
  if (p.pag_status === 'pago') return true;
  return marcarPago(env, p.id, 'pago', o.id, 'pix');
}

async function marcarPago(env: Env, id: number, como: 'pago' | 'simulado', pagId: string, metodo: string): Promise<boolean> {
  const t = agora();
  const r = await env.DB.prepare("UPDATE pedidos SET pag_status = ?, pag_id = ?, pag_metodo = ?, status = 'novo', criado = ?, atualizado = ? WHERE id = ? AND pag_status = 'pendente' AND status = 'aguardando_pagamento'")
    .bind(como, pagId, metodo, t, t, id).run();
  if (!r.meta.changes) return false;
  await env.DB.prepare("INSERT INTO pedido_eventos (pedido_id, status, usuario, em) VALUES (?, 'novo', NULL, ?)").bind(id, t).run();
  return true;
}

async function pedidoOnline(env: Env, token: string) {
  const p = await pedidoPorToken(env, token);
  if (p.pagamento !== 'online') throw new Erro(400, 'Este pedido não é pago online.');
  return p;
}

/** O site pergunta se já foi pago: o servidor consulta a ordem no Mercado Pago, nunca confia no navegador. */
export async function conferirPagamento(env: Env, token: string): Promise<Response> {
  const p = await pedidoOnline(env, token);
  if (p.pag_status !== 'pendente') return json({ pagStatus: p.pag_status });
  if ((await modoOnline(env)) !== 'mercadopago') throw new Erro(409, 'Pagamento online não configurado.');
  const r = await env.DB.prepare('SELECT pix_ordem FROM pedidos WHERE id = ?').bind(p.id).first<{ pix_ordem: string | null }>();
  if (!r?.pix_ordem) return json({ pagStatus: 'pendente' });
  const o = await mp<Ordem>(env, '/v1/orders/' + encodeURIComponent(r.pix_ordem));
  return json({ pagStatus: o.id === r.pix_ordem && (await aplicarOrdem(env, o)) ? 'pago' : 'pendente' });
}

/** Devolve (criando se preciso) o Pix do pedido: código copia e cola e validade. */
export async function pixDoPedido(env: Env, token: string): Promise<Response> {
  const p = await pedidoOnline(env, token);
  if (p.pag_status !== 'pendente' || p.status !== 'aguardando_pagamento') throw new Erro(409, 'Este pedido não está aguardando pagamento.');
  return json({ pix: await cobrancaPix(env, { id: p.id, ref: p.ref, total: p.total }) });
}

/** Imagem do QR Code do Pix, servida pelo próprio site (só enquanto o pedido aguarda pagamento). */
export async function qrDoPedido(env: Env, token: string): Promise<Response> {
  const p = await pedidoOnline(env, token);
  const r = await env.DB.prepare('SELECT pix_qr FROM pedidos WHERE id = ?').bind(p.id).first<{ pix_qr: string | null }>();
  if (!r?.pix_qr || p.status !== 'aguardando_pagamento') throw new Erro(404, 'QR Code não disponível.');
  const b = deB64(r.pix_qr), png = b[0] === 0x89 && b[1] === 0x50, jpg = b[0] === 0xff && b[1] === 0xd8;
  if (!png && !jpg) throw new Erro(404, 'QR Code não disponível.');
  return new Response(b, { headers: { 'content-type': png ? 'image/png' : 'image/jpeg', 'cache-control': 'private, no-store' } });
}

/** Só existe quando não há credenciais do Mercado Pago. O pedido fica marcado como "simulado", nunca como "pago". */
export async function pagamentoSimulado(env: Env, token: string): Promise<Response> {
  if ((await modoOnline(env)) !== 'simulado') throw new Erro(403, 'Pagamento simulado indisponível: há credenciais do Mercado Pago configuradas.');
  const p = await pedidoPorToken(env, token);
  if (p.pagamento !== 'online' || p.pag_status !== 'pendente') throw new Erro(409, 'Este pedido não está aguardando pagamento.');
  await marcarPago(env, p.id, 'simulado', 'simulado', 'simulado');
  return json({ pagStatus: 'simulado' });
}

/** Notificação do Mercado Pago (tópico "order"): valida a assinatura, recusa repetições e confirma o pagamento na API antes de qualquer mudança. */
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
  if (tipo !== 'order') return json({ ok: true, ignorado: true });
  let o: Ordem;
  try { o = await mp<Ordem>(env, '/v1/orders/' + encodeURIComponent(dataId)); }
  catch (e) { await env.DB.prepare('DELETE FROM webhooks WHERE chave = ?').bind(chave).run(); throw e; }
  if (String(o.id) !== dataId) return json({ ok: true, pago: false });
  return json({ ok: true, pago: await aplicarOrdem(env, o) });
}
