'use strict';
/* Painel Taika: cardápio, opcionais, loja, entrega, pagamentos, equipe, cupons, clientes, recursos, auditoria, conta. */

/* ── cardápio ── */
let CARD = null;
const mover = (l, i, d) => { const n = l.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); return n; };
TELAS.cardapio = {
  cat: null,
  async abrir(alvo) { this.alvo = alvo; CARD = await api('GET', 'cardapio'); this.pintar(); },
  async recarregar() { CARD = await api('GET', 'cardapio'); this.pintar(); },
  pintar() {
    const cats = CARD.categorias, eu = this;
    if (!cats.find((c) => c.id === this.cat)) this.cat = cats[0] ? cats[0].id : null;
    const atual = cats.find((c) => c.id === this.cat);
    const listaCats = h('ul', { class: 'cats' }, cats.map((c, i) => h('li', { class: (c.id === this.cat ? 'on' : '') + (c.ativo ? '' : ' inativa') },
      h('button', { type: 'button', class: 'nome', title: c.nome + (c.ativo ? '' : ' (oculta no site)'), onclick: () => { this.cat = c.id; this.pintar(); } }, c.nome + ' (' + c.itens.length + ')'),
      DONO() && [h('button', { type: 'button', class: 'mini', disabled: i === 0, 'aria-label': 'Subir ' + c.nome, text: '↑', onclick: () => this.ordenarCats(mover(cats, i, -1)) }),
        h('button', { type: 'button', class: 'mini', disabled: i === cats.length - 1, 'aria-label': 'Descer ' + c.nome, text: '↓', onclick: () => this.ordenarCats(mover(cats, i, 1)) })])));
    const itens = atual ? atual.itens : [];
    const linhas = itens.map((it, i) => h('tr', { class: it.pausado ? 'pausado' : '' },
      h('td', null, it.foto ? h('img', { class: 'thumb', src: it.foto, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb thumb--vazio', text: 'sem foto' })),
      h('td', null, h('strong', { text: it.nome }), it.desc && h('div', { class: 'peq mut', text: it.desc.length > 90 ? it.desc.slice(0, 90) + '…' : it.desc }), it.grupos.length > 0 && h('div', { class: 'peq mut', text: it.grupos.length + (it.grupos.length === 1 ? ' grupo de opcionais' : ' grupos de opcionais') })),
      h('td', { class: 'num nowrap', text: brl(it.preco) }),
      h('td', { class: 'chv' }, h('div', { class: 'lin' }, chave(!it.pausado, async (lig, inp) => { const ok = await tentar(() => api('POST', 'itens/' + it.id + '/pausa', { pausado: !lig }), lig ? it.nome + ' voltou ao cardápio.' : it.nome + ' marcado como esgotado.'); if (ok) { it.pausado = !lig; eu.pintar(); } else inp.checked = !lig; }, 'Disponível'), h('span', { class: 'peq', text: it.pausado ? 'Esgotado' : 'Disponível' }))),
      h('td', { class: 'acoes' }, DONO() && [
        h('button', { type: 'button', class: 'mini', disabled: i === 0, 'aria-label': 'Subir', text: '↑', onclick: () => this.ordenarItens(mover(itens, i, -1)) }),
        h('button', { type: 'button', class: 'mini', disabled: i === itens.length - 1, 'aria-label': 'Descer', text: '↓', onclick: () => this.ordenarItens(mover(itens, i, 1)) }),
        botao('Editar', () => this.editarItem(it), 'btn--linha btn--peq'), botao('Excluir', () => this.excluirItem(it), 'btn--perigo btn--peq')])));
    this.alvo.replaceChildren(
      cab('Itens e categorias', DONO() ? 'Mudanças aparecem no site em alguns segundos.' : 'Você pode marcar itens como esgotados.', DONO() && [botao('Nova categoria', () => this.editarCat(null), 'btn--linha'), botao('Novo item', () => this.editarItem(null), 'btn--fogo', { disabled: !cats.length })]),
      h('div', { class: 'duas' },
        h('div', { class: 'cartao' }, h('h2', { text: 'Categorias' }), cats.length ? listaCats : h('p', { class: 'vazio', text: 'Crie a primeira categoria.' })),
        h('div', { class: 'cartao' }, atual ? [h('div', { class: 'cab' }, h('div', null, h('h2', { text: atual.nome }), !atual.ativo && h('p', { class: 'peq', text: 'Categoria oculta no site.' })),
          DONO() && h('div', { class: 'cab__acoes' }, botao('Editar categoria', () => this.editarCat(atual), 'btn--linha btn--peq'), botao('Excluir categoria', () => this.excluirCat(atual), 'btn--perigo btn--peq'))),
          tabela([{ t: 'Foto' }, { t: 'Item' }, { t: 'Preço' }, { t: 'No site' }, { t: '' }], linhas, 'Nenhum item nesta categoria.')] : h('p', { class: 'vazio', text: 'Selecione uma categoria.' }))));
  },
  async ordenarCats(nova) { if (await tentar(() => api('POST', 'categorias/ordem', { ids: nova.map((c) => c.id) }))) { CARD.categorias = nova; this.pintar(); } },
  async ordenarItens(nova) { const c = CARD.categorias.find((x) => x.id === this.cat); if (await tentar(() => api('POST', 'itens/ordem', { ids: nova.map((i) => i.id) }))) { c.itens = nova; this.pintar(); } },
  async editarCat(c) {
    const nome = entrada(c ? c.nome : '', { maxlength: '80', required: true }), ativo = marca('Mostrar no site', c ? c.ativo : true);
    const r = await dialogo(c ? 'Editar categoria' : 'Nova categoria', h('div', null, campo('Nome', nome, 'Dica: um texto entre parênteses vira a unidade, por exemplo "Hossomaki (8 peças)".'), ativo),
      { aoSalvar: async () => { const corpo = { nome: nome.value, ativo: $('input', ativo).checked }; const x = c ? await api('PUT', 'categorias/' + c.id, corpo) : await api('POST', 'categorias', corpo); if (!c) this.cat = x.id; } });
    if (r) { toast('Categoria salva.'); await this.recarregar(); }
  },
  async excluirCat(c) { if (await confirmar('Excluir categoria', 'Excluir "' + c.nome + '"? Só é possível se ela não tiver itens.', 'Excluir') && await tentar(() => api('DELETE', 'categorias/' + c.id), 'Categoria excluída.')) await this.recarregar(); },
  async excluirItem(it) { if (await confirmar('Excluir item', 'Excluir "' + it.nome + '" do cardápio? Pedidos antigos continuam no histórico.', 'Excluir') && await tentar(() => api('DELETE', 'itens/' + it.id), 'Item excluído.')) await this.recarregar(); },
  async editarItem(it) {
    const cat = selecao(CARD.categorias.map((c) => [c.id, c.nome]), it ? CARD.categorias.find((c) => c.itens.includes(it)).id : this.cat);
    const nome = entrada(it ? it.nome : '', { maxlength: '120', required: true }), desc = h('textarea', { maxlength: '600' }); desc.value = it ? it.desc : '';
    const preco = entrada(it ? reais(it.preco) : '', { inputmode: 'decimal', placeholder: '0,00' });
    const grupos = CARD.grupos.map((g) => marca(g.nome + (g.min > 0 ? ' (obrigatório)' : ''), it ? it.grupos.includes(g.id) : false, { value: g.id }));
    let arquivo = null, remover = false;
    const previa = it && it.foto ? h('img', { class: 'thumb', src: it.foto, alt: '' }) : h('div', { class: 'thumb thumb--vazio', text: 'sem foto' });
    const fotoBox = h('div', { class: 'foto-ed' }, previa);
    const sel = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'sr', tabindex: '-1' });
    sel.addEventListener('change', () => { const f = sel.files[0]; if (!f) return; if (f.size > 2 * 1024 * 1024) { toast('A foto passa de 2 MB.', true); sel.value = ''; return; } arquivo = f; remover = false; const im = h('img', { class: 'thumb', alt: '' }); im.src = URL.createObjectURL(f); fotoBox.firstChild.replaceWith(im); });
    fotoBox.append(h('div', null, botao('Escolher foto', () => sel.click(), 'btn--linha btn--peq'), ' ', botao('Remover', () => { arquivo = null; remover = true; sel.value = ''; fotoBox.firstChild.replaceWith(h('div', { class: 'thumb thumb--vazio', text: 'sem foto' })); }, 'btn--linha btn--peq'), h('p', { class: 'peq mut', text: 'JPG, PNG ou WebP, até 2 MB.' })), sel);
    const r = await dialogo(it ? 'Editar item' : 'Novo item', h('div', null, h('div', { class: 'lin' }, campo('Nome', nome), h('div', { class: 'fixo' }, campo('Preço (R$)', preco))), campo('Categoria', cat), campo('Descrição', desc),
      h('div', { class: 'campo' }, h('span', { text: 'Foto' }), fotoBox), h('div', { class: 'campo' }, h('span', { text: 'Grupos de opcionais' }), grupos.length ? grupos : h('p', { class: 'peq mut', text: 'Nenhum grupo criado ainda.' }))),
      { largo: true, aoSalvar: async () => {
        const corpo = { categoria: +cat.value, nome: nome.value, desc: desc.value, preco: centavos(preco.value), grupos: grupos.map((g) => $('input', g)).filter((i) => i.checked).map((i) => +i.value) };
        const x = it ? await api('PUT', 'itens/' + it.id, corpo) : await api('POST', 'itens', corpo);
        const id = it ? it.id : x.id;
        if (arquivo) await api('PUT', 'itens/' + id + '/foto', undefined, { body: arquivo, type: arquivo.type });
        else if (remover && it && it.foto) await api('DELETE', 'itens/' + id + '/foto');
        this.cat = corpo.categoria;
      } });
    if (r) { toast('Item salvo.'); await this.recarregar(); }
  }
};

/* ── opcionais ── */
TELAS.opcionais = {
  async abrir(alvo) { this.alvo = alvo; CARD = await api('GET', 'cardapio'); this.pintar(); },
  pintar() {
    const usados = (g) => CARD.categorias.reduce((a, c) => a + c.itens.filter((i) => i.grupos.includes(g.id)).length, 0);
    this.alvo.replaceChildren(cab('Opcionais', 'Grupos de acompanhamentos e adicionais ligados aos itens.', DONO() && [botao('Novo grupo', () => this.editar(null), 'btn--fogo')]),
      h('div', null, CARD.grupos.length ? CARD.grupos.map((g) => h('div', { class: 'cartao grupo' },
        h('h3', null, g.nome, chip(g.min > 0 ? 'Obrigatório' : 'Opcional', g.min > 0 ? 'aviso' : ''), h('span', { class: 'peq mut', text: (g.min === g.max ? 'escolher ' + g.min : 'de ' + g.min + ' a ' + g.max) + ' · usado em ' + usados(g) + ' itens' }),
          DONO() && h('span', { class: 'cab__acoes', style: null }, botao('Editar', () => this.editar(g), 'btn--linha btn--peq'), botao('Excluir', () => this.excluir(g), 'btn--perigo btn--peq'))),
        h('ul', null, g.opcoes.map((o) => h('li', { class: o.pausado ? 'pausado' : '' }, chave(!o.pausado, async (lig, inp) => { const ok = await tentar(() => api('POST', 'opcoes/' + o.id + '/pausa', { pausado: !lig })); if (ok) { o.pausado = !lig; this.pintar(); } else inp.checked = !lig; }, 'Disponível'), h('span', { text: o.nome }), h('strong', { class: 'num peq', text: o.preco ? '+ ' + brl(o.preco) : 'grátis' })))))) : h('p', { class: 'vazio', text: 'Nenhum grupo de opcionais.' })));
  },
  async excluir(g) { if (await confirmar('Excluir grupo', 'Excluir "' + g.nome + '"? Ele será retirado de todos os itens.', 'Excluir') && await tentar(() => api('DELETE', 'grupos/' + g.id), 'Grupo excluído.')) await this.abrir(this.alvo); },
  async editar(g) {
    const nome = entrada(g ? g.nome : '', { maxlength: '120' }), min = entrada(g ? g.min : 0, { type: 'number', min: '0', max: '20' }), max = entrada(g ? g.max : 1, { type: 'number', min: '1', max: '20' });
    const lista = h('div', { class: 'ops-ed' });
    const linha = (o) => { const n = entrada(o ? o.nome : '', { maxlength: '80', placeholder: 'Nome da opção' }), p = entrada(o && o.preco ? reais(o.preco) : '', { inputmode: 'decimal', placeholder: '0,00' }); const l = h('div', { class: 'lin', data: { id: o ? o.id : '' } }, n, h('div', { class: 'fixo' }, p), botao('✕', () => l.remove(), 'btn--linha ico fixo', { 'aria-label': 'Remover opção' })); l.ler = () => ({ id: o ? o.id : undefined, nome: n.value, preco: centavos(p.value) }); return l; };
    (g ? g.opcoes : [null, null]).forEach((o) => lista.append(linha(o)));
    const r = await dialogo(g ? 'Editar grupo de opcionais' : 'Novo grupo de opcionais', h('div', null, campo('Nome do grupo (o cliente vê como pergunta)', nome),
      h('div', { class: 'lin' }, campo('Mínimo de escolhas', min, '0 = opcional'), campo('Máximo de escolhas', max)),
      h('div', { class: 'campo' }, h('span', { text: 'Opções e preço adicional (R$)' }), lista, h('p', { style: null }, botao('+ Adicionar opção', () => { const l = linha(null); lista.append(l); $('input', l).focus(); }, 'btn--linha btn--peq')))),
      { largo: true, aoSalvar: async () => { const corpo = { nome: nome.value, min: +min.value, max: +max.value, opcoes: [...lista.children].map((l) => l.ler()).filter((o) => o.nome.trim()) }; if (g) await api('PUT', 'grupos/' + g.id, corpo); else await api('POST', 'grupos', corpo); } });
    if (r) { toast('Grupo salvo.'); await this.abrir(this.alvo); }
  }
};

/* ── loja: dados, horários ── */
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
TELAS.loja = {
  async abrir(alvo) {
    CFG = await api('GET', 'config');
    const L = CFG.loja, E = L.endereco;
    const nome = entrada(L.nome, { maxlength: '80' }), bv = entrada(L.boasVindas, { maxlength: '120' }), sobre = h('textarea', { maxlength: '600' }); sobre.value = L.sobre || '';
    const tel = entrada(L.telefone, { type: 'tel', maxlength: '20' }), zap = marca('Mostrar botão do WhatsApp no site', L.whatsapp);
    const rua = entrada(E.rua, { maxlength: '120' }), bairro = entrada(E.bairro, { maxlength: '80' }), cidade = entrada(E.cidade, { maxlength: '80' }), uf = entrada(E.uf, { maxlength: '2' }), comp = entrada(E.complemento, { maxlength: '120' });
    const dias = [1, 2, 3, 4, 5, 6, 0].map((d) => { const x = CFG.horarios[d]; const at = marca(DIAS[d], x.ativo), a = entrada(x.abre, { type: 'time' }), f = entrada(x.fecha, { type: 'time' }); return { d, at, a, f, tr: h('tr', null, h('td', null, at), h('td', null, a), h('td', null, f)) }; });
    alvo.replaceChildren(cab('Dados e horários', 'O que o cliente vê sobre a loja no site.'),
      h('div', { class: 'grade g2' },
        h('div', { class: 'cartao' }, h('h2', { text: 'Dados da loja' }), campo('Nome', nome), campo('Frase de boas-vindas', bv), campo('Sobre a loja', sobre), campo('Telefone / WhatsApp (com DDI e DDD)', tel, 'Exemplo: +5591999990000'), zap,
          h('div', { class: 'lin' }, campo('Rua', rua), campo('Bairro', bairro)), h('div', { class: 'lin' }, campo('Cidade', cidade), h('div', { class: 'fixo' }, campo('UF', uf))), campo('Complemento', comp),
          h('div', { class: 'acoes-form' }, botao('Salvar dados', () => tentar(async () => { const r = await api('PUT', 'config/loja', { nome: nome.value, boasVindas: bv.value, sobre: sobre.value, telefone: tel.value, whatsapp: $('input', zap).checked, endereco: { rua: rua.value, bairro: bairro.value, cidade: cidade.value, uf: uf.value, complemento: comp.value } }); CFG.loja = r.valor; }, 'Dados da loja salvos.'), 'btn--fogo'))),
        h('div', { class: 'cartao' }, h('h2', { text: 'Horários de funcionamento' }), h('p', { class: 'peq mut', text: 'Valem quando a loja está em "Seguir horários" (seletor no topo). Fuso: ' + L.fuso + '.' }),
          h('div', { class: 'tabela' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: 'Dia' }), h('th', { text: 'Abre' }), h('th', { text: 'Fecha' }))), h('tbody', null, dias.map((x) => x.tr)))),
          h('div', { class: 'acoes-form' }, botao('Salvar horários', () => tentar(async () => { const l = []; dias.forEach((x) => { l[x.d] = { ativo: $('input', x.at).checked, abre: x.a.value, fecha: x.f.value }; }); const r = await api('PUT', 'config/horarios', { dias: l }); CFG.horarios = r.valor; }, 'Horários salvos.'), 'btn--fogo')))));
  }
};

