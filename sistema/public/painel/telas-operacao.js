'use strict';
/* Painel Taika: início, pedidos e histórico. */

/* ── detalhe do pedido (gaveta) ── */
const PROXIMO = {
  novo: () => [['aceito', 'Aceitar pedido', 'btn--fogo'], ['recusado', 'Recusar', 'btn--perigo']],
  aceito: () => [['em_preparo', 'Iniciar preparo', 'btn--fogo'], ['cancelado', 'Cancelar', 'btn--perigo']],
  em_preparo: (p) => [[p.tipo === 'entrega' ? 'saiu_entrega' : 'pronto_retirada', p.tipo === 'entrega' ? 'Saiu para entrega' : 'Pronto para retirada', 'btn--fogo'], ['cancelado', 'Cancelar', 'btn--perigo']],
  saiu_entrega: () => [['concluido', 'Marcar como entregue', 'btn--fogo'], ['cancelado', 'Cancelar', 'btn--perigo']],
  pronto_retirada: () => [['concluido', 'Marcar como retirado', 'btn--fogo'], ['cancelado', 'Cancelar', 'btn--perigo']]
};
async function mudarStatus(p, status) {
  let motivo;
  if (status === 'recusado' || status === 'cancelado') {
    const sel = selecao([['Item em falta', 'Item em falta'], ['Fora da área de entrega', 'Fora da área de entrega'], ['Loja sem capacidade no momento', 'Loja sem capacidade no momento'], ['Cliente desistiu', 'Cliente desistiu'], ['Não foi possível falar com o cliente', 'Não foi possível falar com o cliente'], ['', 'Outro motivo…']], 'Item em falta');
    const outro = entrada('', { maxlength: '200', placeholder: 'Descreva o motivo' });
    const co = campo('Qual motivo?', outro); co.hidden = true;
    sel.addEventListener('change', () => { co.hidden = sel.value !== ''; if (!co.hidden) outro.focus(); });
    const r = await dialogo((status === 'recusado' ? 'Recusar' : 'Cancelar') + ' o pedido nº ' + p.id, h('div', null, campo('Motivo (o cliente vê esta mensagem)', sel), co),
      { ok: status === 'recusado' ? 'Recusar pedido' : 'Cancelar pedido', cancelar: 'Voltar', perigo: true, aoSalvar: async () => { motivo = (sel.value || outro.value).trim(); if (motivo.length < 3) throw new Error('Informe o motivo.'); await api('POST', 'pedidos/' + p.id + '/status', { status, motivo }); } });
    if (!r) return false;
  } else {
    try { await api('POST', 'pedidos/' + p.id + '/status', { status }); } catch (e) { toast(e.message, true); buscarPedidos(); return false; }
  }
  toast('Pedido nº ' + p.id + ': ' + STATUS[status].toLowerCase());
  await buscarPedidos();
  return true;
}
function corpoPedido(p) {
  const zap = 'https://wa.me/' + (p.cliente_tel.length <= 11 ? '55' : '') + p.cliente_tel;
  return [
    h('div', { class: 'bloco' }, h('h4', { text: 'Cliente' }), h('p', null, h('strong', { text: p.cliente_nome })), h('p', null, fone(p.cliente_tel), ' · ', h('a', { href: zap, target: '_blank', rel: 'noopener noreferrer', text: 'WhatsApp' }))),
    h('div', { class: 'bloco' }, h('h4', { text: p.tipo === 'entrega' ? 'Entrega' : 'Retirada no balcão' }), p.tipo === 'entrega' ? [h('p', { text: p.endereco }), h('p', { class: 'mut', text: p.bairro })] : h('p', { class: 'mut', text: 'O cliente vem buscar.' })),
    h('div', { class: 'bloco' }, h('h4', { text: 'Itens' }), h('ul', { class: 'itens-ped' }, p.itens.map((i) => h('li', null,
      h('div', null, h('strong', { text: i.qtd + '× ' + i.nome }), i.opcoes.map((o) => h('small', { text: (o.preco ? '+ ' : '· ') + o.nome + (o.preco ? ' (' + brl(o.preco) + ')' : '') })), i.obs && h('small', { class: 'obs', text: 'Obs.: ' + i.obs })),
      h('span', { class: 'num nowrap', text: brl(i.total) })))),
      p.obs && h('p', { class: 'aviso', text: 'Observação do pedido: ' + p.obs })),
    h('div', { class: 'bloco' }, h('h4', { text: 'Valores' }),
      h('div', { class: 'soma' }, h('span', { text: 'Subtotal' }), h('span', { class: 'num', text: brl(p.subtotal) })),
      p.desconto > 0 && h('div', { class: 'soma' }, h('span', { text: 'Desconto' + (p.cupom ? ' (' + p.cupom + ')' : '') }), h('span', { class: 'num', text: '− ' + brl(p.desconto) })),
      h('div', { class: 'soma' }, h('span', { text: p.tipo === 'entrega' ? 'Taxa de entrega' : 'Retirada' }), h('span', { class: 'num', text: p.taxa ? brl(p.taxa) : 'Grátis' })),
      h('div', { class: 'soma tot' }, h('span', { text: 'Total' }), h('span', { class: 'num', text: brl(p.total) })),
      h('p', { class: 'peq', text: 'Pagamento: ' + PAG[p.pagamento] + ' · ' + PAGST[p.pag_status] + (p.troco ? ' · troco para ' + brl(p.troco) : '') })),
    p.motivo && h('div', { class: 'bloco' }, h('h4', { text: 'Motivo' }), h('p', { text: p.motivo })),
    h('div', { class: 'bloco' }, h('h4', { text: 'Andamento' }), h('ul', { class: 'linha-tempo' }, p.eventos.map((e) => h('li', null, h('span', { text: STATUS[e.status] + (e.usuario ? ' · ' + e.usuario : '') }), h('span', { class: 'mut num', text: dataHora(e.em) })))))
  ];
}
/* comanda impressa: layout de cupom de impressora térmica (80 mm) */
function imprimirPedido(p) {
  const L = CFG.loja, E = L.endereco || {}, entrega = p.tipo === 'entrega';
  const v = (c) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lin = (a, b, cls) => h('div', { class: 'r-l' + (cls ? ' ' + cls : '') }, h('span', { text: a }), h('i'), h('span', { text: b }));
  const sep = (dupla) => h('div', { class: dupla ? 'r-sep r-sep--d' : 'r-sep' });
  const pago = p.pag_status === 'pago' || p.pag_status === 'simulado';
  const troco = p.pagamento === 'dinheiro' && p.troco > p.total ? p.troco - p.total : 0;
  $('#imprimir').replaceChildren(h('div', { class: 'recibo' },
    h('div', { class: 'r-cab' },
      h('p', { class: 'r-loja', text: (L.nome || 'Taika Sushi').toUpperCase() }),
      E.rua && h('p', { text: E.rua + (E.bairro ? ', ' + E.bairro : '') }),
      E.cidade && h('p', { text: E.cidade + (E.uf ? ' - ' + E.uf : '') }),
      L.telefone && h('p', { text: 'Tel.: ' + fone(String(L.telefone).replace(/\D/g, '')) })),
    sep(true),
    h('p', { class: 'r-tit', text: 'PEDIDO Nº ' + String(p.id).padStart(4, '0') }),
    h('p', { class: 'r-tipo' }, h('span', { text: entrega ? 'ENTREGA' : 'RETIRADA NO BALCÃO' })),
    h('p', { class: 'r-c', text: dataHora(p.criado) }),
    sep(),
    h('p', { class: 'r-rot', text: 'CLIENTE' }),
    h('p', { class: 'r-b', text: p.cliente_nome }),
    h('p', { text: fone(p.cliente_tel) }),
    entrega && [h('p', { class: 'r-rot r-esp', text: 'ENDEREÇO' }), h('p', { class: 'r-b', text: p.endereco }), h('p', { text: p.bairro })],
    sep(),
    h('div', { class: 'r-cols' }, h('span', { text: 'QTD  ITEM' }), h('span', { text: 'VALOR' })),
    sep(),
    p.itens.map((i) => h('div', { class: 'r-item' },
      h('div', { class: 'r-il' }, h('span', { class: 'r-q', text: i.qtd + 'x' }), h('span', { class: 'r-n', text: i.nome }), h('span', { class: 'r-v', text: v(i.total) })),
      i.qtd > 1 && h('p', { class: 'r-sub', text: i.qtd + ' x ' + v(i.total / i.qtd) }),
      i.opcoes.map((o) => h('p', { class: 'r-sub', text: '+ ' + o.nome + (o.preco ? '  (' + v(o.preco) + ')' : '') })),
      i.obs && h('p', { class: 'r-sub r-obs', text: 'OBS: ' + i.obs }))),
    sep(),
    lin('Subtotal', v(p.subtotal)),
    p.desconto > 0 && lin('Desconto' + (p.cupom ? ' (' + p.cupom + ')' : ''), '-' + v(p.desconto)),
    lin(entrega ? 'Taxa de entrega' : 'Retirada', p.taxa ? v(p.taxa) : 'GRÁTIS'),
    sep(),
    lin('TOTAL R$', v(p.total), 'r-tot'),
    sep(),
    lin('Pagamento', PAG[p.pagamento]),
    lin('Situação', pago ? (p.pag_status === 'pago' ? 'PAGO' : 'PAGO (TESTE)') : entrega ? 'COBRAR NA ENTREGA' : 'COBRAR NO BALCÃO'),
    p.troco > 0 && lin('Troco para', v(p.troco)),
    troco > 0 && lin('Levar de troco', v(troco), 'r-b'),
    p.obs && [sep(), h('p', { class: 'r-rot', text: 'OBSERVAÇÃO DO PEDIDO' }), h('p', { class: 'r-caixa', text: p.obs })],
    sep(true),
    h('p', { class: 'r-c r-b', text: 'Obrigado pela preferência!' }),
    h('p', { class: 'r-c', text: 'NÃO É DOCUMENTO FISCAL' }),
    h('p', { class: 'r-c r-mini', text: 'Impresso em ' + dataHora(Math.floor(Date.now() / 1000)) })));
  window.print();
}
let gaveta = null;
function fecharGaveta() { if (gaveta) { gaveta.el.remove(); gaveta = null; } }
function abrirGaveta(p, aoMudar) {
  fecharGaveta();
  const corpo = h('div', { class: 'gaveta__corpo' }), pe = h('div', { class: 'gaveta__pe' }), tit = h('div');
  const el = h('aside', { class: 'gaveta', role: 'dialog', 'aria-label': 'Pedido nº ' + p.id }, h('div', { class: 'gaveta__cab' }, tit, botao('✕', fecharGaveta, 'btn--linha ico', { 'aria-label': 'Fechar' })), corpo, pe);
  gaveta = { el, id: p.id, pintar(q) {
    tit.replaceChildren(h('h2', { text: 'Pedido nº ' + q.id }), h('p', { class: 'peq mut', text: dataHora(q.criado) }), chip(STATUS[q.status], q.status === 'novo' ? 'erro' : q.status === 'concluido' ? 'ok' : q.status === 'recusado' || q.status === 'cancelado' ? 'aviso' : ''));
    corpo.replaceChildren(...corpoPedido(q).flat().filter(Boolean));
    const ac = (PROXIMO[q.status] ? PROXIMO[q.status](q) : []).map(([st, nome, cls]) => botao(nome, async (e) => { e.target.disabled = true; const ok = await mudarStatus(q, st); if (aoMudar) aoMudar(); if (!ok) e.target.disabled = false; }, cls));
    pe.replaceChildren(...ac, botao('Imprimir', () => imprimirPedido(q), 'btn--linha'));
  } };
  gaveta.pintar(p);
  document.body.append(el);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) fecharGaveta(); });

