import { Env, Erro, Config, Horario, agora, aleatorio, json, lerJson, texto, inteiro, bool, umDe, lista, objeto, hashSenha, conferirSenha, lerConfig, horaLocal, inicioDoDia } from './util';
import { exigir, auditar, Sessao } from './auth';
import { montarCardapio } from './publico';

const ATIVOS = ['novo', 'aceito', 'em_preparo', 'saiu_entrega', 'pronto_retirada'];
const FLUXO: Record<string, string[]> = {
  novo: ['aceito', 'recusado'],
  aceito: ['em_preparo', 'cancelado'],
  em_preparo: ['saiu_entrega', 'pronto_retirada', 'cancelado'],
  saiu_entrega: ['concluido', 'cancelado'],
  pronto_retirada: ['concluido', 'cancelado']
};
const TODOS_STATUS = ['aguardando_pagamento', 'novo', 'aceito', 'em_preparo', 'saiu_entrega', 'pronto_retirada', 'concluido', 'recusado', 'cancelado'] as const;
const CAMPOS_PEDIDO = 'id, status, tipo, cliente_nome, cliente_tel, endereco, bairro, obs, subtotal, taxa, desconto, total, cupom, pagamento, troco, pag_status, pag_metodo, motivo, criado, atualizado';
const id = (s: string) => { const n = +s; if (!Number.isInteger(n) || n < 1) throw new Erro(404, 'Não encontrado.'); return n; };
const centavos = (v: unknown, campo: string, max = 10000000) => inteiro(v, campo, 0, max);

async function comItens(env: Env, pedidos: Record<string, unknown>[]) {
  if (!pedidos.length) return [];
  const ids = pedidos.map((p) => p.id as number);
  const marcas = ids.map(() => '?').join(',');
  const [it, ev] = await env.DB.batch([
    env.DB.prepare(`SELECT pedido_id, nome, preco_unit, qtd, opcoes, obs, total FROM pedido_itens WHERE pedido_id IN (${marcas}) ORDER BY id`).bind(...ids),
    env.DB.prepare(`SELECT pedido_id, status, usuario, em FROM pedido_eventos WHERE pedido_id IN (${marcas}) ORDER BY id`).bind(...ids)
  ]);
  const mi = new Map<number, unknown[]>(), me = new Map<number, unknown[]>();
  for (const i of it.results as Record<string, unknown>[]) {
    const k = i.pedido_id as number; if (!mi.has(k)) mi.set(k, []);
    mi.get(k)!.push({ nome: i.nome, precoUnit: i.preco_unit, qtd: i.qtd, opcoes: JSON.parse(i.opcoes as string), obs: i.obs, total: i.total });
  }
  for (const e of ev.results as Record<string, unknown>[]) {
    const k = e.pedido_id as number; if (!me.has(k)) me.set(k, []);
    me.get(k)!.push({ status: e.status, usuario: e.usuario, em: e.em });
  }
  return pedidos.map((p) => ({ ...p, itens: mi.get(p.id as number) || [], eventos: me.get(p.id as number) || [] }));
}

/* ── pedidos ── */
async function pedidosAtivos(env: Env): Promise<Response> {
  const t = agora();
  // Pedidos online que ficaram mais de 30 min sem pagamento são cancelados.
  await env.DB.prepare("UPDATE pedidos SET status = 'cancelado', motivo = 'Pagamento não concluído', atualizado = ? WHERE status = 'aguardando_pagamento' AND criado < ?").bind(t, t - 1800).run();
  const cfg = await lerConfig(env);
  const hoje = inicioDoDia(cfg.loja.fuso, horaLocal(cfg.loja.fuso).data);
  const r = await env.DB.prepare(`SELECT ${CAMPOS_PEDIDO} FROM pedidos WHERE status IN ('novo','aceito','em_preparo','saiu_entrega','pronto_retirada') OR (status IN ('concluido','recusado','cancelado') AND atualizado >= ?) ORDER BY criado DESC LIMIT 200`).bind(hoje).all();
  return json({ agora: t, pedidos: await comItens(env, r.results as Record<string, unknown>[]) });
}

async function mudarStatus(req: Request, env: Env, s: Sessao, pid: number): Promise<Response> {
  const b = await lerJson(req, 4096);
  const novo = umDe(b.status, 'status', ['aceito', 'em_preparo', 'saiu_entrega', 'pronto_retirada', 'concluido', 'recusado', 'cancelado'] as const);
  const p = await env.DB.prepare('SELECT id, status, tipo FROM pedidos WHERE id = ?').bind(pid).first<{ id: number; status: string; tipo: string }>();
  if (!p) throw new Erro(404, 'Pedido não encontrado.');
  if (!(FLUXO[p.status] || []).includes(novo)) throw new Erro(409, 'Este pedido não pode ir para esse status agora.', { status: p.status });
  if ((novo === 'saiu_entrega' && p.tipo !== 'entrega') || (novo === 'pronto_retirada' && p.tipo !== 'retirada')) throw new Erro(409, 'Status não combina com o tipo do pedido.');
  const final = novo === 'recusado' || novo === 'cancelado';
  const motivo = final ? texto(b.motivo, 'motivo', { min: 3, max: 200 }) : null;
  const t = agora();
  const r = await env.DB.prepare('UPDATE pedidos SET status = ?, motivo = COALESCE(?, motivo), atualizado = ? WHERE id = ? AND status = ?').bind(novo, motivo, t, pid, p.status).run();
  if (!r.meta.changes) throw new Erro(409, 'O pedido foi alterado por outra pessoa. Atualize a tela.');
  await env.DB.prepare('INSERT INTO pedido_eventos (pedido_id, status, usuario, em) VALUES (?, ?, ?, ?)').bind(pid, novo, s.usuario.usuario, t).run();
  await auditar(env, s.usuario, 'pedido.status', '#' + pid, { de: p.status, para: novo, motivo });
  return json({ ok: true, status: novo });
}