/* ── entrega e retirada ── */
TELAS.entrega = {
  async abrir(alvo) {
    CFG = await api('GET', 'config');
    const E = CFG.entrega, R = CFG.retirada;
    const ativa = marca('Aceitar pedidos para entrega', E.ativa), tmin = entrada(E.tempoMin, { type: 'number', min: '5', max: '300' }), tmax = entrada(E.tempoMax, { type: 'number', min: '5', max: '300' });
    const minimo = entrada(E.pedidoMinimo ? reais(E.pedidoMinimo) : '', { inputmode: 'decimal', placeholder: 'Sem mínimo' }), gratis = entrada(E.gratisAcima ? reais(E.gratisAcima) : '', { inputmode: 'decimal', placeholder: 'Desativado' });
    const lb = h('div', { class: 'ops-ed' }), lr = h('div', { class: 'ops-ed' });
    const linhaB = (b) => { const n = entrada(b ? b[0] : '', { maxlength: '80', placeholder: 'Bairro' }), t = entrada(b ? reais(b[1]) : '', { inputmode: 'decimal', placeholder: 'Taxa' }); const l = h('div', { class: 'lin' }, n, h('div', { class: 'fixo' }, t), botao('✕', () => l.remove(), 'btn--linha ico fixo', { 'aria-label': 'Remover bairro' })); l.ler = () => [n.value.trim(), centavos(t.value)]; return l; };
    const linhaR = (r) => { const k = entrada(r ? String(r[0]).replace('.', ',') : '', { inputmode: 'decimal', placeholder: 'Até quantos km' }), t = entrada(r ? reais(r[1]) : '', { inputmode: 'decimal', placeholder: 'Taxa' }); const l = h('div', { class: 'lin' }, k, h('div', { class: 'fixo' }, t), botao('✕', () => l.remove(), 'btn--linha ico fixo', { 'aria-label': 'Remover faixa' })); l.ler = () => [Number(k.value.replace(',', '.')), centavos(t.value)]; return l; };
    E.bairros.forEach((b) => lb.append(linhaB(b))); E.raios.forEach((r) => lr.append(linhaR(r)));
    const rAtiva = marca('Aceitar pedidos para retirada', R.ativa), rMin = entrada(R.minutos, { type: 'number', min: '1', max: '300' }), rDesc = entrada(R.descontoPct, { type: 'number', min: '0', max: '90' });
    alvo.replaceChildren(cab('Entrega e retirada', 'Áreas, taxas, tempos e regras do pedido.'),
      h('div', { class: 'grade g2' },
        h('div', { class: 'cartao' }, h('h2', { text: 'Entrega' }), ativa, h('div', { class: 'lin' }, campo('Tempo mínimo (min)', tmin), campo('Tempo máximo (min)', tmax)),
          h('div', { class: 'lin' }, campo('Pedido mínimo (R$)', minimo), campo('Entrega grátis a partir de (R$)', gratis)),
          h('div', { class: 'campo' }, h('span', { text: 'Taxa por bairro' }), lb, h('p', null, botao('+ Adicionar bairro', () => { const l = linhaB(null); lb.append(l); $('input', l).focus(); }, 'btn--linha btn--peq'))),
          h('div', { class: 'campo' }, h('span', { text: 'Taxa por distância (informativa)' }), h('small', { text: 'Mostrada no site como referência. O pedido pelo site usa a taxa por bairro, porque calcular distância exige um serviço de mapas.' }), lr, h('p', null, botao('+ Adicionar faixa', () => lr.append(linhaR(null)), 'btn--linha btn--peq'))),
          h('div', { class: 'acoes-form' }, botao('Salvar entrega', () => tentar(async () => { const r = await api('PUT', 'config/entrega', { ativa: $('input', ativa).checked, tempoMin: +tmin.value, tempoMax: +tmax.value, pedidoMinimo: centavos(minimo.value), gratisAcima: centavos(gratis.value), bairros: [...lb.children].map((l) => l.ler()).filter((b) => b[0]), raios: [...lr.children].map((l) => l.ler()).filter((x) => x[0] > 0) }); CFG.entrega = r.valor; }, 'Entrega salva.'), 'btn--fogo'))),
        h('div', { class: 'cartao' }, h('h2', { text: 'Retirada' }), rAtiva, campo('Tempo de preparo para retirada (min)', rMin), campo('Desconto na retirada (%)', rDesc, '0 = sem desconto'),
          h('div', { class: 'acoes-form' }, botao('Salvar retirada', () => tentar(async () => { const r = await api('PUT', 'config/retirada', { ativa: $('input', rAtiva).checked, minutos: +rMin.value, descontoPct: +rDesc.value }); CFG.retirada = r.valor; }, 'Retirada salva.'), 'btn--fogo')))));
  }
};