/* ── pedidos (quadro) ── */
const COLUNAS = [['novo', 'Novos', ['novo']], ['aceito', 'Aceitos', ['aceito']], ['preparo', 'Em preparo', ['em_preparo']], ['rota', 'Em rota / prontos', ['saiu_entrega', 'pronto_retirada']], ['fim', 'Finalizados hoje', ['concluido', 'recusado', 'cancelado']]];
TELAS.pedidos = {
  async abrir(alvo) {
    this.quadro = h('div', { class: 'quadro' });
    const som = marca('Som de pedido novo', prefs.get('som', true)); const rep = marca('Repetir até aceitar', prefs.get('repetir', true)); const av = marca('Aviso na tela', prefs.get('aviso', true));
    $('input', som).addEventListener('change', (e) => { prefs.set('som', e.target.checked); if (e.target.checked) bip(); });
    $('input', rep).addEventListener('change', (e) => prefs.set('repetir', e.target.checked));
    $('input', av).addEventListener('change', (e) => prefs.set('aviso', e.target.checked));
    alvo.replaceChildren(cab('Pedidos', 'Atualiza sozinho a cada poucos segundos.', [som, rep, av, botao('Testar som', bip, 'btn--linha btn--peq')]), this.quadro);
    this.atualizar();
  },
  cartao(p) {
    const fim = ['concluido', 'recusado', 'cancelado'].includes(p.status);
    const prox = PROXIMO[p.status] && PROXIMO[p.status](p)[0];
    const el = h('div', { class: 'ped' + (p.status === 'novo' ? ' ped--novo' : '') + (fim ? ' ped--fim' : ''), tabindex: '0', role: 'button', 'aria-label': 'Abrir pedido nº ' + p.id },
      h('div', { class: 'ped__l1' }, h('span', { text: 'Nº ' + p.id }), h('span', { class: 'num', text: brl(p.total) })),
      h('div', { class: 'ped__l2', text: p.cliente_nome + ' · ' + p.itens.reduce((a, i) => a + i.qtd, 0) + (p.itens.reduce((a, i) => a + i.qtd, 0) === 1 ? ' item' : ' itens') }),
      h('div', { class: 'ped__l3' }, chip(p.tipo === 'entrega' ? 'Entrega' : 'Retirada', 'sem'), fim ? chip(STATUS[p.status], p.status === 'concluido' ? 'ok' : 'aviso') : h('span', { class: 'mut num', data: { desde: p.status === 'novo' ? p.criado : p.atualizado }, text: haQuanto(p.status === 'novo' ? p.criado : p.atualizado, AGORA) })),
      prox && botao(prox[1], async (e) => { e.stopPropagation(); e.target.disabled = true; if (!(await mudarStatus(p, prox[0]))) e.target.disabled = false; }, (p.status === 'novo' ? 'btn--fogo' : '') + ' btn--peq'));
    const abrir = () => abrirGaveta(p, () => {});
    el.addEventListener('click', (e) => { if (!e.target.closest('button')) abrir(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) abrir(); });
    return el;
  },
  atualizar() {
    if (!this.quadro || !this.quadro.isConnected) return;
    this.quadro.replaceChildren(...COLUNAS.map(([id, nome, sts]) => {
      const l = PEDIDOS.filter((p) => sts.includes(p.status)).sort((a, b) => id === 'fim' ? b.atualizado - a.atualizado : a.criado - b.criado);
      return h('section', { class: 'col col--' + id }, h('h3', null, nome, h('b', { text: l.length })), l.length ? l.map((p) => this.cartao(p)) : h('p', { class: 'peq mut', text: id === 'novo' ? 'Nenhum pedido aguardando.' : '—' }));
    }));
    if (gaveta) { const p = PEDIDOS.find((x) => x.id === gaveta.id); if (p) gaveta.pintar(p); }
  },
  relogio() { if (this.quadro) this.quadro.querySelectorAll('[data-desde]').forEach((s) => { s.textContent = haQuanto(+s.dataset.desde, AGORA); }); },
  sair() { fecharGaveta(); }
};