async function historico(req: Request, env: Env): Promise<Response> {
  const u = new URL(req.url), q = u.searchParams;
  const cfg = await lerConfig(env);
  const cond: string[] = ['1 = 1'], binds: unknown[] = [];
  const data = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const de = data(q.get('de')), ate = data(q.get('ate'));
  if (de) { cond.push('criado >= ?'); binds.push(inicioDoDia(cfg.loja.fuso, de)); }
  if (ate) { cond.push('criado < ?'); binds.push(inicioDoDia(cfg.loja.fuso, ate) + 86400); }
  const st = q.get('status');
  if (st && (TODOS_STATUS as readonly string[]).includes(st)) { cond.push('status = ?'); binds.push(st); }
  const tp = q.get('tipo');
  if (tp === 'entrega' || tp === 'retirada') { cond.push('tipo = ?'); binds.push(tp); }
  const pg = q.get('pagamento');
  if (pg && ['dinheiro', 'debito', 'credito', 'online'].includes(pg)) { cond.push('pagamento = ?'); binds.push(pg); }
  const busca = (q.get('q') || '').trim().slice(0, 60);
  if (busca) {
    if (/^#?\d+$/.test(busca)) { cond.push('id = ?'); binds.push(+busca.replace('#', '')); }
    else { cond.push("(cliente_nome LIKE ? ESCAPE '\\' OR cliente_tel LIKE ? ESCAPE '\\')"); const like = '%' + busca.replace(/[\\%_]/g, '\\$&') + '%'; binds.push(like, like); }
  }
  const pagina = Math.max(1, Math.min(500, +(q.get('pagina') || 1) || 1)), por = 25;
  const where = cond.join(' AND ');
  const [tot, r] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status NOT IN ('recusado','cancelado','aguardando_pagamento') THEN total ELSE 0 END), 0) AS soma FROM pedidos WHERE ${where}`).bind(...binds),
    env.DB.prepare(`SELECT ${CAMPOS_PEDIDO} FROM pedidos WHERE ${where} ORDER BY criado DESC LIMIT ${por} OFFSET ${(pagina - 1) * por}`).bind(...binds)
  ]);
  const t = tot.results[0] as { n: number; soma: number };
  return json({ total: t.n, soma: t.soma, pagina, porPagina: por, pedidos: await comItens(env, r.results as Record<string, unknown>[]) });
}

async function resumo(req: Request, env: Env): Promise<Response> {
  const cfg = await lerConfig(env);
  const dias = [7, 30, 90].includes(+(new URL(req.url).searchParams.get('dias') || 30)) ? +(new URL(req.url).searchParams.get('dias') || 30) : 30;
  const hl = horaLocal(cfg.loja.fuso), hoje = inicioDoDia(cfg.loja.fuso, hl.data);
  const validos = "status NOT IN ('recusado','cancelado','aguardando_pagamento')";
  const [h, o, st, serie, top, ops] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS soma FROM pedidos WHERE ${validos} AND criado >= ?`).bind(hoje),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS soma FROM pedidos WHERE ${validos} AND criado >= ? AND criado < ?`).bind(hoje - 86400, hoje),
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM pedidos WHERE criado >= ? GROUP BY status').bind(hoje),
    env.DB.prepare(`SELECT criado, total FROM pedidos WHERE ${validos} AND criado >= ?`).bind(hoje - 6 * 86400),
    env.DB.prepare(`SELECT i.nome, SUM(i.qtd) AS qtd, SUM(i.total) AS soma FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id WHERE p.${validos} AND p.criado >= ? GROUP BY i.item_id, i.nome ORDER BY qtd DESC, soma DESC LIMIT 10`).bind(hoje - (dias - 1) * 86400),
    env.DB.prepare(`SELECT json_extract(j.value, '$.nome') AS nome, SUM(i.qtd) AS qtd FROM pedido_itens i JOIN pedidos p ON p.id = i.pedido_id, json_each(i.opcoes) j WHERE p.${validos} AND p.criado >= ? GROUP BY nome ORDER BY qtd DESC LIMIT 10`).bind(hoje - (dias - 1) * 86400)
  ]);
  const a = h.results[0] as { n: number; soma: number }, b = o.results[0] as { n: number; soma: number };
  const porDia = Array.from({ length: 7 }, (_, i) => ({ dia: new Date((hoje - (6 - i) * 86400 + hl.offset) * 1000).toISOString().slice(0, 10), pedidos: 0, receita: 0 }));
  for (const r of serie.results as { criado: number; total: number }[]) { const i = 6 - Math.floor((hoje + 86400 - 1 - r.criado) / 86400); if (porDia[i]) { porDia[i].pedidos++; porDia[i].receita += r.total; } }
  return json({
    hoje: { pedidos: a.n, receita: a.soma, ticket: a.n ? Math.round(a.soma / a.n) : 0 },
    ontem: { pedidos: b.n, receita: b.soma, ticket: b.n ? Math.round(b.soma / b.n) : 0 },
    porStatus: st.results, porDia, dias, maisVendidos: top.results, opcionais: ops.results
  });
}

/* ── cardápio ── */
async function salvarCategoria(req: Request, env: Env, s: Sessao, cid: number | null): Promise<Response> {
  const b = await lerJson(req, 4096);
  const nome = texto(b.nome, 'nome', { min: 1, max: 80 });
  const ativo = b.ativo === undefined ? true : bool(b.ativo, 'ativo');
  if (cid === null) {
    const r = await env.DB.prepare('INSERT INTO categorias (nome, pos, ativo) VALUES (?, (SELECT COALESCE(MAX(pos), -1) + 1 FROM categorias), ?) RETURNING id').bind(nome, +ativo).first<{ id: number }>();
    await auditar(env, s.usuario, 'categoria.criar', nome);
    return json({ id: r!.id }, 201);
  }
  const r = await env.DB.prepare('UPDATE categorias SET nome = ?, ativo = ? WHERE id = ? AND excluido = 0').bind(nome, +ativo, cid).run();
  if (!r.meta.changes) throw new Erro(404, 'Categoria não encontrada.');
  await auditar(env, s.usuario, 'categoria.editar', nome, { ativo });
  return json({ ok: true });
}
async function excluirCategoria(env: Env, s: Sessao, cid: number): Promise<Response> {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM itens WHERE categoria_id = ? AND excluido = 0').bind(cid).first<{ n: number }>();
  if (n!.n > 0) throw new Erro(409, 'Mova ou exclua os itens desta categoria antes de excluí-la.');
  const r = await env.DB.prepare('UPDATE categorias SET excluido = 1 WHERE id = ? AND excluido = 0').bind(cid).run();
  if (!r.meta.changes) throw new Erro(404, 'Categoria não encontrada.');
  await auditar(env, s.usuario, 'categoria.excluir', '#' + cid);
  return json({ ok: true });
}
async function ordenar(req: Request, env: Env, s: Sessao, tabela: 'categorias' | 'itens'): Promise<Response> {
  const b = await lerJson(req, 16384);
  const ids = lista(b.ids, 'ids', 500).map((v) => inteiro(v, 'id', 1, 2 ** 31));
  if (new Set(ids).size !== ids.length || !ids.length) throw new Erro(400, 'Lista inválida.');
  await env.DB.batch(ids.map((x, i) => env.DB.prepare(`UPDATE ${tabela} SET pos = ? WHERE id = ?`).bind(i, x)));
  await auditar(env, s.usuario, tabela + '.ordenar', '', { n: ids.length });
  return json({ ok: true });
}
async function salvarItem(req: Request, env: Env, s: Sessao, iid: number | null): Promise<Response> {
  const b = await lerJson(req, 16384);
  const cat = inteiro(b.categoria, 'categoria', 1, 2 ** 31);
  const nome = texto(b.nome, 'nome', { min: 1, max: 120 });
  const desc = texto(b.desc, 'descrição', { max: 600, opcional: true });
  const preco = centavos(b.preco, 'preço');
  const grupos = lista(b.grupos ?? [], 'opcionais', 20).map((v) => inteiro(v, 'grupo', 1, 2 ** 31));
  if (new Set(grupos).size !== grupos.length) throw new Erro(400, 'Grupo de opcionais repetido.');
  const c = await env.DB.prepare('SELECT id FROM categorias WHERE id = ? AND excluido = 0').bind(cat).first();
  if (!c) throw new Erro(400, 'Categoria inválida.');
  if (grupos.length) {
    const g = await env.DB.prepare(`SELECT COUNT(*) AS n FROM grupos WHERE excluido = 0 AND id IN (${grupos.map(() => '?').join(',')})`).bind(...grupos).first<{ n: number }>();
    if (g!.n !== grupos.length) throw new Erro(400, 'Grupo de opcionais inválido.');
  }
  let alvo = iid;
  if (alvo === null) {
    const r = await env.DB.prepare('INSERT INTO itens (categoria_id, nome, descricao, preco, pos) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(pos), -1) + 1 FROM itens WHERE categoria_id = ?)) RETURNING id').bind(cat, nome, desc, preco, cat).first<{ id: number }>();
    alvo = r!.id;
  } else {
    const antes = await env.DB.prepare('SELECT preco FROM itens WHERE id = ? AND excluido = 0').bind(alvo).first<{ preco: number }>();
    if (!antes) throw new Erro(404, 'Item não encontrado.');
    await env.DB.prepare('UPDATE itens SET categoria_id = ?, nome = ?, descricao = ?, preco = ? WHERE id = ?').bind(cat, nome, desc, preco, alvo).run();
    if (antes.preco !== preco) await auditar(env, s.usuario, 'item.preco', nome, { de: antes.preco, para: preco });
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM item_grupos WHERE item_id = ?').bind(alvo),
    ...grupos.map((g, i) => env.DB.prepare('INSERT INTO item_grupos (item_id, grupo_id, pos) VALUES (?, ?, ?)').bind(alvo, g, i))
  ]);
  await auditar(env, s.usuario, iid === null ? 'item.criar' : 'item.editar', nome);
  return json({ id: alvo }, iid === null ? 201 : 200);
}
async function pausar(req: Request, env: Env, s: Sessao, tabela: 'itens' | 'opcoes', xid: number): Promise<Response> {
  const b = await lerJson(req, 1024);
  const p = bool(b.pausado, 'pausado');
  const r = await env.DB.prepare(`UPDATE ${tabela} SET pausado = ? WHERE id = ? AND excluido = 0 RETURNING nome`).bind(+p, xid).first<{ nome: string }>();
  if (!r) throw new Erro(404, 'Não encontrado.');
  await auditar(env, s.usuario, (tabela === 'itens' ? 'item' : 'opcao') + (p ? '.pausar' : '.reativar'), r.nome);
  return json({ ok: true, pausado: p });
}
async function excluirItem(env: Env, s: Sessao, iid: number): Promise<Response> {
  const r = await env.DB.prepare('UPDATE itens SET excluido = 1 WHERE id = ? AND excluido = 0 RETURNING nome, foto').bind(iid).first<{ nome: string; foto: string | null }>();
  if (!r) throw new Erro(404, 'Item não encontrado.');
  if (r.foto && r.foto.startsWith('itens/')) await env.FOTOS.delete(r.foto);
  await auditar(env, s.usuario, 'item.excluir', r.nome);
  return json({ ok: true });
}

const MAX_FOTO = 2 * 1024 * 1024;
function tipoDaImagem(b: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}
async function enviarFoto(req: Request, env: Env, s: Sessao, iid: number): Promise<Response> {
  const declarado = (req.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
  const mapa: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  if (!mapa[declarado]) throw new Erro(415, 'Envie uma imagem JPG, PNG ou WebP.');
  if (+(req.headers.get('content-length') || 0) > MAX_FOTO) throw new Erro(413, 'A foto passa de 2 MB.');
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.length > MAX_FOTO) throw new Erro(413, 'A foto passa de 2 MB.');
  const real = tipoDaImagem(buf);
  if (!real || real !== mapa[declarado]) throw new Erro(415, 'O arquivo não é uma imagem JPG, PNG ou WebP válida.');
  const it = await env.DB.prepare('SELECT nome, foto FROM itens WHERE id = ? AND excluido = 0').bind(iid).first<{ nome: string; foto: string | null }>();
  if (!it) throw new Erro(404, 'Item não encontrado.');
  const chave = `itens/${iid}-${aleatorio(6)}.${real}`;
  await env.FOTOS.put(chave, buf, { httpMetadata: { contentType: declarado } });
  await env.DB.prepare('UPDATE itens SET foto = ? WHERE id = ?').bind(chave, iid).run();
  if (it.foto && it.foto.startsWith('itens/')) await env.FOTOS.delete(it.foto);
  await auditar(env, s.usuario, 'item.foto', it.nome, { bytes: buf.length });
  return json({ foto: '/api/fotos/' + chave });
}
async function removerFoto(env: Env, s: Sessao, iid: number): Promise<Response> {
  const it = await env.DB.prepare('SELECT nome, foto FROM itens WHERE id = ? AND excluido = 0').bind(iid).first<{ nome: string; foto: string | null }>();
  if (!it) throw new Erro(404, 'Item não encontrado.');
  await env.DB.prepare('UPDATE itens SET foto = NULL WHERE id = ?').bind(iid).run();
  if (it.foto && it.foto.startsWith('itens/')) await env.FOTOS.delete(it.foto);
  await auditar(env, s.usuario, 'item.foto.remover', it.nome);
  return json({ ok: true });
}
async function salvarGrupo(req: Request, env: Env, s: Sessao, gid: number | null): Promise<Response> {
  const b = await lerJson(req, 32768);
  const nome = texto(b.nome, 'nome', { min: 1, max: 120 });
  const min = inteiro(b.min, 'mínimo', 0, 20), max = inteiro(b.max, 'máximo', 1, 20);
  if (min > max) throw new Erro(400, 'O mínimo não pode ser maior que o máximo.');
  const ops = lista(b.opcoes, 'opções', 60).map((x) => { const o = objeto(x, 'opção'); return { id: o.id === undefined || o.id === null ? null : inteiro(o.id, 'opção', 1, 2 ** 31), nome: texto(o.nome, 'nome da opção', { min: 1, max: 80 }), preco: centavos(o.preco, 'preço da opção') }; });
  if (!ops.length) throw new Erro(400, 'Inclua pelo menos uma opção.');
  if (min > ops.length) throw new Erro(400, 'O mínimo é maior que o número de opções.');
  let alvo = gid;
  if (alvo === null) alvo = (await env.DB.prepare('INSERT INTO grupos (nome, minimo, maximo) VALUES (?, ?, ?) RETURNING id').bind(nome, min, max).first<{ id: number }>())!.id;
  else {
    const r = await env.DB.prepare('UPDATE grupos SET nome = ?, minimo = ?, maximo = ? WHERE id = ? AND excluido = 0').bind(nome, min, max, alvo).run();
    if (!r.meta.changes) throw new Erro(404, 'Grupo não encontrado.');
  }
  const manter = ops.filter((o) => o.id !== null).map((o) => o.id as number);
  const st = [env.DB.prepare(`UPDATE opcoes SET excluido = 1 WHERE grupo_id = ?${manter.length ? ` AND id NOT IN (${manter.map(() => '?').join(',')})` : ''}`).bind(alvo, ...manter)];
  ops.forEach((o, i) => st.push(o.id === null
    ? env.DB.prepare('INSERT INTO opcoes (grupo_id, nome, preco, pos) VALUES (?, ?, ?, ?)').bind(alvo, o.nome, o.preco, i)
    : env.DB.prepare('UPDATE opcoes SET nome = ?, preco = ?, pos = ? WHERE id = ? AND grupo_id = ?').bind(o.nome, o.preco, i, o.id, alvo)));
  await env.DB.batch(st);
  await auditar(env, s.usuario, gid === null ? 'grupo.criar' : 'grupo.editar', nome, { min, max, opcoes: ops.length });
  return json({ id: alvo }, gid === null ? 201 : 200);
}
async function excluirGrupo(env: Env, s: Sessao, gid: number): Promise<Response> {
  const r = await env.DB.prepare('UPDATE grupos SET excluido = 1 WHERE id = ? AND excluido = 0 RETURNING nome').bind(gid).first<{ nome: string }>();
  if (!r) throw new Erro(404, 'Grupo não encontrado.');
  await env.DB.prepare('DELETE FROM item_grupos WHERE grupo_id = ?').bind(gid).run();
  await auditar(env, s.usuario, 'grupo.excluir', r.nome);
  return json({ ok: true });
}

/* ── configurações da loja ── */
const hora = (v: unknown, campo: string) => { const s = texto(v, campo, { min: 5, max: 5 }); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new Erro(400, `Horário inválido em ${campo}.`); return s; };
const bandeiras = (v: unknown, campo: string) => lista(v, campo, 12).map((x) => texto(x, campo, { min: 1, max: 30 }));
const VALIDAR: { [K in keyof Config]: (b: Record<string, unknown>, atual: Config[K]) => Config[K] } = {
  loja: (b, atual) => {
    const e = objeto(b.endereco, 'endereço');
    const tel = texto(b.telefone, 'telefone', { min: 8, max: 20 }).replace(/[^\d+]/g, '');
    if (!/^\+?\d{10,14}$/.test(tel)) throw new Erro(400, 'Telefone inválido.');
    return { nome: texto(b.nome, 'nome', { min: 1, max: 80 }), boasVindas: texto(b.boasVindas, 'boas-vindas', { max: 120, opcional: true }), sobre: texto(b.sobre, 'sobre', { max: 600, opcional: true }),
      telefone: tel, whatsapp: bool(b.whatsapp, 'whatsapp'), fuso: atual.fuso,
      endereco: { rua: texto(e.rua, 'rua', { min: 1, max: 120 }), bairro: texto(e.bairro, 'bairro', { min: 1, max: 80 }), cidade: texto(e.cidade, 'cidade', { min: 1, max: 80 }), uf: texto(e.uf, 'UF', { min: 2, max: 2 }).toUpperCase(), complemento: texto(e.complemento, 'complemento', { max: 120, opcional: true }), lat: atual.endereco.lat, lng: atual.endereco.lng } };
  },
  horarios: (b) => {
    const l = lista(b.dias, 'dias', 7);
    if (l.length !== 7) throw new Erro(400, 'Informe os 7 dias.');
    return l.map((x, dia): Horario => { const o = objeto(x, 'dia'); return { dia, ativo: bool(o.ativo, 'ativo'), abre: hora(o.abre, 'abre'), fecha: hora(o.fecha, 'fecha') }; });
  },
  status: (b) => ({ modo: umDe(b.modo, 'modo', ['auto', 'aberto', 'fechado'] as const) }),
  entrega: (b) => {
    const bairros = lista(b.bairros, 'bairros', 200).map((x): [string, number] => { const a = lista(x, 'bairro', 2); return [texto(a[0], 'bairro', { min: 1, max: 80 }), centavos(a[1], 'taxa', 100000)]; });
    if (new Set(bairros.map((x) => x[0].toLowerCase())).size !== bairros.length) throw new Erro(400, 'Há bairros repetidos.');
    const raios = lista(b.raios, 'distâncias', 20).map((x): [number, number] => { const a = lista(x, 'distância', 2); if (typeof a[0] !== 'number' || !(a[0] > 0) || a[0] > 100) throw new Erro(400, 'Distância inválida.'); return [Math.round(a[0] * 10) / 10, centavos(a[1], 'taxa', 100000)]; }).sort((x, y) => x[0] - y[0]);
    const tempoMin = inteiro(b.tempoMin, 'tempo mínimo', 5, 300), tempoMax = inteiro(b.tempoMax, 'tempo máximo', 5, 300);
    if (tempoMin > tempoMax) throw new Erro(400, 'O tempo mínimo é maior que o máximo.');
    return { ativa: bool(b.ativa, 'ativa'), bairros, raios, tempoMin, tempoMax, pedidoMinimo: centavos(b.pedidoMinimo, 'pedido mínimo'), gratisAcima: centavos(b.gratisAcima, 'entrega grátis acima de') };
  },
  retirada: (b) => ({ ativa: bool(b.ativa, 'ativa'), minutos: inteiro(b.minutos, 'tempo de retirada', 1, 300), descontoPct: inteiro(b.descontoPct, 'desconto', 0, 90) }),
  pagamento: (b) => {
    const p = { dinheiro: bool(b.dinheiro, 'dinheiro'), debito: bandeiras(b.debito, 'débito'), credito: bandeiras(b.credito, 'crédito'), online: bool(b.online, 'online') };
    if (!p.dinheiro && !p.debito.length && !p.credito.length && !p.online) throw new Erro(400, 'Deixe pelo menos uma forma de pagamento ativa.');
    return p;
  }
};
async function salvarConfig(req: Request, env: Env, s: Sessao, chave: string): Promise<Response> {
  if (!Object.prototype.hasOwnProperty.call(VALIDAR, chave)) throw new Erro(404, 'Configuração desconhecida.');
  const k = chave as keyof Config;
  const b = await lerJson(req, 65536);
  const cfg = await lerConfig(env);
  const valor = (VALIDAR[k] as (b: Record<string, unknown>, a: unknown) => unknown)(b, cfg[k]);
  if (k === 'entrega' || k === 'retirada') { const outro = k === 'entrega' ? cfg.retirada.ativa : cfg.entrega.ativa; if (!(valor as { ativa: boolean }).ativa && !outro) throw new Erro(400, 'Deixe entrega ou retirada ativa.'); }
  await env.DB.prepare('INSERT INTO config (chave, valor, atualizado) VALUES (?, ?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado = excluded.atualizado').bind(k, JSON.stringify(valor), agora()).run();
  await auditar(env, s.usuario, 'config.' + k, '', k === 'status' ? valor : '');
  return json({ ok: true, valor });
}

/* ── cupons, clientes, equipe, auditoria, transações ── */
async function salvarCupom(req: Request, env: Env, s: Sessao, cid: number | null): Promise<Response> {
  const b = await lerJson(req, 4096);
  const codigo = texto(b.codigo, 'código', { min: 3, max: 30 }).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(codigo)) throw new Erro(400, 'Use apenas letras, números, hífen e sublinhado no código.');
  const tipo = umDe(b.tipo, 'tipo', ['pct', 'valor'] as const);
  const valor = tipo === 'pct' ? inteiro(b.valor, 'valor', 1, 100) : inteiro(b.valor, 'valor', 1, 10000000);
  const minimo = centavos(b.minimo ?? 0, 'pedido mínimo');
  const validade = b.validade === null || b.validade === undefined ? null : inteiro(b.validade, 'validade', 0, 4102444800);
  const limite = b.limite === null || b.limite === undefined ? null : inteiro(b.limite, 'limite de usos', 1, 1000000);
  const ativo = b.ativo === undefined ? true : bool(b.ativo, 'ativo');
  try {
    if (cid === null) await env.DB.prepare('INSERT INTO cupons (codigo, tipo, valor, minimo, validade, limite, ativo) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(codigo, tipo, valor, minimo, validade, limite, +ativo).run();
    else { const r = await env.DB.prepare('UPDATE cupons SET codigo = ?, tipo = ?, valor = ?, minimo = ?, validade = ?, limite = ?, ativo = ? WHERE id = ?').bind(codigo, tipo, valor, minimo, validade, limite, +ativo, cid).run(); if (!r.meta.changes) throw new Erro(404, 'Cupom não encontrado.'); }
  } catch (e) { if (e instanceof Erro) throw e; throw new Erro(409, 'Já existe um cupom com este código.'); }
  await auditar(env, s.usuario, cid === null ? 'cupom.criar' : 'cupom.editar', codigo, { tipo, valor, ativo });
  return json({ ok: true }, cid === null ? 201 : 200);
}
async function salvarUsuario(req: Request, env: Env, s: Sessao, uid: number | null): Promise<Response> {
  const b = await lerJson(req, 4096);
  const nome = texto(b.nome, 'nome', { min: 1, max: 80 });
  const papel = umDe(b.papel, 'papel', ['dono', 'equipe'] as const);
  const ativo = b.ativo === undefined ? true : bool(b.ativo, 'ativo');
  const senha = b.senha === undefined || b.senha === null || b.senha === '' ? null : b.senha;
  if (senha !== null && (typeof senha !== 'string' || senha.length < 10 || senha.length > 200)) throw new Erro(400, 'A senha precisa ter pelo menos 10 caracteres.');
  if (uid === null) {
    const usuario = texto(b.usuario, 'usuário', { min: 3, max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(usuario)) throw new Erro(400, 'Use apenas letras minúsculas, números, ponto, hífen e sublinhado no usuário.');
    if (senha === null) throw new Erro(400, 'Defina uma senha.');
    try { await env.DB.prepare('INSERT INTO usuarios (usuario, nome, senha_hash, papel, ativo, criado) VALUES (?, ?, ?, ?, ?, ?)').bind(usuario, nome, await hashSenha(senha as string), papel, +ativo, agora()).run(); }
    catch { throw new Erro(409, 'Já existe uma conta com este usuário.'); }
    await auditar(env, s.usuario, 'equipe.criar', usuario, { papel });
    return json({ ok: true }, 201);
  }
  const alvo = await env.DB.prepare('SELECT id, usuario, papel, ativo FROM usuarios WHERE id = ?').bind(uid).first<{ id: number; usuario: string; papel: string; ativo: number }>();
  if (!alvo) throw new Erro(404, 'Conta não encontrada.');
  if (alvo.id === s.usuario.id && (papel !== 'dono' || !ativo)) throw new Erro(409, 'Você não pode rebaixar ou desativar a própria conta.');
  if (alvo.papel === 'dono' && (papel !== 'dono' || !ativo)) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE papel = 'dono' AND ativo = 1 AND id <> ?").bind(uid).first<{ n: number }>();
    if (!n!.n) throw new Erro(409, 'Precisa existir pelo menos um dono ativo.');
  }
  const st = [env.DB.prepare('UPDATE usuarios SET nome = ?, papel = ?, ativo = ? WHERE id = ?').bind(nome, papel, +ativo, uid)];
  if (senha !== null) st.push(env.DB.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').bind(await hashSenha(senha as string), uid));
  // Mudança de senha, papel ou status derruba as sessões abertas dessa conta.
  if (senha !== null || !ativo || papel !== alvo.papel) st.push(env.DB.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?').bind(uid, s.tokenHash));
  await env.DB.batch(st);
  await auditar(env, s.usuario, 'equipe.editar', alvo.usuario, { papel, ativo, senhaAlterada: senha !== null });
  return json({ ok: true });
}
async function excluirUsuario(env: Env, s: Sessao, uid: number): Promise<Response> {
  if (uid === s.usuario.id) throw new Erro(409, 'Você não pode excluir a própria conta.');
  const alvo = await env.DB.prepare('SELECT usuario, papel FROM usuarios WHERE id = ?').bind(uid).first<{ usuario: string; papel: string }>();
  if (!alvo) throw new Erro(404, 'Conta não encontrada.');
  await env.DB.batch([env.DB.prepare('DELETE FROM sessoes WHERE usuario_id = ?').bind(uid), env.DB.prepare('DELETE FROM usuarios WHERE id = ?').bind(uid)]);
  await auditar(env, s.usuario, 'equipe.excluir', alvo.usuario);
  return json({ ok: true });
}
async function trocarSenha(req: Request, env: Env, s: Sessao): Promise<Response> {
  const b = await lerJson(req, 4096);
  const atual = typeof b.atual === 'string' ? b.atual.slice(0, 200) : '', nova = b.nova;
  if (typeof nova !== 'string' || nova.length < 10 || nova.length > 200) throw new Erro(400, 'A nova senha precisa ter pelo menos 10 caracteres.');
  const u = await env.DB.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').bind(s.usuario.id).first<{ senha_hash: string }>();
  if (!u || !(await conferirSenha(atual, u.senha_hash))) throw new Erro(403, 'A senha atual não confere.');
  await env.DB.batch([
    env.DB.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').bind(await hashSenha(nova), s.usuario.id),
    env.DB.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token_hash <> ?').bind(s.usuario.id, s.tokenHash)
  ]);
  await auditar(env, s.usuario, 'senha.trocar');
  return json({ ok: true });
}

/* ── roteador do painel: toda rota aqui passa por exigir() ── */
export async function admin(req: Request, env: Env, partes: string[]): Promise<Response> {
  const m = req.method, [a, b, c] = partes, n = partes.length;
  const dono = () => exigir(req, env, 'dono'), qualquer = () => exigir(req, env);

  if (a === 'pedidos') {
    if (n === 1 && m === 'GET') { await qualquer(); return pedidosAtivos(env); }
    if (n === 3 && c === 'status' && m === 'POST') return mudarStatus(req, env, await qualquer(), id(b));
  }
  if (a === 'historico' && n === 1 && m === 'GET') { await qualquer(); return historico(req, env); }
  if (a === 'resumo' && n === 1 && m === 'GET') { await dono(); return resumo(req, env); }
  if (a === 'senha' && n === 1 && m === 'POST') return trocarSenha(req, env, await qualquer());

  if (a === 'cardapio' && n === 1 && m === 'GET') { await qualquer(); return json(await montarCardapio(env, true)); }
  if (a === 'categorias') {
    if (n === 1 && m === 'POST') return salvarCategoria(req, env, await dono(), null);
    if (n === 2 && b === 'ordem' && m === 'POST') return ordenar(req, env, await dono(), 'categorias');
    if (n === 2 && m === 'PUT') return salvarCategoria(req, env, await dono(), id(b));
    if (n === 2 && m === 'DELETE') return excluirCategoria(env, await dono(), id(b));
  }
  if (a === 'itens') {
    if (n === 1 && m === 'POST') return salvarItem(req, env, await dono(), null);
    if (n === 2 && b === 'ordem' && m === 'POST') return ordenar(req, env, await dono(), 'itens');
    if (n === 2 && m === 'PUT') return salvarItem(req, env, await dono(), id(b));
    if (n === 2 && m === 'DELETE') return excluirItem(env, await dono(), id(b));
    if (n === 3 && c === 'pausa' && m === 'POST') return pausar(req, env, await qualquer(), 'itens', id(b));
    if (n === 3 && c === 'foto' && m === 'PUT') return enviarFoto(req, env, await dono(), id(b));
    if (n === 3 && c === 'foto' && m === 'DELETE') return removerFoto(env, await dono(), id(b));
  }
  if (a === 'grupos') {
    if (n === 1 && m === 'POST') return salvarGrupo(req, env, await dono(), null);
    if (n === 2 && m === 'PUT') return salvarGrupo(req, env, await dono(), id(b));
    if (n === 2 && m === 'DELETE') return excluirGrupo(env, await dono(), id(b));
  }
  if (a === 'opcoes' && n === 3 && c === 'pausa' && m === 'POST') return pausar(req, env, await qualquer(), 'opcoes', id(b));

  if (a === 'config') {
    if (n === 1 && m === 'GET') { await qualquer(); return json(await lerConfig(env)); }
    if (n === 2 && m === 'PUT') return salvarConfig(req, env, await dono(), b);
  }
  if (a === 'cupons') {
    if (n === 1 && m === 'GET') { await dono(); return json({ cupons: (await env.DB.prepare('SELECT id, codigo, tipo, valor, minimo, validade, limite, usos, ativo FROM cupons ORDER BY id DESC').all()).results }); }
    if (n === 1 && m === 'POST') return salvarCupom(req, env, await dono(), null);
    if (n === 2 && m === 'PUT') return salvarCupom(req, env, await dono(), id(b));
    if (n === 2 && m === 'DELETE') { const s = await dono(); const r = await env.DB.prepare('DELETE FROM cupons WHERE id = ? RETURNING codigo').bind(id(b)).first<{ codigo: string }>(); if (!r) throw new Erro(404, 'Cupom não encontrado.'); await auditar(env, s.usuario, 'cupom.excluir', r.codigo); return json({ ok: true }); }
  }
  if (a === 'clientes' && n === 1 && m === 'GET') {
    await dono();
    const r = await env.DB.prepare("SELECT cliente_tel AS telefone, MAX(cliente_nome) AS nome, COUNT(*) AS pedidos, SUM(total) AS total, MAX(criado) AS ultimo FROM pedidos WHERE status NOT IN ('recusado','cancelado','aguardando_pagamento') GROUP BY cliente_tel ORDER BY ultimo DESC LIMIT 300").all();
    return json({ clientes: r.results });
  }
  if (a === 'equipe') {
    if (n === 1 && m === 'GET') { await dono(); return json({ equipe: (await env.DB.prepare('SELECT id, usuario, nome, papel, ativo, criado FROM usuarios ORDER BY id').all()).results }); }
    if (n === 1 && m === 'POST') return salvarUsuario(req, env, await dono(), null);
    if (n === 2 && m === 'PUT') return salvarUsuario(req, env, await dono(), id(b));
    if (n === 2 && m === 'DELETE') return excluirUsuario(env, await dono(), id(b));
  }
  if (a === 'auditoria' && n === 1 && m === 'GET') {
    await dono();
    const pagina = Math.max(1, Math.min(200, +(new URL(req.url).searchParams.get('pagina') || 1) || 1));
    const r = await env.DB.prepare(`SELECT id, usuario, acao, alvo, detalhe, em FROM auditoria ORDER BY id DESC LIMIT 50 OFFSET ${(pagina - 1) * 50}`).all();
    return json({ pagina, registros: r.results });
  }
  if (a === 'transacoes' && n === 1 && m === 'GET') {
    await dono();
    const r = await env.DB.prepare("SELECT id, status, total, pag_status, pag_id, pag_metodo, criado FROM pedidos WHERE pagamento = 'online' ORDER BY criado DESC LIMIT 100").all();
    return json({ transacoes: r.results });
  }
  // Rota desconhecida: ainda assim exige sessão, para não revelar o que existe a quem está de fora.
  await qualquer();
  throw new Erro(404, 'Não encontrado.');
}
