import { Env, Erro, Config, agora, aleatorio, sha256, json, lerJson, texto, inteiro, umDe, lista, objeto, lerConfig, lojaAberta, contar, registrar, chaveIp } from './util';
import { modoOnline, cobrancaPix } from './pagamento';

/* ── cardápio ── */
interface LinhaItem { id: number; categoria_id: number; nome: string; descricao: string; preco: number; foto: string | null; pausado: number; pos: number; }
export async function montarCardapio(env: Env, admin: boolean) {
  const [cats, itens, grupos, opcoes, ig] = await env.DB.batch([
    env.DB.prepare('SELECT id, nome, pos, ativo FROM categorias WHERE excluido = 0 ORDER BY pos, id'),
    env.DB.prepare('SELECT id, categoria_id, nome, descricao, preco, foto, pausado, pos FROM itens WHERE excluido = 0 ORDER BY pos, id'),
    env.DB.prepare('SELECT id, nome, minimo, maximo FROM grupos WHERE excluido = 0 ORDER BY id'),
    env.DB.prepare('SELECT id, grupo_id, nome, preco, pausado FROM opcoes WHERE excluido = 0 ORDER BY pos, id'),
    env.DB.prepare('SELECT item_id, grupo_id FROM item_grupos ORDER BY pos')
  ]);
  const gruposDoItem = new Map<number, number[]>();
  const vivos = new Set((grupos.results as { id: number }[]).map((g) => g.id));
  for (const r of ig.results as { item_id: number; grupo_id: number }[]) {
    if (!vivos.has(r.grupo_id)) continue;
    if (!gruposDoItem.has(r.item_id)) gruposDoItem.set(r.item_id, []);
    gruposDoItem.get(r.item_id)!.push(r.grupo_id);
  }
  const porCat = new Map<number, unknown[]>();
  for (const i of itens.results as unknown as LinhaItem[]) {
    if (!porCat.has(i.categoria_id)) porCat.set(i.categoria_id, []);
    porCat.get(i.categoria_id)!.push({ id: i.id, nome: i.nome, desc: i.descricao, preco: i.preco, foto: i.foto ? '/api/fotos/' + i.foto : '', pausado: !!i.pausado, grupos: gruposDoItem.get(i.id) || [] });
  }
  const opsDoGrupo = new Map<number, unknown[]>();
  for (const o of opcoes.results as { id: number; grupo_id: number; nome: string; preco: number; pausado: number }[]) {
    if (!opsDoGrupo.has(o.grupo_id)) opsDoGrupo.set(o.grupo_id, []);
    opsDoGrupo.get(o.grupo_id)!.push({ id: o.id, nome: o.nome, preco: o.preco, pausado: !!o.pausado });
  }
  return {
    categorias: (cats.results as { id: number; nome: string; ativo: number }[]).filter((c) => admin || c.ativo)
      .map((c) => ({ id: c.id, nome: c.nome, ativo: !!c.ativo, itens: porCat.get(c.id) || [] })),
    grupos: (grupos.results as { id: number; nome: string; minimo: number; maximo: number }[])
      .map((g) => ({ id: g.id, nome: g.nome, min: g.minimo, max: g.maximo, opcoes: opsDoGrupo.get(g.id) || [] }))
  };
}

export async function cardapioPublico(env: Env): Promise<Response> {
  const [c, m, onlineModo] = await Promise.all([lerConfig(env), montarCardapio(env, false), modoOnline(env)]);
  const corpo = {
    loja: { ...c.loja, aberta: lojaAberta(c), modo: c.status.modo },
    horarios: c.horarios, entrega: c.entrega, retirada: c.retirada,
    pagamento: { ...c.pagamento, onlineModo },
    categorias: m.categorias, grupos: m.grupos
  };
  const versao = (await sha256(JSON.stringify(corpo))).slice(0, 16);
  return json({ versao, ...corpo });
}