/* ── histórico ── */
TELAS.historico = {
  f: { de: '', ate: '', status: '', tipo: '', pagamento: '', q: '', pagina: 1 },
  async abrir(alvo) {
    const f = this.f, lista = h('div', { class: 'cartao' });
    const de = entrada(f.de, { type: 'date' }), ate = entrada(f.ate, { type: 'date' });
    const st = selecao([['', 'Todos']].concat(Object.entries(STATUS)), f.status), tp = selecao([['', 'Todos'], ['entrega', 'Entrega'], ['retirada', 'Retirada']], f.tipo);
    const pg = selecao([['', 'Todas']].concat(Object.entries(PAG)), f.pagamento), q = entrada(f.q, { type: 'search', placeholder: 'Nº, nome ou telefone', maxlength: '60' });
    const carregar = async () => {
      Object.assign(f, { de: de.value, ate: ate.value, status: st.value, tipo: tp.value, pagamento: pg.value, q: q.value.trim() });
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '').map(([k, v]) => [k, String(v)]));
      let r; try { r = await api('GET', 'historico?' + qs); } catch (e) { lista.replaceChildren(h('p', { class: 'aviso aviso--erro', text: e.message })); return; }
      const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
      lista.replaceChildren(
        h('p', { class: 'mut peq', text: r.total + (r.total === 1 ? ' pedido' : ' pedidos') + ' · ' + brl(r.soma) + ' em pedidos válidos' }),
        tabela([{ t: 'Nº' }, { t: 'Data' }, { t: 'Cliente' }, { t: 'Tipo' }, { t: 'Pagamento' }, { t: 'Status' }, { t: 'Total', dir: 1 }, { t: '' }],
          r.pedidos.map((p) => h('tr', null, h('td', { class: 'num', text: p.id }), h('td', { class: 'nowrap', text: dataHora(p.criado) }), h('td', { text: p.cliente_nome }), h('td', { text: p.tipo === 'entrega' ? 'Entrega' : 'Retirada' }),
            h('td', { text: PAG[p.pagamento] }), h('td', null, chip(STATUS[p.status], p.status === 'concluido' ? 'ok' : p.status === 'recusado' || p.status === 'cancelado' ? 'aviso' : p.status === 'novo' ? 'erro' : '')),
            h('td', { class: 'dir num', text: brl(p.total) }), h('td', { class: 'acoes' }, botao('Ver', () => abrirGaveta(p, carregar), 'btn--linha btn--peq')))), 'Nenhum pedido com esses filtros.'),
        h('div', { class: 'pag' }, botao('← Anterior', () => { f.pagina--; carregar(); }, 'btn--linha btn--peq', { disabled: f.pagina <= 1 }), h('span', { class: 'peq mut', text: 'Página ' + r.pagina + ' de ' + paginas }), botao('Próxima →', () => { f.pagina++; carregar(); }, 'btn--linha btn--peq', { disabled: f.pagina >= paginas })));
    };
    const filtrar = () => { f.pagina = 1; carregar(); };
    [de, ate, st, tp, pg].forEach((x) => x.addEventListener('change', filtrar));
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') filtrar(); });
    const rot = (t, x) => h('label', null, t, x);
    alvo.replaceChildren(cab('Histórico de pedidos', 'Todos os pedidos, com filtros.'),
      h('div', { class: 'filtros' }, rot('De', de), rot('Até', ate), rot('Status', st), rot('Tipo', tp), rot('Pagamento', pg), rot('Busca', q), botao('Buscar', filtrar, 'btn--peq'),
        botao('Limpar', () => { de.value = ate.value = st.value = tp.value = pg.value = q.value = ''; filtrar(); }, 'btn--linha btn--peq')), lista);
    await carregar();
  },
  sair() { fecharGaveta(); }
};