/* ── pagamentos ── */
const BANDEIRAS = ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard'];
TELAS.pagamentos = {
  async abrir(alvo) {
    const [cfg, tr, pub] = await Promise.all([api('GET', 'config'), api('GET', 'transacoes'), fetch('/api/cardapio', { cache: 'no-store' }).then((r) => r.json())]);
    CFG = cfg; const P = CFG.pagamento, modo = pub.pagamento.onlineModo;
    const din = marca('Dinheiro', P.dinheiro), on = marca('Pix pelo Mercado Pago', P.online);
    const deb = BANDEIRAS.map((b) => marca(b, P.debito.includes(b), { value: b })), cre = BANDEIRAS.map((b) => marca(b, P.credito.includes(b), { value: b }));
    const lidas = (l) => l.map((m) => $('input', m)).filter((i) => i.checked).map((i) => i.value);
    const txtModo = { mercadopago: ['Mercado Pago em modo de teste (sandbox)', 'ok'], simulado: ['Pagamento simulado: sem credenciais do Mercado Pago', 'aviso'], bloqueado: ['Bloqueado: a credencial configurada não é de teste', 'erro'] }[modo];
    alvo.replaceChildren(cab('Pagamentos', 'Formas aceitas e pagamentos online recebidos.'),
      h('div', { class: 'grade g2' },
        h('div', { class: 'cartao' }, h('h2', { text: 'Formas de pagamento' }), h('div', { class: 'campo' }, h('span', { text: 'Na entrega ou retirada' }), din),
          h('div', { class: 'campo' }, h('span', { text: 'Cartão de débito (maquininha)' }), deb), h('div', { class: 'campo' }, h('span', { text: 'Cartão de crédito (maquininha)' }), cre),
          h('div', { class: 'campo' }, h('span', { text: 'Online' }), on, h('p', { style: null }, chip(txtModo[0], txtModo[1]))),
          h('div', { class: 'acoes-form' }, botao('Salvar formas de pagamento', () => tentar(async () => { const r = await api('PUT', 'config/pagamento', { dinheiro: $('input', din).checked, online: $('input', on).checked, debito: lidas(deb), credito: lidas(cre) }); CFG.pagamento = r.valor; }, 'Formas de pagamento salvas.'), 'btn--fogo'))),
        h('div', { class: 'cartao' }, h('h2', { text: 'Como o pagamento online é confirmado' }),
          h('p', { class: 'peq', text: 'Um pedido online só entra na fila de "Novos" depois que o servidor confirma o pagamento direto com o Mercado Pago (notificação assinada ou consulta à API). O navegador do cliente nunca marca um pedido como pago.' }),
          h('p', { class: 'peq mut', style: null, text: 'Sem credenciais de teste no arquivo .dev.vars, o site mostra um pagamento simulado, identificado como tal aqui e para o cliente.' }))),
      h('div', { class: 'cartao' }, h('h2', { text: 'Transações online' }), tabela([{ t: 'Pedido' }, { t: 'Data' }, { t: 'Situação' }, { t: 'Meio' }, { t: 'Identificador' }, { t: 'Valor', dir: 1 }],
        tr.transacoes.map((t) => h('tr', null, h('td', { class: 'num', text: 'Nº ' + t.id }), h('td', { class: 'nowrap', text: dataHora(t.criado) }), h('td', null, chip({ pago: 'Pago', simulado: 'Simulado', pendente: 'Pendente' }[t.pag_status] || t.pag_status, t.pag_status === 'pago' ? 'ok' : 'aviso')), h('td', { text: t.pag_metodo || '—' }), h('td', { class: 'peq mut', text: t.pag_id || '—' }), h('td', { class: 'dir num', text: brl(t.total) }))), 'Nenhum pagamento online ainda.')));
  }
};