export async function foto(env: Env, chave: string): Promise<Response> {
  if (!/^[a-z0-9]+\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(chave)) throw new Erro(404, 'Não encontrado.');
  const o = await env.FOTOS.get(chave);
  if (!o) throw new Erro(404, 'Não encontrado.');
  const tipo = chave.endsWith('.png') ? 'image/png' : chave.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return new Response(o.body, { headers: { 'content-type': tipo, 'cache-control': 'public, max-age=86400', 'content-security-policy': "default-src 'none'" } });
}

/* ── cálculo do pedido: tudo vem do banco, nada do navegador ── */
export interface LinhaCalc { itemId: number; nome: string; precoUnit: number; qtd: number; opcoes: { nome: string; preco: number }[]; obs: string; total: number; }
export interface Calculo { linhas: LinhaCalc[]; subtotal: number; taxa: number; desconto: number; total: number; cupomId: number | null; cupom: string | null; bairro: string; }

async function cupomValido(env: Env, codigo: string, subtotal: number) {
  const c = await env.DB.prepare('SELECT id, codigo, tipo, valor, minimo, validade, limite, usos, ativo FROM cupons WHERE codigo = ?').bind(codigo)
    .first<{ id: number; codigo: string; tipo: 'pct' | 'valor'; valor: number; minimo: number; validade: number | null; limite: number | null; usos: number; ativo: number }>();
  if (!c || !c.ativo || (c.validade !== null && c.validade < agora()) || (c.limite !== null && c.usos >= c.limite)) throw new Erro(400, 'Cupom inválido ou expirado.');
  if (subtotal < c.minimo) throw new Erro(400, `Este cupom vale para pedidos a partir de R$ ${(c.minimo / 100).toFixed(2).replace('.', ',')}.`);
  const desconto = c.tipo === 'pct' ? Math.round(subtotal * Math.min(c.valor, 100) / 100) : c.valor;
  return { id: c.id, codigo: c.codigo, desconto: Math.min(desconto, subtotal) };
}

