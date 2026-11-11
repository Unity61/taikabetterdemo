'use strict';
/* Painel Taika: núcleo (utilitários, API, login, estrutura, alerta de pedidos).
   Todo conteúdo dinâmico entra na página por textContent/DOM, nunca por innerHTML. */
const $ = (s, r) => (r || document).querySelector(s);
function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'data') Object.assign(el.dataset, v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of filhos.flat(Infinity)) { if (c === null || c === undefined || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}
const brl = (c) => 'R$ ' + (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = (c) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
function centavos(txt) {
  const s = String(txt).trim().replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (s === '') return 0;
  const n = Number(s);
  if (!isFinite(n) || n < 0) throw new Error('Valor inválido: ' + txt);
  return Math.round(n * 100);
}
const hora = (t) => new Date(t * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dataHora = (t) => new Date(t * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const haQuanto = (t, agora) => { const m = Math.max(0, Math.floor((agora - t) / 60)); return m < 1 ? 'agora' : m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };
const fone = (t) => String(t).replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3').replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
const STATUS = { aguardando_pagamento: 'Aguardando pagamento', novo: 'Novo', aceito: 'Aceito', em_preparo: 'Em preparo', saiu_entrega: 'Saiu para entrega', pronto_retirada: 'Pronto para retirada', concluido: 'Concluído', recusado: 'Recusado', cancelado: 'Cancelado' };
const PAG = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', online: 'Pix' };
const PAGST = { na_entrega: 'na entrega', pendente: 'pagamento pendente', pago: 'Pix pago', simulado: 'pagamento simulado' };
const prefs = { get(k, d) { try { const v = localStorage.getItem('taika.painel.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('taika.painel.' + k, JSON.stringify(v)); } catch {} } };

let EU = null, CSRF = '', CFG = null;
const TELAS = {};
const DONO = () => EU && EU.papel === 'dono';

function toast(msg, erro) {
  const t = h('div', { class: 'toast' + (erro ? ' toast--erro' : ''), text: msg });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), erro ? 6000 : 3200);
}
async function api(metodo, caminho, corpo, bruto) {
  const o = { method: metodo, headers: {}, credentials: 'same-origin', cache: 'no-store' };
  if (metodo !== 'GET') o.headers['x-csrf-token'] = CSRF;
  if (bruto) { o.body = bruto.body; o.headers['content-type'] = bruto.type; }
  else if (corpo !== undefined) { o.body = JSON.stringify(corpo); o.headers['content-type'] = 'application/json'; }
  let r;
  try { r = await fetch('/api/admin/' + caminho, o); } catch { throw new Error('Sem conexão com o servidor.'); }
  let j = {};
  try { j = await r.json(); } catch {}
  if (r.status === 401 && caminho !== 'login') { if (EU) { EU = null; pararAlerta(); telaLogin('Sua sessão expirou. Entre novamente.'); } throw new Error(j.erro || 'Sessão expirada.'); }
  if (!r.ok) { const e = new Error(j.erro || 'Erro ' + r.status); e.status = r.status; throw e; }
  return j;
}
const tentar = async (f, ok) => { try { await f(); if (ok) toast(ok); return true; } catch (e) { toast(e.message, true); return false; } };

/* ── peças de formulário ── */
const campo = (rotulo, entrada, dica) => h('label', { class: 'campo' }, h('span', { text: rotulo }), entrada, dica && h('small', { text: dica }));
const entrada = (valor, attrs) => h('input', Object.assign({ type: 'text', value: valor === null || valor === undefined ? '' : valor }, attrs || {}));
const chave = (ligado, aoMudar, rotulo) => h('label', { class: 'chave', title: rotulo || '' }, h('input', { type: 'checkbox', checked: !!ligado, 'aria-label': rotulo || 'Ativar', onchange: (e) => aoMudar(e.target.checked, e.target) }), h('i'));
const marca = (rotulo, ligado, attrs) => h('label', { class: 'marca' }, h('input', Object.assign({ type: 'checkbox', checked: !!ligado }, attrs || {})), rotulo);
const selecao = (opcoes, valor, attrs) => h('select', attrs || {}, opcoes.map((o) => h('option', { value: o[0], selected: String(o[0]) === String(valor), text: o[1] })));
const botao = (texto, aoClicar, classe, attrs) => h('button', Object.assign({ type: 'button', class: 'btn ' + (classe || ''), onclick: aoClicar }, attrs || {}), texto);
const chip = (texto, tipo) => h('span', { class: 'chip' + (tipo ? ' chip--' + tipo : ''), text: texto });
function tabela(colunas, linhas, vazio) {
  if (!linhas.length) return h('p', { class: 'vazio', text: vazio || 'Nada por aqui ainda.' });
  return h('div', { class: 'tabela' }, h('table', null, h('thead', null, h('tr', null, colunas.map((c) => h('th', { class: c.dir ? 'dir' : '', text: c.t })))), h('tbody', null, linhas)));
}
const cab = (titulo, sub, acoes) => h('div', { class: 'cab' }, h('div', null, h('h1', { text: titulo }), sub && h('p', { text: sub })), acoes && h('div', { class: 'cab__acoes' }, acoes));

/** Diálogo com formulário. aoSalvar pode lançar erro (mostrado dentro do diálogo); se der certo, fecha. */
function dialogo(titulo, corpo, opc) {
  opc = opc || {};
  return new Promise((resolver) => {
    const erro = h('p', { class: 'erro-form', hidden: true, role: 'alert' });
    const ok = h('button', { type: 'submit', class: 'btn ' + (opc.perigo ? 'btn--perigo' : 'btn--fogo'), text: opc.ok || 'Salvar' });
    const form = h('form', { class: 'dlg', method: 'dialog', novalidate: true }, h('h2', { text: titulo }), opc.sub && h('p', { class: 'mut peq', text: opc.sub }), corpo, erro,
      h('div', { class: 'acoes-form' }, botao(opc.cancelar || 'Cancelar', () => d.close(), 'btn--linha'), opc.aoSalvar !== null && ok));
    const d = h('dialog', { class: opc.largo ? 'largo' : '' }, form);
    let feito = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.hidden = true; ok.disabled = true;
      try { const r = opc.aoSalvar ? await opc.aoSalvar() : true; feito = true; d.close(); resolver(r === undefined ? true : r); }
      catch (x) { erro.textContent = x.message; erro.hidden = false; ok.disabled = false; }
    });
    d.addEventListener('close', () => { d.remove(); if (!feito) resolver(null); });
    document.body.append(d); d.showModal();
  });
}
const confirmar = (titulo, texto, ok) => dialogo(titulo, h('p', { text: texto }), { ok: ok || 'Confirmar', perigo: true, aoSalvar: async () => true });

/* ── login ── */
let widgetTs = null;
async function telaLogin(aviso) {
  document.title = 'Taika · Painel';
  let token = '';
  const erro = h('p', { class: 'login__err', hidden: !aviso, role: 'alert', text: aviso || '' });
  const usuario = h('input', { type: 'text', name: 'usuario', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '60', required: true });
  const senha = h('input', { type: 'password', name: 'senha', autocomplete: 'current-password', maxlength: '200', required: true });
  const caixa = h('div', { class: 'login__ts' });
  const entrar = h('button', { type: 'submit', class: 'btn btn--fogo', text: 'Entrar' });
  const form = h('form', { class: 'login__box', novalidate: true },
    h('img', { class: 'login__logo', src: '/logo.png', alt: 'Taika Sushi' }), h('p', { class: 'login__sub', text: 'Painel da loja' }),
    h('label', null, 'Usuário', usuario), h('label', null, 'Senha', senha), caixa, erro, entrar,
    h('p', { class: 'login__nota', text: 'Acesso restrito à equipe. Não há cadastro por aqui.' }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); erro.hidden = true;
    if (!usuario.value.trim() || !senha.value) { erro.textContent = 'Preencha usuário e senha.'; erro.hidden = false; return; }
    if (!token) { erro.textContent = 'Aguarde a verificação anti-robô terminar.'; erro.hidden = false; return; }
    entrar.disabled = true;
    try {
      const r = await api('POST', 'login', { usuario: usuario.value.trim(), senha: senha.value, turnstile: token });
      EU = r.usuario; CSRF = r.csrf; senha.value = '';
      destravarSom(); await montar();
    } catch (x) {
      erro.textContent = x.message; erro.hidden = false; entrar.disabled = false; senha.value = ''; token = '';
      if (window.turnstile && widgetTs !== null) { try { window.turnstile.reset(widgetTs); } catch {} }
    }
  });
  $('#app').replaceChildren(h('main', { class: 'login' }, form));
  usuario.focus();
  try {
    const k = await (await fetch('/api/painel/chave', { cache: 'no-store' })).json();
    const render = () => { widgetTs = window.turnstile.render(caixa, { sitekey: k.turnstile, theme: 'dark', language: 'pt-br', callback: (t) => { token = t; }, 'expired-callback': () => { token = ''; }, 'error-callback': () => { token = ''; } }); };
    if (window.turnstile) render();
    else { const s = h('script', { src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit' }); s.addEventListener('load', render); s.addEventListener('error', () => { erro.textContent = 'Não foi possível carregar a verificação anti-robô. Verifique a conexão.'; erro.hidden = false; }); document.head.append(s); }
  } catch { erro.textContent = 'Não foi possível carregar a verificação anti-robô.'; erro.hidden = false; }
}

/* ── som e alerta de pedidos novos ── */
let actx = null, PEDIDOS = [], AGORA = 0, vistos = null, timerPed = 0, timerBip = 0, ultimoJson = '';
function destravarSom() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch {} }
function bip() {
  if (!prefs.get('som', true)) return;
  try {
    destravarSom(); const t = actx.currentTime, vol = prefs.get('volume', 0.35);
    [[0, 880], [0.2, 880], [0.4, 1175]].forEach(([d, f]) => { const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(vol, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18); o.connect(g).connect(actx.destination); o.start(t + d); o.stop(t + d + 0.2); });
  } catch {}
}
const novos = () => PEDIDOS.filter((p) => p.status === 'novo');
function pintarAlerta() {
  const n = novos().length, b = $('#nav-novos');
  if (b) { b.hidden = !n; b.textContent = n; }
  document.title = (n ? '(' + n + ') Pedido novo · ' : '') + 'Taika · Painel';
  const a = $('#alerta-global');
  if (a) { a.hidden = !n || location.hash === '#/pedidos'; $('span', a).textContent = n === 1 ? 'Chegou 1 pedido novo.' : 'Há ' + n + ' pedidos novos aguardando.'; }
}
async function buscarPedidos() {
  clearTimeout(timerPed);
  if (!EU) return;
  try {
    const r = await api('GET', 'pedidos');
    PEDIDOS = r.pedidos; AGORA = r.agora;
    const ids = new Set(novos().map((p) => p.id));
    if (vistos === null) vistos = new Set();
    let chegou = 0;
    for (const id of ids) if (!vistos.has(id)) { vistos.add(id); chegou++; }
    if (chegou) { bip(); if (prefs.get('aviso', true)) toast(chegou === 1 ? 'Pedido novo!' : chegou + ' pedidos novos!'); }
    const js = JSON.stringify(r.pedidos);
    if (js !== ultimoJson) { ultimoJson = js; if (TELAS.pedidos && TELAS.pedidos.atualizar && location.hash === '#/pedidos') TELAS.pedidos.atualizar(); }
    else if (location.hash === '#/pedidos' && TELAS.pedidos.relogio) TELAS.pedidos.relogio();
    pintarAlerta();
  } catch {}
  if (EU) timerPed = setTimeout(buscarPedidos, document.hidden ? 8000 : 4000);
}
function iniciarAlerta() {
  vistos = null; ultimoJson = ''; buscarPedidos();
  clearInterval(timerBip);
  timerBip = setInterval(() => { if (EU && novos().length && prefs.get('repetir', true)) bip(); }, 12000);
}
function pararAlerta() { clearTimeout(timerPed); clearInterval(timerBip); PEDIDOS = []; }

/* ── estrutura ── */
const MENU = [
  [null, [['inicio', 'Início', true]]],
  ['Operação', [['pedidos', 'Pedidos'], ['historico', 'Histórico']]],
  ['Cardápio', [['cardapio', 'Itens e categorias'], ['opcionais', 'Opcionais']]],
  ['Loja', [['loja', 'Dados e horários', true], ['entrega', 'Entrega e retirada', true], ['pagamentos', 'Pagamentos', true], ['equipe', 'Equipe', true]]],
  ['Marketing', [['cupons', 'Cupons', true], ['clientes', 'Clientes', true]]],
  ['Sistema', [['recursos', 'Recursos', true], ['auditoria', 'Auditoria', true], ['conta', 'Minha conta']]]
];
async function montar() {
  CFG = await api('GET', 'config');
  const nav = h('nav', { 'aria-label': 'Seções do painel' });
  for (const [grupo, itens] of MENU) {
    const vis = itens.filter((i) => !i[2] || DONO());
    if (!vis.length) continue;
    if (grupo) nav.append(h('h4', { text: grupo }));
    for (const [id, nome] of vis) nav.append(h('a', { href: '#/' + id, data: { tela: id } }, nome, id === 'pedidos' && h('b', { id: 'nav-novos', hidden: true })));
  }
  const modo = selecao([['auto', 'Seguir horários'], ['aberto', 'Aberta agora (manual)'], ['fechado', 'Fechada agora (manual)']], CFG.status.modo, { 'aria-label': 'Loja aberta ou fechada', disabled: !DONO() });
  modo.addEventListener('change', async () => {
    const ok = await tentar(async () => { const r = await api('PUT', 'config/status', { modo: modo.value }); CFG.status = r.valor; }, 'Status da loja atualizado.');
    if (!ok) modo.value = CFG.status.modo;
  });
  const shell = h('div', { class: 'shell' },
    h('aside', { class: 'side' }, h('img', { class: 'side__logo', src: '/logo.png', alt: 'Taika Sushi' }), h('p', { class: 'side__k', text: 'Painel' }), nav,
      h('p', { class: 'side__pe', text: 'Ambiente de demonstração' })),
    h('div', { class: 'main' },
      h('header', { class: 'top' }, botao('☰', () => shell.classList.toggle('aberto'), 'btn--linha ico menu-btn', { 'aria-label': 'Abrir menu' }),
        h('span', { class: 'peq mut', text: 'Loja:' }), modo, h('span', { class: 'top__esp' }),
        h('span', { class: 'peq', text: EU.nome + (DONO() ? ' · dono' : ' · equipe') }), botao('Sair', sair, 'btn--linha btn--peq')),
      h('div', { class: 'conteudo' },
        h('div', { class: 'alerta', id: 'alerta-global', hidden: true }, h('span'), h('a', { class: 'btn btn--peq', href: '#/pedidos', text: 'Ver pedidos' })),
        h('div', { id: 'tela' }))));
  nav.addEventListener('click', () => shell.classList.remove('aberto'));
  $('#app').replaceChildren(shell);
  iniciarAlerta();
  if (!location.hash || !TELAS[location.hash.slice(2)]) location.hash = DONO() ? '#/inicio' : '#/pedidos';
  else rotear();
}
let telaAtual = null;
async function rotear() {
  if (!EU) return;
  const id = location.hash.slice(2), t = TELAS[id], alvo = $('#tela');
  if (!alvo) return;
  if (telaAtual && telaAtual.sair) telaAtual.sair();
  document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('on', a.dataset.tela === id));
  const item = MENU.flatMap((g) => g[1]).find((i) => i[0] === id);
  if (!t || !item || (item[2] && !DONO())) { location.hash = DONO() ? '#/inicio' : '#/pedidos'; return; }
  telaAtual = t; pintarAlerta();
  alvo.replaceChildren(h('p', { class: 'vazio', text: 'Carregando…' }));
  try { await t.abrir(alvo); } catch (e) { if (EU) alvo.replaceChildren(h('p', { class: 'aviso aviso--erro', text: e.message })); }
}
window.addEventListener('hashchange', rotear);
async function sair() {
  try { await api('POST', 'logout', {}); } catch {}
  EU = null; CSRF = ''; pararAlerta(); telaLogin();
}
async function iniciar() {
  try { const r = await api('GET', 'eu'); EU = r.usuario; CSRF = r.csrf; await montar(); }
  catch { telaLogin(); }
}
document.addEventListener('pointerdown', destravarSom, { once: true });