/* ── equipe ── */
TELAS.equipe = {
  async abrir(alvo) {
    const r = await api('GET', 'equipe');
    const editar = async (u) => {
      const usuario = entrada(u ? u.usuario : '', { maxlength: '40', disabled: !!u, autocapitalize: 'none', autocomplete: 'off' }), nome = entrada(u ? u.nome : '', { maxlength: '80' });
      const papel = selecao([['equipe', 'Equipe: pedidos e pausar itens'], ['dono', 'Dono: acesso total']], u ? u.papel : 'equipe'), ativo = marca('Conta ativa', u ? u.ativo : true);
      const senha = entrada('', { type: 'password', maxlength: '200', autocomplete: 'new-password' });
      const ok = await dialogo(u ? 'Editar conta' : 'Nova conta', h('div', null, campo('Usuário', usuario), campo('Nome', nome), campo('Papel', papel), campo(u ? 'Nova senha (deixe vazio para manter)' : 'Senha', senha, 'Mínimo de 10 caracteres. Trocar a senha encerra as sessões abertas dessa conta.'), ativo),
        { aoSalvar: async () => { const c = { nome: nome.value, papel: papel.value, ativo: $('input', ativo).checked, senha: senha.value || undefined }; if (u) await api('PUT', 'equipe/' + u.id, c); else await api('POST', 'equipe', Object.assign(c, { usuario: usuario.value })); } });
      if (ok) { toast('Conta salva.'); this.abrir(alvo); }
    };
    alvo.replaceChildren(cab('Equipe', 'Quem pode entrar no painel. Não existe cadastro público.', [botao('Nova conta', () => editar(null), 'btn--fogo')]),
      h('div', { class: 'cartao' }, tabela([{ t: 'Usuário' }, { t: 'Nome' }, { t: 'Papel' }, { t: 'Situação' }, { t: 'Criada em' }, { t: '' }], r.equipe.map((u) => h('tr', null,
        h('td', null, h('strong', { text: u.usuario })), h('td', { text: u.nome }), h('td', { text: u.papel === 'dono' ? 'Dono' : 'Equipe' }), h('td', null, chip(u.ativo ? 'Ativa' : 'Desativada', u.ativo ? 'ok' : 'aviso')), h('td', { class: 'nowrap', text: dataHora(u.criado) }),
        h('td', { class: 'acoes' }, botao('Editar', () => editar(u), 'btn--linha btn--peq'), u.id !== EU.id && botao('Excluir', async () => { if (await confirmar('Excluir conta', 'Excluir a conta "' + u.usuario + '"? As sessões dela são encerradas.', 'Excluir') && await tentar(() => api('DELETE', 'equipe/' + u.id), 'Conta excluída.')) this.abrir(alvo); }, 'btn--perigo btn--peq')))))));
  }
};