export async function calcular(env: Env, cfg: Config, b: Record<string, unknown>): Promise<Calculo> {
  const tipo = umDe(b.tipo, 'tipo', ['entrega', 'retirada'] as const);
  if (tipo === 'entrega' && !cfg.entrega.ativa) throw new Erro(400, 'A entrega está desativada no momento.');
  if (tipo === 'retirada' && !cfg.retirada.ativa) throw new Erro(400, 'A retirada está desativada no momento.');
  const pedidos = lista(b.itens, 'itens', 60);
  if (!pedidos.length) throw new Erro(400, 'O pedido está vazio.');
  const entrada = pedidos.map((x) => {
    const o = objeto(x, 'itens');
    return { id: inteiro(o.id, 'item', 1, 2 ** 31), qtd: inteiro(o.q, 'quantidade', 1, 50), obs: texto(o.obs, 'observação', { max: 180, opcional: true }),
      opcoes: lista(o.opcoes ?? [], 'opções', 40).map((v) => inteiro(v, 'opção', 1, 2 ** 31)) };
  });
  const ids = [...new Set(entrada.map((e) => e.id))];
  const marcas = ids.map(() => '?').join(',');
  const [ri, rg] = await env.DB.batch([
    env.DB.prepare(`SELECT i.id, i.nome, i.preco, i.pausado FROM itens i JOIN categorias c ON c.id = i.categoria_id WHERE i.excluido = 0 AND c.excluido = 0 AND c.ativo = 1 AND i.id IN (${marcas})`).bind(...ids),
    env.DB.prepare(`SELECT ig.item_id, g.id AS grupo_id, g.nome AS grupo, g.minimo, g.maximo, o.id AS opcao_id, o.nome, o.preco, o.pausado FROM item_grupos ig JOIN grupos g ON g.id = ig.grupo_id AND g.excluido = 0 LEFT JOIN opcoes o ON o.grupo_id = g.id AND o.excluido = 0 WHERE ig.item_id IN (${marcas})`).bind(...ids)
  ]);
  const itens = new Map((ri.results as { id: number; nome: string; preco: number; pausado: number }[]).map((i) => [i.id, i]));
  type G = { nome: string; min: number; max: number; ops: Map<number, { nome: string; preco: number; pausado: number }> };
  const grupos = new Map<number, Map<number, G>>();
  for (const r of rg.results as { item_id: number; grupo_id: number; grupo: string; minimo: number; maximo: number; opcao_id: number | null; nome: string; preco: number; pausado: number }[]) {
    if (!grupos.has(r.item_id)) grupos.set(r.item_id, new Map());
    const m = grupos.get(r.item_id)!;
    if (!m.has(r.grupo_id)) m.set(r.grupo_id, { nome: r.grupo, min: r.minimo, max: r.maximo, ops: new Map() });
    if (r.opcao_id !== null) m.get(r.grupo_id)!.ops.set(r.opcao_id, { nome: r.nome, preco: r.preco, pausado: r.pausado });
  }
  const linhas: LinhaCalc[] = [];
  for (const e of entrada) {
    const it = itens.get(e.id);
    if (!it) throw new Erro(409, 'Um item do pedido não está mais no cardápio. Atualize a página.', { item: e.id });
    if (it.pausado) throw new Erro(409, `"${it.nome}" está esgotado no momento.`, { item: e.id });
    if (new Set(e.opcoes).size !== e.opcoes.length) throw new Erro(400, 'Opção repetida no pedido.');
    const gs = grupos.get(e.id) || new Map<number, G>();
    const restantes = new Set(e.opcoes);
    let unit = it.preco;
    const escolhidas: { nome: string; preco: number }[] = [];
    for (const g of gs.values()) {
      let n = 0;
      for (const oid of e.opcoes) {
        const o = g.ops.get(oid);
        if (!o) continue;
        if (o.pausado) throw new Erro(409, `A opção "${o.nome}" está indisponível no momento.`, { item: e.id });
        n++; unit += o.preco; escolhidas.push({ nome: o.nome, preco: o.preco }); restantes.delete(oid);
      }
      if (n < g.min || n > g.max) throw new Erro(400, `Revise as opções de "${it.nome}" (${g.nome}).`, { item: e.id });
    }
    if (restantes.size) throw new Erro(400, `Opção inválida para "${it.nome}".`, { item: e.id });
    linhas.push({ itemId: it.id, nome: it.nome, precoUnit: unit, qtd: e.qtd, opcoes: escolhidas, obs: e.obs, total: unit * e.qtd });
  }
  const subtotal = linhas.reduce((a, l) => a + l.total, 0);
  let taxa = 0, bairro = '';
  if (tipo === 'entrega') {
    bairro = texto(b.bairro, 'bairro', { min: 1, max: 80 });
    const z = cfg.entrega.bairros.find((x) => x[0] === bairro);
    if (!z) throw new Erro(400, 'Não entregamos neste bairro pelo site. Fale com a loja.');
    if (cfg.entrega.pedidoMinimo > 0 && subtotal < cfg.entrega.pedidoMinimo) throw new Erro(400, `O pedido mínimo para entrega é R$ ${(cfg.entrega.pedidoMinimo / 100).toFixed(2).replace('.', ',')}.`);
    taxa = cfg.entrega.gratisAcima > 0 && subtotal >= cfg.entrega.gratisAcima ? 0 : z[1];
  }
  let desconto = tipo === 'retirada' && cfg.retirada.descontoPct > 0 ? Math.round(subtotal * Math.min(cfg.retirada.descontoPct, 100) / 100) : 0;
  let cupomId: number | null = null, cupom: string | null = null;
  const codigo = texto(b.cupom, 'cupom', { max: 30, opcional: true });
  if (codigo) { const c = await cupomValido(env, codigo, subtotal); cupomId = c.id; cupom = c.codigo; desconto += c.desconto; }
  desconto = Math.min(desconto, subtotal);
  return { linhas, subtotal, taxa, desconto, total: subtotal - desconto + taxa, cupomId, cupom, bairro };
}