/* ── início ── */
TELAS.inicio = {
  dias: 30,
  async abrir(alvo) {
    const r = await api('GET', 'resumo?dias=' + this.dias);
    const comp = (a, b, f) => b ? (a >= b ? '▲ ' : '▼ ') + 'ontem: ' + f(b) : 'ontem: ' + f(0);
    const max = Math.max(1, ...r.porDia.map((d) => d.receita));
    const st = Object.fromEntries(r.porStatus.map((s) => [s.status, s.n]));
    const andamento = ['novo', 'aceito', 'em_preparo', 'saiu_entrega', 'pronto_retirada'].reduce((a, k) => a + (st[k] || 0), 0);
    const per = selecao([[7, 'Últimos 7 dias'], [30, 'Últimos 30 dias'], [90, 'Últimos 90 dias']], this.dias, { 'aria-label': 'Período' });
    per.addEventListener('change', () => { this.dias = +per.value; this.abrir(alvo); });
    const rank = (l, f) => l.length ? h('ol', { class: 'rank' }, l.map((x) => h('li', null, h('span', { text: x.nome }), h('strong', { class: 'num', text: f(x) })))) : h('p', { class: 'vazio', text: 'Quando as primeiras vendas acontecerem, elas aparecem aqui.' });
    alvo.replaceChildren(cab('Início', 'Resumo de hoje, ' + new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) + '.', [botao('Atualizar', () => this.abrir(alvo), 'btn--linha btn--peq')]),
      h('div', { class: 'grade g4' },
        h('div', { class: 'kpi kpi--fogo' }, h('small', { text: 'Pedidos hoje' }), h('strong', { class: 'num', text: r.hoje.pedidos }), h('em', { text: comp(r.hoje.pedidos, r.ontem.pedidos, String) })),
        h('div', { class: 'kpi' }, h('small', { text: 'Faturamento hoje' }), h('strong', { class: 'num', text: brl(r.hoje.receita) }), h('em', { text: comp(r.hoje.receita, r.ontem.receita, brl) })),
        h('div', { class: 'kpi' }, h('small', { text: 'Ticket médio' }), h('strong', { class: 'num', text: brl(r.hoje.ticket) }), h('em', { text: comp(r.hoje.ticket, r.ontem.ticket, brl) })),
        h('div', { class: 'kpi' }, h('small', { text: 'Em andamento' }), h('strong', { class: 'num', text: andamento }), h('em', { text: (st.recusado || 0) + (st.cancelado || 0) + ' recusados ou cancelados hoje' }))),
      h('div', { class: 'cartao', style: null }, h('h2', { text: 'Faturamento dos últimos 7 dias' }),
        h('div', { class: 'barras' }, r.porDia.map((d) => { const b = h('i', { title: brl(d.receita) + ' · ' + d.pedidos + ' pedidos' }); b.style.height = Math.round(d.receita / max * 100) + '%'; return h('div', null, h('span', { class: 'num', text: d.receita ? brl(d.receita) : '—' }), b, h('span', { text: d.dia.slice(8) + '/' + d.dia.slice(5, 7) })); }))),
      h('div', { class: 'cab', style: null }, h('h2', { text: 'Desempenho de itens' }), per),
      h('div', { class: 'grade g2' },
        h('div', { class: 'cartao' }, h('h2', { text: 'Produtos mais vendidos' }), rank(r.maisVendidos, (x) => x.qtd + ' un · ' + brl(x.soma))),
        h('div', { class: 'cartao' }, h('h2', { text: 'Opcionais mais pedidos' }), rank(r.opcionais, (x) => x.qtd + ' un'))));
  }
};