/* ── cupons ── */
TELAS.cupons = {
  async abrir(alvo) {
    const r = await api('GET', 'cupons');
    const editar = async (c) => {
      const cod = entrada(c ? c.codigo : '', { maxlength: '30', autocapitalize: 'characters' }), tipo = selecao([['pct', 'Porcentagem (%)'], ['valor', 'Valor fixo (R$)']], c ? c.tipo : 'pct');
      const valor = entrada(c ? (c.tipo === 'pct' ? c.valor : reais(c.valor)) : '', { inputmode: 'decimal' }), minimo = entrada(c && c.minimo ? reais(c.minimo) : '', { inputmode: 'decimal', placeholder: 'Sem mínimo' });
      const val = entrada(c && c.validade ? new Date(c.validade * 1000).toISOString().slice(0, 10) : '', { type: 'date' }), lim = entrada(c && c.limite ? c.limite : '', { type: 'number', min: '1', placeholder: 'Sem limite' }), ativo = marca('Cupom ativo', c ? c.ativo : true);
      const ok = await dialogo(c ? 'Editar cupom' : 'Novo cupom', h('div', null, campo('Código', cod), h('div', { class: 'lin' }, campo('Tipo', tipo), campo('Valor do desconto', valor)), h('div', { class: 'lin' }, campo('Pedido mínimo (R$)', minimo), campo('Limite de usos', lim)), campo('Válido até', val, 'Vazio = sem data de validade.'), ativo),
        { aoSalvar: async () => { const corpo = { codigo: cod.value, tipo: tipo.value, valor: tipo.value === 'pct' ? Number(valor.value.replace(',', '.')) : centavos(valor.value), minimo: centavos(minimo.value), validade: val.value ? Math.floor(new Date(val.value + 'T23:59:59').getTime() / 1000) : null, limite: lim.value ? +lim.value : null, ativo: $('input', ativo).checked }; if (c) await api('PUT', 'cupons/' + c.id, corpo); else await api('POST', 'cupons', corpo); } });
      if (ok) { toast('Cupom salvo.'); this.abrir(alvo); }
    };
    alvo.replaceChildren(cab('Cupons', 'Descontos por código. A validação é feita no servidor a cada pedido.', [botao('Novo cupom', () => editar(null), 'btn--fogo')]),
      h('div', { class: 'cartao' }, tabela([{ t: 'Código' }, { t: 'Desconto' }, { t: 'Pedido mínimo' }, { t: 'Validade' }, { t: 'Usos' }, { t: 'Situação' }, { t: '' }], r.cupons.map((c) => h('tr', null,
        h('td', null, h('strong', { text: c.codigo })), h('td', { text: c.tipo === 'pct' ? c.valor + '%' : brl(c.valor) }), h('td', { text: c.minimo ? brl(c.minimo) : '—' }), h('td', { text: c.validade ? new Date(c.validade * 1000).toLocaleDateString('pt-BR') : 'Sem validade' }),
        h('td', { class: 'num', text: c.usos + (c.limite ? ' de ' + c.limite : '') }), h('td', null, chip(c.ativo ? 'Ativo' : 'Desativado', c.ativo ? 'ok' : 'aviso')),
        h('td', { class: 'acoes' }, botao('Editar', () => editar(c), 'btn--linha btn--peq'), botao('Excluir', async () => { if (await confirmar('Excluir cupom', 'Excluir o cupom ' + c.codigo + '?', 'Excluir') && await tentar(() => api('DELETE', 'cupons/' + c.id), 'Cupom excluído.')) this.abrir(alvo); }, 'btn--perigo btn--peq')))), 'Nenhum cupom criado.')));
  }
};