/** Prévia do total (usada pelo carrinho para mostrar cupom, taxa e descontos calculados pelo servidor). */
export async function cotar(req: Request, env: Env): Promise<Response> {
  const b = await lerJson(req);
  const c = await calcular(env, await lerConfig(env), b);
  return json({ subtotal: c.subtotal, taxa: c.taxa, desconto: c.desconto, total: c.total, cupom: c.cupom });
}

export async function criarPedido(req: Request, env: Env): Promise<Response> {
  const kip = await chaveIp(req, 'pedido');
  if ((await contar(env, kip, 600)) >= 30) throw new Erro(429, 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.');
  const b = await lerJson(req);
  const cfg = await lerConfig(env);
  if (!lojaAberta(cfg)) throw new Erro(409, 'A loja está fechada agora e não está recebendo pedidos.');
  const tipo = umDe(b.tipo, 'tipo', ['entrega', 'retirada'] as const);
  const cli = objeto(b.cliente, 'cliente');
  const nome = texto(cli.nome, 'nome', { min: 2, max: 80 });
  const tel = texto(cli.telefone, 'telefone', { min: 8, max: 20 }).replace(/\D/g, '');
  if (tel.length < 10 || tel.length > 13) throw new Erro(400, 'Informe um telefone com DDD.');
  const endereco = tipo === 'entrega' ? texto(b.endereco, 'endereço', { min: 5, max: 160 }) : '';
  const obs = texto(b.obs, 'observações', { max: 300, opcional: true });
  const pagamento = umDe(b.pagamento, 'forma de pagamento', ['dinheiro', 'debito', 'credito', 'online'] as const);
  const P = cfg.pagamento;
  if ((pagamento === 'dinheiro' && !P.dinheiro) || (pagamento === 'debito' && !P.debito.length) || (pagamento === 'credito' && !P.credito.length) || (pagamento === 'online' && !P.online))
    throw new Erro(400, 'Esta forma de pagamento não está disponível.');
  const c = await calcular(env, cfg, b);
  let troco: number | null = null;
  if (pagamento === 'dinheiro' && b.troco !== undefined && b.troco !== null) {
    troco = inteiro(b.troco, 'troco', 0, 100000000);
    if (troco !== 0 && troco < c.total) throw new Erro(400, 'O valor para troco é menor que o total do pedido.');
    if (troco === 0) troco = null;
  }
  const token = aleatorio(24), ref = aleatorio(12), t = agora();
  const online = pagamento === 'online';
  const modo = online ? await modoOnline(env) : null;
  if (modo === 'bloqueado') throw new Erro(503, 'Pagamento online indisponível: a chave configurada não é de teste.');
  const status = online ? 'aguardando_pagamento' : 'novo';
  const sub = '(SELECT id FROM pedidos WHERE ref = ?)';
  const ops = [
    env.DB.prepare('INSERT INTO pedidos (token_hash, ref, status, tipo, cliente_nome, cliente_tel, endereco, bairro, obs, subtotal, taxa, desconto, total, cupom, pagamento, troco, pag_status, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256(token), ref, status, tipo, nome, tel, endereco, c.bairro, obs, c.subtotal, c.taxa, c.desconto, c.total, c.cupom, pagamento, troco, online ? 'pendente' : 'na_entrega', t, t),
    ...c.linhas.map((l) => env.DB.prepare(`INSERT INTO pedido_itens (pedido_id, item_id, nome, preco_unit, qtd, opcoes, obs, total) VALUES (${sub}, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(ref, l.itemId, l.nome, l.precoUnit, l.qtd, JSON.stringify(l.opcoes), l.obs, l.total)),
    env.DB.prepare(`INSERT INTO pedido_eventos (pedido_id, status, usuario, em) VALUES (${sub}, ?, NULL, ?)`).bind(ref, status, t),
    env.DB.prepare('INSERT INTO limites (chave, em) VALUES (?, ?)').bind(kip, t)
  ];
  if (c.cupomId) ops.push(env.DB.prepare('UPDATE cupons SET usos = usos + 1 WHERE id = ?').bind(c.cupomId));
  await env.DB.batch(ops);
  const p = await env.DB.prepare('SELECT id FROM pedidos WHERE ref = ?').bind(ref).first<{ id: number }>();
  let pag: Record<string, unknown> = { modo: 'na_entrega' };
  if (modo === 'simulado') pag = { modo: 'simulado' };
  if (modo === 'mercadopago') {
    try { pag = { modo: 'mercadopago', pix: await cobrancaPix(env, { id: p!.id, ref, total: c.total }) }; }
    catch { pag = { modo: 'mercadopago', erro: 'Não foi possível gerar o Pix. Tente de novo pelo acompanhamento do pedido.' }; }
  }
  return json({ numero: p!.id, token, status, subtotal: c.subtotal, taxa: c.taxa, desconto: c.desconto, total: c.total, pagamento: pag }, 201);
}

export interface PedidoLinha { id: number; ref: string; status: string; tipo: string; endereco: string; bairro: string; subtotal: number; taxa: number; desconto: number; total: number; cupom: string | null; pagamento: string; troco: number | null; pag_status: string; motivo: string | null; criado: number; atualizado: number; }
export async function pedidoPorToken(env: Env, token: string): Promise<PedidoLinha> {
  if (!/^[A-Za-z0-9_-]{30,40}$/.test(token)) throw new Erro(404, 'Pedido não encontrado.');
  const p = await env.DB.prepare('SELECT id, ref, status, tipo, endereco, bairro, subtotal, taxa, desconto, total, cupom, pagamento, troco, pag_status, motivo, criado, atualizado FROM pedidos WHERE token_hash = ?')
    .bind(await sha256(token)).first<PedidoLinha>();
  if (!p) throw new Erro(404, 'Pedido não encontrado.');
  return p;
}

export async function verPedido(env: Env, token: string): Promise<Response> {
  const p = await pedidoPorToken(env, token);
  const pix = p.pagamento === 'online' && p.status === 'aguardando_pagamento'
    ? await env.DB.prepare('SELECT pix_codigo AS codigo, pix_expira AS expira, pix_qr IS NOT NULL AS qr FROM pedidos WHERE id = ? AND pix_codigo IS NOT NULL').bind(p.id).first<{ codigo: string; expira: number; qr: number }>()
    : null;
  const [it, ev] = await env.DB.batch([
    env.DB.prepare('SELECT nome, qtd, opcoes, obs, total FROM pedido_itens WHERE pedido_id = ? ORDER BY id').bind(p.id),
    env.DB.prepare('SELECT status, em FROM pedido_eventos WHERE pedido_id = ? ORDER BY id').bind(p.id)
  ]);
  return json({
    numero: p.id, status: p.status, tipo: p.tipo, endereco: p.endereco, bairro: p.bairro, subtotal: p.subtotal, taxa: p.taxa, desconto: p.desconto, total: p.total,
    cupom: p.cupom, pagamento: p.pagamento, pagStatus: p.pag_status, onlineModo: p.pagamento === 'online' ? await modoOnline(env) : null, pix: pix ? { codigo: pix.codigo, expira: pix.expira, qr: !!pix.qr } : null, motivo: p.motivo, criado: p.criado, atualizado: p.atualizado,
    itens: (it.results as { nome: string; qtd: number; opcoes: string; obs: string; total: number }[]).map((i) => ({ nome: i.nome, qtd: i.qtd, opcoes: (JSON.parse(i.opcoes) as { nome: string }[]).map((o) => o.nome), obs: i.obs, total: i.total })),
    eventos: ev.results
  });
}