/* ── clientes ── */
TELAS.clientes = {
  async abrir(alvo) {
    const r = await api('GET', 'clientes');
    alvo.replaceChildren(cab('Clientes', 'Montado a partir dos pedidos válidos. Visível só para o dono.'),
      h('div', { class: 'cartao' }, tabela([{ t: 'Nome' }, { t: 'Telefone' }, { t: 'Pedidos', dir: 1 }, { t: 'Total gasto', dir: 1 }, { t: 'Último pedido' }, { t: '' }], r.clientes.map((c) => h('tr', null,
        h('td', null, h('strong', { text: c.nome })), h('td', { class: 'nowrap', text: fone(c.telefone) }), h('td', { class: 'dir num', text: c.pedidos }), h('td', { class: 'dir num', text: brl(c.total) }), h('td', { class: 'nowrap', text: dataHora(c.ultimo) }),
        h('td', { class: 'acoes' }, h('a', { class: 'btn btn--linha btn--peq', href: 'https://wa.me/' + (c.telefone.length <= 11 ? '55' : '') + c.telefone, target: '_blank', rel: 'noopener noreferrer', text: 'WhatsApp' })))), 'Os clientes aparecem aqui depois do primeiro pedido.')));
  }
};

/* ── recursos (apenas visual) ── */
TELAS.recursos = {
  async abrir(alvo) {
    const R = [['Mensagem automática no WhatsApp', 'Avisar o cliente quando o pedido é aceito ou sai para entrega. Precisa da API do WhatsApp Business.'], ['Impressão automática e estações de preparo', 'Imprimir na cozinha assim que o pedido é aceito. Precisa de um programa local de impressão. Por enquanto use o botão Imprimir do pedido.'],
      ['Integração com PDV', 'Enviar pedidos para o sistema de caixa (Colibri, TOTVS e outros).'], ['Entregadores sob demanda', 'Chamar um entregador parceiro direto do pedido.'], ['Pixel do Facebook e Google Analytics', 'Medir visitas e conversões do cardápio.'],
      ['E-mail marketing', 'Enviar campanhas para a base de clientes.'], ['Gerador de artes', 'Criar posts para redes sociais com a identidade da loja.'], ['Domínio próprio', 'Usar o endereço da loja, como pedidos.sualoja.com.br.'], ['Programa de fidelidade', 'Pontos e recompensas para clientes recorrentes.'], ['Plano e fatura', 'Assinatura do serviço.']];
    alvo.replaceChildren(cab('Recursos', 'Itens que dependem de serviços externos. Nesta demonstração eles são apenas visuais: nada aqui está ligado.'),
      h('div', { class: 'grade g2' }, R.map(([t, d]) => h('div', { class: 'cartao recurso' }, chip('Apenas visual', 'aviso'), h('h3', { text: t }), h('p', { text: d }), h('p', null, botao('Conectar', null, 'btn--linha btn--peq', { disabled: true }))))));
  }
};

/* ── auditoria ── */
TELAS.auditoria = {
  pagina: 1,
  async abrir(alvo) {
    const r = await api('GET', 'auditoria?pagina=' + this.pagina);
    alvo.replaceChildren(cab('Auditoria', 'Registro de tudo o que foi feito no painel: quem, o quê e quando.'),
      h('div', { class: 'cartao' }, tabela([{ t: 'Quando' }, { t: 'Quem' }, { t: 'Ação' }, { t: 'Alvo' }, { t: 'Detalhe' }], r.registros.map((a) => h('tr', null, h('td', { class: 'nowrap num', text: dataHora(a.em) }), h('td', { text: a.usuario }), h('td', null, h('code', { text: a.acao })), h('td', { text: a.alvo }), h('td', { class: 'peq mut', text: a.detalhe }))), 'Sem registros.'),
        h('div', { class: 'pag' }, botao('← Mais recentes', () => { this.pagina--; this.abrir(alvo); }, 'btn--linha btn--peq', { disabled: this.pagina <= 1 }), h('span', { class: 'peq mut', text: 'Página ' + r.pagina }), botao('Mais antigos →', () => { this.pagina++; this.abrir(alvo); }, 'btn--linha btn--peq', { disabled: r.registros.length < 50 }))));
  }
};

/* ── minha conta ── */
TELAS.conta = {
  async abrir(alvo) {
    const atual = entrada('', { type: 'password', autocomplete: 'current-password', maxlength: '200' }), nova = entrada('', { type: 'password', autocomplete: 'new-password', maxlength: '200' }), rep = entrada('', { type: 'password', autocomplete: 'new-password', maxlength: '200' });
    const vol = h('input', { type: 'range', min: '5', max: '100', value: Math.round(prefs.get('volume', 0.35) * 100), 'aria-label': 'Volume do alerta' });
    vol.addEventListener('change', () => { prefs.set('volume', vol.value / 100); bip(); });
    alvo.replaceChildren(cab('Minha conta', EU.nome + ' · ' + EU.usuario + ' · ' + (DONO() ? 'dono' : 'equipe')),
      h('div', { class: 'grade g2' },
        h('form', { class: 'cartao', onsubmit: async (e) => { e.preventDefault(); if (nova.value !== rep.value) return toast('As senhas novas não são iguais.', true); if (await tentar(() => api('POST', 'senha', { atual: atual.value, nova: nova.value }), 'Senha alterada. As outras sessões desta conta foram encerradas.')) atual.value = nova.value = rep.value = ''; } },
          h('h2', { text: 'Trocar senha' }), campo('Senha atual', atual), campo('Nova senha', nova, 'Mínimo de 10 caracteres.'), campo('Repita a nova senha', rep), h('div', { class: 'acoes-form' }, h('button', { type: 'submit', class: 'btn btn--fogo', text: 'Trocar senha' }))),
        h('div', { class: 'cartao' }, h('h2', { text: 'Alerta de pedido novo' }), h('p', { class: 'peq mut', text: 'Preferências deste navegador. O som toca quando chega um pedido e se repete até ele ser aceito ou recusado.' }), campo('Volume', vol), h('div', { class: 'acoes-form' }, botao('Testar som', bip, 'btn--linha')),
          h('p', { class: 'peq mut', text: 'A sessão expira após 30 minutos sem uso ou 12 horas depois do login.' }))));
  }
};

iniciar();
