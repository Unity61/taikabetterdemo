(async function(){
'use strict';
const $=(s,r)=>(r||document).querySelector(s);
const $$=(s,r)=>Array.from((r||document).querySelectorAll(s));

/* ── API ── */
async function api(caminho,corpo){
  const o=corpo===undefined?{cache:'no-store'}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(corpo)};
  let r; try{r=await fetch('/api/'+caminho,o)}catch(e){throw{erro:'Sem conexão. Tente de novo.'}}
  let j={}; try{j=await r.json()}catch(e){}
  if(!r.ok) throw Object.assign({erro:'Algo deu errado. Tente de novo.',status:r.status},j);
  return j;
}
let API;
try{API=await api('cardapio')}catch(e){document.body.insertAdjacentHTML('afterbegin','<p style="padding:24px;font:16px sans-serif;color:#fff">Não foi possível carregar o cardápio. Recarregue a página.</p>');return}

/* ── helpers ── */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
const fmt=n=>'R$ '+n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const priceHTML=n=>{const p=n.toLocaleString('pt-BR',{minimumFractionDigits:2}).split(',');return '<span class="price"><i>R$</i>'+p[0]+'<small>,'+p[1]+'</small></span>'};
const sent=s=>{s=s.toLowerCase();return s.charAt(0).toUpperCase()+s.slice(1)};
const IMG=(id,w,h)=>'https://images.unsplash.com/photo-'+id+'?auto=format&fit=crop&w='+w+'&h='+h+'&q=72';
const FOTO=f=>f;
const store={get(k,d){try{const v=localStorage.getItem('taika3.'+k);return v===null?d:JSON.parse(v)}catch(e){return d}},set(k,v){try{localStorage.setItem('taika3.'+k,JSON.stringify(v))}catch(e){}}};
const HERO='1588182657969-777d766e31ab', GRILL='1526213174737-acd9757c6bf3';

/* ── category dressing: kanji label and, where the store has no photo of its own, an illustrative cover ── */
const META={
  'entradas':{jp:'前菜'},'sashimi':{jp:'刺身'},
  'niguiri':{jp:'握り',capa:'1637074930269-089fde202b57'},
  'niguiris especiais':{jp:'特選',capa:'1790643063016-f5c8365366e3'},
  'carpaccios':{jp:'薄造り',capa:'1726514730791-2bfb3f472f90'},
  'joes':{jp:'軍艦'},'uramaki':{jp:'裏巻'},
  'hossomaki':{jp:'細巻',capa:'1617196034738-26c5f7c977ce'},
  'hot sushi':{jp:'揚巻',capa:'1617196034183-421b4917c92d'},
  'combinados':{jp:'盛合',capa:'1553621042-f6e147245754'},
  'temaki quente':{jp:'手巻',capa:'1791386809517-60f40f5372dd'},
  'temaki especial':{jp:'手巻'},'temaki frito':{jp:'手巻'},
  'yakisobas':{jp:'焼そば',capa:'1607328874071-45a9cd600644'},
  'adicionais':{jp:'追加'},'sobremesas':{jp:'甘味'},'águas':{jp:'お水'},'refrigerantes':{jp:'炭酸'},'sucos':{jp:'果汁'}
};
const WIDE=/seed\/(10694946|10696499|10696500|10696534)\./; /* landscape originals */
const splitParen=s=>{const m=s.match(/^(.*?)\s*\(\s*([^)]*?)\s*\)\s*$/);return m?[m[1].trim(),m[2].trim()]:[s.trim(),'']};
const isUnit=s=>/^\d+\s*(pe[çc]as?|unidades?|ml|l)\b/i.test(s)||/^\d+\s*ml$/i.test(s);

/* ── dados vindos da API (valores chegam em centavos e viram reais aqui) ── */
const DIAS=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'], DIASL=['domingo','segunda','terça','quarta','quinta','sexta','sábado'];
const toMin=h=>{const p=h.split(':');return +p[0]*60+ +p[1]};
let L, VERSAO='', ITEM={}, CATS=[], ALL=[], OG=[], AGENDA=[], fone='', zap='', mapa='', endLoja='', tempoEntrega='', taxaMin=0;
function carregar(A){
  VERSAO=A.versao;
  const l=A.loja, r=c=>c/100;
  L={nome:l.nome,boasVindas:l.boasVindas,sobre:l.sobre||'',endereco:l.endereco,fuso:l.fuso,telefone:l.telefone,whatsapp:l.whatsapp,aberta:l.aberta,modo:l.modo,
    entrega:{ativa:A.entrega.ativa,bairros:A.entrega.bairros.map(b=>[b[0],r(b[1])]),raios:A.entrega.raios.map(x=>[x[0],r(x[1])]),tempoMin:A.entrega.tempoMin,tempoMax:A.entrega.tempoMax,pedidoMinimo:r(A.entrega.pedidoMinimo),gratisAcima:r(A.entrega.gratisAcima)},
    retirada:A.retirada,pagamento:A.pagamento};
  AGENDA=DIAS.map((_,d)=>{const h=A.horarios[d];return h&&h.ativo?[h.abre,h.fecha]:null});
  const gi={};
  OG=A.grupos.map((g,i)=>{gi[g.id]=i;return{id:g.id,nome:g.nome,min:g.min,max:g.max,acomp:/acompanhamentos/i.test(g.nome),
    itens:g.opcoes.map(o=>({id:o.id,nome:o.nome,preco:r(o.preco),pausado:o.pausado,todos:/^todos/i.test(o.nome),nenhum:/^nenhum/i.test(o.nome)}))}});
  ITEM={};
  CATS=A.categorias.filter(c=>c.itens.length).map(c=>{
    const [t,par]=splitParen(c.nome), m=META[t.toLowerCase()]||{jp:'品'};
    const cat={id:'c'+c.id,titulo:t,unidade:isUnit(par)?par.toLowerCase():'',nota:par&&!isUnit(par)?par:'',jp:m.jp,capa:m.capa||'',itens:[]};
    c.itens.forEach(it=>{
      const [n,u]=splitParen(it.nome);
      const o={id:String(it.id),nome:n,unidade:(u?u.toLowerCase():cat.unidade),desc:it.desc,preco:r(it.preco),pausado:it.pausado,op:it.grupos.map(g=>gi[g]).filter(x=>x!==undefined),foto:it.foto||'',cat:cat};
      o.busca=norm(o.nome+' '+o.desc+' '+cat.titulo);
      ITEM[o.id]=o; cat.itens.push(o);
    });
    return cat;
  });
  ALL=CATS.reduce((a,c)=>a.concat(c.itens),[]);
  fone=L.telefone.replace(/^\+55(\d{2})(\d{5})(\d{4})$/,'($1) $2-$3');
  zap='https://wa.me/'+L.telefone.replace(/\D/g,'');
  mapa='https://www.google.com/maps/search/?api=1&query='+(L.endereco.lat?L.endereco.lat+','+L.endereco.lng:encodeURIComponent(L.endereco.rua+', '+L.endereco.cidade));
  endLoja=L.endereco.rua+', '+L.endereco.bairro;
  tempoEntrega=L.entrega.tempoMin+'–'+L.entrega.tempoMax+' min';
  const taxas=L.entrega.bairros.map(b=>b[1]); taxaMin=taxas.length?Math.min.apply(null,taxas):0;
}
carregar(API);
const findItem=re=>ALL.find(i=>re.test(i.nome));

/* ── loja: status, horários ── */
function agora(){
  try{const p=new Intl.DateTimeFormat('en-US',{timeZone:L.fuso,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    const g=t=>p.find(x=>x.type===t).value;return{d:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(g('weekday')),m:+g('hour')*60+ +g('minute')}}
  catch(e){const n=new Date();return{d:n.getDay(),m:n.getHours()*60+n.getMinutes()}}
}
function status(){
  if(L.modo==='fechado') return{aberta:false,curto:'Fechada',longo:'Fechada no momento',abre:''};
  if(L.modo==='aberto') return{aberta:true,curto:'Aberta',longo:'Aberta agora'};
  const n=agora(), h=AGENDA[n.d];
  if(L.aberta) return{aberta:true,curto:'Aberta',longo:'Aberta agora'+(h&&n.m>=toMin(h[0])?' · até '+h[1]:'')};
  for(let k=0;k<8;k++){const d=(n.d+k)%7,x=AGENDA[d];if(x&&(k>0||n.m<toMin(x[0]))){const q=k===0?'hoje':k===1?'amanhã':DIASL[d];return{aberta:false,curto:'Fechada',longo:'Fechada · abre '+q+' às '+x[0],abre:q+' às '+x[0]}}}
  return{aberta:false,curto:'Fechada',longo:'Fechada',abre:''};
}
function paintStatus(){const s=status();$$('[data-status]').forEach(el=>{el.classList.toggle('open',s.aberta);el.textContent=el.closest('.top')?s.curto:s.longo})}
function horariosTexto(){
  const out=[]; let i=1, n=0;
  const ord=[1,2,3,4,5,6,0];
  for(let a=0;a<7;a=n){const x=AGENDA[ord[a]]; n=a+1; if(!x) continue;
    while(n<7&&AGENDA[ord[n]]&&AGENDA[ord[n]][0]===x[0]&&AGENDA[ord[n]][1]===x[1]) n++;
    out.push((n-a>1?DIAS[ord[a]]+' a '+DIAS[ord[n-1]]:DIAS[ord[a]])+', '+x[0]+' às '+x[1])}
  return out.length?out:['Fechada'];
}

/* ── state ── */
const linhaOk=l=>{const it=ITEM[l.id];return !!it&&!it.pausado&&l.q>0&&Array.isArray(l.op)&&l.op.length<=it.op.length&&it.op.every((gi,k)=>(l.op[k]||[]).every(oi=>OG[gi].itens[oi]&&!OG[gi].itens[oi].pausado))};
let cart=store.get('cart',[]).filter(linhaOk);
let modo=store.get('modo','entrega'), form=Object.assign({nome:'',fone:'',bairro:'',end:'',pag:'',troco:'',cupom:'',obs:''},store.get('form',{}));
let conta=store.get('conta',null), hist=store.get('hist',[]), pedido=store.get('pedido',null), info=null, enviando=false;
let cot=null, cotSig='', cotErro='';
const save=()=>store.set('cart',cart);
const saveForm=()=>store.set('form',{nome:form.nome,fone:form.fone,bairro:form.bairro,end:form.end});
const lineKey=l=>l.id+'|'+JSON.stringify(l.op)+'|'+(l.obs||'');
const lineUnit=l=>{const it=ITEM[l.id];let p=it.preco;it.op.forEach((gi,k)=>(l.op[k]||[]).forEach(oi=>p+=OG[gi].itens[oi].preco));return p};
const count=()=>cart.reduce((a,l)=>a+l.q,0);
const subtotal=()=>cart.reduce((a,l)=>a+l.q*lineUnit(l),0);
const qtyOf=id=>cart.reduce((a,l)=>a+(l.id===id?l.q:0),0);
const optText=l=>{const it=ITEM[l.id],out=[];it.op.forEach((gi,k)=>(l.op[k]||[]).forEach(oi=>{const o=OG[gi].itens[oi];out.push((o.preco?'+ ':'')+o.nome)}));return out.join(', ')};
const itensAPI=()=>cart.map(l=>{const it=ITEM[l.id],ops=[];it.op.forEach((gi,k)=>(l.op[k]||[]).forEach(oi=>ops.push(OG[gi].itens[oi].id)));return{id:+l.id,q:l.q,opcoes:ops,obs:l.obs||''}});

/* ── templates ── */
const logoSrc='logo.png';
$$('[data-logo]').forEach(im=>{im.src=logoSrc});
const addHTML=it=>it.pausado?'<span class="soldout">Esgotado</span>':it.op.length
  ?'<button type="button" class="add" data-open="'+it.id+'" data-addbtn="'+it.id+'" aria-label="Escolher opções de '+esc(it.nome)+'"><span class="ic ic--plus"></span><b hidden>0</b></button>'
  :'<div class="qty" data-qty="'+it.id+'"><button type="button" class="qty__b qty__minus" data-sub="'+it.id+'" aria-label="Remover um '+esc(it.nome)+'"><span class="ic ic--minus"></span></button><output aria-live="polite">0</output><button type="button" class="qty__b" data-add="'+it.id+'" aria-label="Adicionar '+esc(it.nome)+'"><span class="ic ic--plus"></span></button></div>';
const cardHTML=(it,wide,side)=>'<article class="card '+(wide?'card--wide':side)+(it.pausado?' off':'')+'" data-rv>'+
  '<button type="button" class="ph card__photo" data-open="'+it.id+'" aria-label="'+esc(it.nome)+', ver detalhes">'+
  '<img src="'+esc(FOTO(it.foto))+'" alt="'+esc(it.nome)+'" loading="lazy" decoding="async"><span class="card__jp" aria-hidden="true">'+it.cat.jp+'</span>'+
  '<span class="stampn" data-stamp="'+it.id+'" hidden><b>1</b></span></button>'+
  '<div class="card__body">'+(it.unidade?'<p class="unit">'+esc(it.unidade)+'</p>':'')+'<h3>'+esc(it.nome)+'</h3>'+(it.desc?'<p class="desc">'+esc(it.desc)+'</p>':'')+
  '<div class="card__foot">'+priceHTML(it.preco)+addHTML(it)+'</div></div></article>';
const hl=(txt,q)=>{if(!q)return esc(txt);const n=norm(txt),i=n.indexOf(q);if(i<0||n.length!==txt.length)return esc(txt);return esc(txt.slice(0,i))+'<mark>'+esc(txt.slice(i,i+q.length))+'</mark>'+esc(txt.slice(i+q.length))};
const rowHTML=(it,q,showCat)=>'<article class="row'+(it.pausado?' off':'')+'" data-open="'+it.id+'"><div class="row__main">'+(showCat?'<span class="row__cat">'+esc(it.cat.titulo)+'</span>':'')+
  '<h3>'+hl(it.nome,q)+'</h3>'+(it.unidade&&(showCat||it.unidade!==it.cat.unidade)?'<span class="unit">'+esc(it.unidade)+'</span>':'')+(it.desc?'<p class="desc">'+hl(it.desc,q)+'</p>':'')+
  '</div><div class="row__side">'+priceHTML(it.preco)+addHTML(it)+'</div></article>';
const tearSVG=(cls,seed)=>'<svg class="tear '+cls+'" viewBox="0 0 400 22" preserveAspectRatio="none" data-tear="'+seed+'" aria-hidden="true"></svg>';
const INTER='<div class="inter" id="inter">'+tearSVG('tear--a',19)+'<img src="'+IMG(GRILL,900,1100)+'" alt="" loading="lazy" decoding="async"><p class="inter__k" aria-hidden="true">火</p>'+
  '<p class="inter__t"><span data-rv>Brasa, maçarico</span><span data-rv>e peixe fresco.</span><span data-rv>O resto é detalhe.</span></p>'+tearSVG('tear--b',53)+'</div>';

/* ── render: hero, ticker, destaques, cardápio ── */
$('#hero-img').src=IMG(HERO,900,1500);
const tick=[['刺身','Sashimi'],['握り','Niguiri'],['裏巻','Uramaki'],['手巻','Temaki'],['炙り','Maçaricado'],['炉端','Robata'],['揚巻','Hot']].map(t=>'<span><em>'+t[0]+'</em>'+t[1]+'<i></i></span>').join('');
$('#ticker').innerHTML=tick+tick;
const SIGNO=['壱','弐','参','肆','伍','陸'];
function renderMenu(){
  let SIG=[/^robata/i,/^shake ebi tight/i,/^tatuzinho/i,/^uramaki trufado/i,/^coxinha gourmet/i,/^uramaki ômega/i].map(findItem).filter(i=>i&&i.foto);
  if(SIG.length<3) SIG=ALL.filter(i=>i.foto).slice(0,6);
  $('.sig').hidden=!SIG.length;
  $('#sig-track').innerHTML=SIG.map((it,i)=>'<article class="sigc'+(it.pausado?' off':'')+'" data-open="'+it.id+'" data-rv style="--d:'+(i*.09)+'s">'+
    '<img src="'+esc(FOTO(it.foto))+'" alt="'+esc(it.nome)+'" '+(i>1?'loading="lazy" ':'')+'decoding="async"><span class="sigc__no" aria-hidden="true">'+SIGNO[i]+'</span><span class="sigc__jp" aria-hidden="true">'+it.cat.jp+'</span>'+
    '<div class="sigc__txt"><h3>'+esc(it.nome)+'</h3>'+(it.desc?'<p>'+esc(it.desc)+'</p>':'')+priceHTML(it.preco)+'</div>'+
    (it.pausado?'<span class="soldout soldout--on">Esgotado</span>':'<button type="button" class="add" data-open="'+it.id+'" data-addbtn="'+it.id+'" aria-label="Escolher opções de '+esc(it.nome)+'"><span class="ic ic--plus"></span><b hidden>0</b></button>')+'</article>').join('');
  let body='', tabs='';
  CATS.forEach((c,ci)=>{
    const fot=c.itens.filter(i=>i.foto), sem=c.itens.filter(i=>!i.foto);
    let cards='';
    if(fot.length){
      const odd=fot.length%2===1, wideId=odd?(fot.find(i=>WIDE.test(i.foto))||fot[0]).id:null;
      const ord=wideId?[ITEM[wideId]].concat(fot.filter(i=>i.id!==wideId)):fot; let k=0;
      cards='<div class="grid">'+ord.map(it=>{const w=it.id===wideId;return cardHTML(it,w,w?'':(k++%2?'r':'l'))}).join('')+'</div>';
    }
    const sub=[c.unidade?c.unidade+' por porção':'',c.nota,c.itens.length+(c.itens.length===1?' opção':' opções')].filter(Boolean).join(' · ');
    body+='<section class="sec" id="'+c.id+'" aria-labelledby="h-'+c.id+'"><header class="sec__head"><div class="sec__k" aria-hidden="true">'+c.jp+'</div>'+
      '<div><span class="sec__n">Nº '+(ci+1)+' de '+CATS.length+'</span><h2 id="h-'+c.id+'">'+esc(c.titulo)+'</h2><p>'+esc(sub)+'</p></div></header>'+
      (c.capa&&!fot.length?'<figure class="cover" data-rv><img src="'+IMG(c.capa,900,506)+'" alt="" loading="lazy" decoding="async"><span>Imagem ilustrativa</span></figure>':'')+
      cards+(sem.length?'<div class="rows">'+sem.map(it=>rowHTML(it,'',false)).join('')+'</div>':'')+'</section>';
    if(ci===5) body+=INTER;
    tabs+='<a class="tab" href="#'+c.id+'" data-tab="'+c.id+'">'+esc(c.titulo)+'<i>'+c.jp+'</i></a>';
  });
  $('#menu-body').innerHTML=body;
  $$('#tabs .tab').forEach(t=>t.remove());
  $('#tabs').insertAdjacentHTML('afterbegin',tabs);
  $('#foot-info').innerHTML=
    '<div data-rv><h3>Onde</h3><p>'+esc(L.endereco.rua)+'<br>'+esc(L.endereco.bairro)+' · '+esc(L.endereco.cidade)+', '+esc(L.endereco.uf)+(L.endereco.complemento?'<br>'+esc(L.endereco.complemento):'')+'</p></div>'+
    '<div data-rv style="--d:.08s"><h3>Quando</h3><p>'+horariosTexto().map(esc).join('<br>')+'</p></div>'+
    '<div data-rv style="--d:.16s"><h3>Fale com a gente</h3><p><a href="'+esc(zap)+'" target="_blank" rel="noopener">'+esc(fone)+'</a></p></div>';
  $$('.hero__meta').forEach(el=>{el.innerHTML=[L.entrega.ativa&&'Entrega',L.retirada.ativa&&'Retirada',esc(L.endereco.cidade)].filter(Boolean).join('<i></i>')});
  $$('[data-tear]').forEach(svg=>{
    let s=+svg.dataset.tear*7919+13; const rnd=()=>{s=(s*16807)%2147483647;return s/2147483647};
    const line=(base,amp)=>{let y=base,d='M0 22 L0 '+y.toFixed(1);for(let x=0;x<=400;x+=2.5+rnd()*6.5){y+=(rnd()-.5)*amp;y=Math.max(2,Math.min(18,y));d+=' L'+x.toFixed(1)+' '+y.toFixed(1)}return d+' L400 '+y.toFixed(1)+' L400 22 Z'};
    const a=line(9,7), b=line(14,5); svg.innerHTML='<path d="'+b+'"/><path d="'+a+'"/>';
  });
}
renderMenu();
document.addEventListener('error',e=>{const t=e.target;if(!t||t.tagName!=='IMG')return;
  if(t.hasAttribute('data-logo')){if(!t.dataset.lo){t.dataset.lo=1;t.parentElement.classList.add('lo');t.src='logo-original.png'}return}
  t.style.visibility='hidden';if(t.parentElement)t.parentElement.classList.add('noimg')},true);

/* ── o cardápio muda no painel: buscar de novo e redesenhar ── */
let spyObs=null, inter=null, interImg=null, curTab=null;
async function atualizar(){
  let A; try{A=await api('cardapio')}catch(e){return}
  if(A.versao===VERSAO) return;
  const y=window.scrollY;
  carregar(A);
  const antes=cart.length; cart=cart.filter(linhaOk); if(cart.length!==antes){save();toast('Um item do seu pedido ficou indisponível e foi removido')}
  renderMenu(); inter=null; interImg=null;
  $$('#menu-body [data-rv], #sig-track [data-rv], #foot-info [data-rv]').forEach(el=>el.classList.add('in'));
  if(spyObs) $$('.sec').forEach(s=>spyObs.observe(s));
  window.scrollTo(0,y);
  if(curTab&&!$('[data-tab="'+curTab+'"]')&&CATS[0]) setTab(CATS[0].id); else if(curTab) setTab(curTab);
  if(openEl===SH.prato&&dish&&(!ITEM[dish.it.id]||ITEM[dish.it.id].pausado)){dish.volta=null;closeSheet();toast('Este item ficou indisponível')}
  else if(openEl===SH.loja) renderLoja();
  else if(openEl===SH.busca) renderBusca();
  cotSig=''; paintStatus(); sync();
}
setInterval(()=>{if(!document.hidden) atualizar()},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){atualizar();if(pedido)tickTrack()}});

/* ── sync UI with cart ── */
const bar=$('#cartbar'), tbar=$('#trackbar'), scrim=$('#scrim');
const SH={prato:$('#s-prato'),pedido:$('#s-pedido'),acompanhar:$('#s-acompanhar'),busca:$('#s-busca'),loja:$('#s-loja'),conta:$('#s-conta')};
let openEl=null,lastFocus=null;
function sync(){
  if(openEl===SH.pedido) renderCart();
  $$('[data-qty]').forEach(el=>{const n=qtyOf(el.dataset.qty);el.classList.toggle('on',n>0);el.querySelector('output').textContent=n});
  $$('[data-addbtn]').forEach(el=>{const n=qtyOf(el.dataset.addbtn),b=el.querySelector('b');el.classList.toggle('has',n>0);b.hidden=!n;b.textContent=n});
  $$('[data-stamp]').forEach(el=>{const n=qtyOf(el.dataset.stamp);el.hidden=!n;el.querySelector('b').textContent=n});
  const n=count();
  $('#bar-n').textContent=n; $('#bar-s').textContent=fmt(subtotal());
  const nn=$('#nav-n'); nn.hidden=!n; nn.textContent=n;
  const showBar=n>0&&!openEl; bar.classList.toggle('show',showBar); bar.tabIndex=showBar?0:-1;
  const showTrk=!n&&!!pedido&&!openEl; tbar.classList.toggle('show',showTrk); tbar.tabIndex=showTrk?0:-1;
  if(pedido){$('#tb-n').textContent='Pedido nº '+pedido.n;$('#tb-s').textContent=tituloStatus()}
  $('#nav-conta').textContent=conta?'Conta':'Entrar';
}
function bump(id){
  $$('[data-stamp="'+id+'"]').forEach(el=>{el.classList.remove('hit');void el.offsetWidth;el.classList.add('hit')});
  bar.classList.remove('bump');void bar.offsetWidth;bar.classList.add('bump');
  if(navigator.vibrate){try{navigator.vibrate(12)}catch(e){}}
}
function addLine(l){const k=lineKey(l),ex=cart.find(x=>lineKey(x)===k);if(ex)ex.q=Math.min(30,ex.q+l.q);else cart.push(l);save();sync();bump(l.id)}
function changeSimple(id,d){if(d>0&&ITEM[id]&&ITEM[id].pausado)return;const l=cart.find(x=>x.id===id);if(l){l.q=Math.min(30,l.q+d);if(l.q<=0)cart.splice(cart.indexOf(l),1)}else if(d>0)cart.push({id:id,q:1,op:[],obs:''});save();sync();if(d>0)bump(id)}
let toastT=0;function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('on'),2600)}

/* ── sheets ── */
function openSheet(name){
  const el=SH[name]; if(!el) return;
  if(openEl&&openEl!==el) shut(openEl); else if(!openEl) lastFocus=document.activeElement;
  openEl=el; el.classList.add('open'); el.setAttribute('aria-hidden','false'); el.style.transform='';
  scrim.classList.add('on'); document.documentElement.classList.add('lock');
  const sc=$('.sheet__scroll',el); if(sc) sc.scrollTop=0;
  if(name==='pedido') renderCart();
  if(name==='acompanhar'){renderTrack();tickTrack()}
  if(name==='loja') renderLoja();
  if(name==='conta') renderConta();
  if(name==='busca'){renderBusca();setTimeout(()=>$('#q').focus({preventScroll:true}),350)}
  else setTimeout(()=>{const x=$('.x',el);if(x)x.focus({preventScroll:true})},80);
  navMark(name); sync();
}
function shut(el){el.classList.remove('open','drag');el.setAttribute('aria-hidden','true');el.style.transform=''}
function closeSheet(){
  if(!openEl) return;
  if(openEl===SH.prato&&dish&&dish.volta){const v=dish.volta;dish.volta=null;shut(openEl);openEl=SH[v];openEl.classList.add('open');openEl.setAttribute('aria-hidden','false');navMark(v);sync();return}
  shut(openEl); openEl=null;
  scrim.classList.remove('on'); document.documentElement.classList.remove('lock');
  if(lastFocus&&lastFocus.focus) lastFocus.focus({preventScroll:true});
  navMark('menu'); sync();
}
function navMark(name){const m={busca:'busca',pedido:'pedido',acompanhar:'pedido',conta:'conta'}[name]||'menu';$$('[data-nav]').forEach(b=>b.classList.toggle('on',b.dataset.nav===m))}

/* ── prato + opções ── */
let dish=null;
function openDish(id){
  const it=ITEM[id]; if(!it) return;
  if(it.pausado){toast(it.nome+' está esgotado no momento');return}
  const last=store.get('acomp',null);
  dish={it:it,q:1,obs:'',volta:openEl===SH.busca?'busca':null,sel:it.op.map(gi=>{const g=OG[gi];return g.acomp&&Array.isArray(last)&&last.every(i=>g.itens[i]&&!g.itens[i].pausado)?last.slice():[]})};
  const el=SH.prato; el.classList.toggle('hasph',!!it.foto);
  let h=it.foto?'<div class="ph dish__ph"><img src="'+esc(FOTO(it.foto))+'" alt="'+esc(it.nome)+'"><span class="dish__jp" aria-hidden="true">'+it.cat.jp+'</span></div>'
               :'<div class="dish__none" aria-hidden="true"><span>'+it.cat.jp+'</span></div>';
  h+='<div class="dish__body"><p class="unit">'+esc([it.cat.titulo,it.unidade].filter(Boolean).join(' · '))+'</p><h3 id="dish-name">'+esc(it.nome)+'</h3>'+
     '<span class="price dish__price">'+fmt(it.preco)+'</span>'+(it.desc?'<p class="dish__d">'+esc(it.desc)+'</p>':'');
  it.op.map((gi,k)=>[gi,k]).sort((a,b)=>(OG[b[0]].min>0)-(OG[a[0]].min>0)).forEach(pair=>{const gi=pair[0],k=pair[1],g=OG[gi], radio=g.max===1;
    const regra=g.min===g.max?'Escolha '+g.min+(g.min===1?' opção':' opções'):g.min>0?'Escolha de '+g.min+' até '+g.max+' opções':'Opcional · até '+g.max;
    h+='<fieldset class="og" data-og="'+k+'" style="border-left:0;border-right:0;border-bottom:0;margin-left:0;margin-right:0;padding-left:0;padding-right:0;min-width:0"><div class="og__h"><div><h4>'+esc(g.nome)+'</h4><p>'+regra+'</p></div>'+
       (g.min>0?'<span class="og__req">Obrigatório</span>':'')+'</div>'+
       g.itens.map((o,oi)=>'<label class="opt'+(o.pausado?' off':'')+'"><input type="'+(radio?'radio':'checkbox')+'" name="og'+k+'" value="'+oi+'"'+(dish.sel[k].indexOf(oi)>=0?' checked':'')+(o.pausado?' data-off="1" disabled':'')+'><span>'+esc(o.nome)+(o.pausado?' · indisponível':'')+'</span>'+(o.preco?'<em>+ '+fmt(o.preco)+'</em>':'')+'</label>').join('')+'</fieldset>';
  });
  h+='<label class="field"><span>Observações <i id="obs-n" style="font-style:normal">0/180</i></span><textarea id="obs" maxlength="180" placeholder="Algo que a cozinha precisa saber?"></textarea></label>'+
     '<p class="note" style="margin-top:8px">Mudanças que geram cobrança adicional não são aceitas neste campo.</p></div>';
  $('#dish-scroll').innerHTML=h;
  dishPaint(); openSheet('prato');
}
function dishOK(){return dish.it.op.every((gi,k)=>dish.sel[k].length>=OG[gi].min)}
function dishPaint(){
  const it=dish.it;
  it.op.forEach((gi,k)=>{const g=OG[gi],fs=$('[data-og="'+k+'"]');if(!fs)return;const sel=dish.sel[k];
    $$('input',fs).forEach(inp=>{const oi=+inp.value;inp.checked=sel.indexOf(oi)>=0;inp.disabled=!!inp.dataset.off||(g.max>1&&!inp.checked&&sel.length>=g.max)});
    const rq=$('.og__req',fs);if(rq){const ok=sel.length>=g.min;rq.classList.toggle('ok',ok);rq.textContent=ok?'Feito':'Obrigatório'}});
  let unit=it.preco;it.op.forEach((gi,k)=>dish.sel[k].forEach(oi=>unit+=OG[gi].itens[oi].preco));
  $('#dish-q').textContent=dish.q;
  const b=$('#dish-add'),ok=dishOK();b.classList.toggle('wait',!ok);
  b.textContent=ok?'Adicionar · '+fmt(unit*dish.q):'Escolha as opções';
}
$('#dish-scroll').addEventListener('change',e=>{
  const inp=e.target; if(inp.tagName!=='INPUT'||!dish) return;
  const k=+inp.closest('[data-og]').dataset.og, g=OG[dish.it.op[k]], oi=+inp.value; let sel=dish.sel[k];
  if(g.max===1) sel=[oi];
  else if(inp.checked){const o=g.itens[oi];
    if(o.todos||o.nenhum) sel=[oi]; else{sel=sel.filter(i=>!g.itens[i].todos&&!g.itens[i].nenhum);if(sel.length<g.max)sel.push(oi)}}
  else sel=sel.filter(i=>i!==oi);
  dish.sel[k]=sel; dishPaint();
});
$('#dish-scroll').addEventListener('input',e=>{if(e.target.id==='obs'){dish.obs=e.target.value.trim();$('#obs-n').textContent=e.target.value.length+'/180'}});
$('#dish-plus').addEventListener('click',()=>{dish.q=Math.min(30,dish.q+1);dishPaint()});
$('#dish-minus').addEventListener('click',()=>{dish.q=Math.max(1,dish.q-1);dishPaint()});
$('#dish-add').addEventListener('click',()=>{
  if(!dishOK()){const k=dish.it.op.findIndex((gi,i)=>dish.sel[i].length<OG[gi].min),fs=$('[data-og="'+k+'"]');
    fs.scrollIntoView({behavior:'smooth',block:'center'});fs.classList.remove('bad');void fs.offsetWidth;fs.classList.add('bad');return}
  dish.it.op.forEach((gi,k)=>{if(OG[gi].acomp)store.set('acomp',dish.sel[k])});
  const l={id:dish.it.id,q:dish.q,op:dish.sel.map(a=>a.slice().sort((x,y)=>x-y)),obs:dish.obs},nome=dish.it.nome;
  closeSheet(); addLine(l); toast(nome+' no pedido');
});

/* ── pedido (carrinho): os valores mostrados são conferidos pelo servidor, que é quem calcula o total final ── */
const PAGS={dinheiro:'Dinheiro',debito:'Débito',credito:'Crédito',online:'Pagar online'};
const cent=v=>Math.round(v*100);
const taxa=()=>{if(modo!=='entrega')return 0;if(!form.bairro)return null;const b=L.entrega.bairros.find(x=>x[0]===form.bairro);if(!b)return null;return L.entrega.gratisAcima>0&&subtotal()>=L.entrega.gratisAcima?0:b[1]};
const descLocal=()=>modo==='retirada'&&L.retirada.descontoPct>0?Math.round(subtotal()*L.retirada.descontoPct)/100:0;
const corpoPedido=()=>({tipo:modo,bairro:form.bairro,itens:itensAPI(),cupom:form.cupom.trim()});
async function cotar(){
  const sig=JSON.stringify(corpoPedido());
  if(sig===cotSig) return; cotSig=sig; cot=null; cotErro='';
  if(!form.cupom.trim()||!cart.length||(modo==='entrega'&&!form.bairro)) return;
  try{const c=await api('cotacao',corpoPedido());if(sig!==cotSig)return;cot=c}
  catch(e){if(sig!==cotSig)return;cotErro=e.erro||'Cupom inválido.'}
  if(openEl===SH.pedido){const y=$('#cart-scroll').scrollTop;renderCart();$('#cart-scroll').scrollTop=y}
}
function renderCart(){
  const sc=$('#cart-scroll'), cta=$('#cart-cta'), st=status(), n=count();
  const head='<div class="shead"><div><p class="eyebrow">'+(n?n+(n===1?' item':' itens'):'Comanda')+'</p><h3>Seu pedido</h3></div><p class="shead__jp" aria-hidden="true">注文票</p></div>';
  if(!cart.length){cta.hidden=true;
    sc.innerHTML=head+'<div class="empty"><p class="k" aria-hidden="true">火</p><h4>Nada no fogo ainda</h4><p>Escolha um prato no cardápio e ele aparece aqui.</p><button type="button" class="btn btn--ink" data-close>Ver cardápio</button>'+
      (pedido?'<p style="margin-top:18px"><button type="button" class="btn btn--line" data-sheet="acompanhar">Acompanhar pedido nº '+pedido.n+'</button></p>':'')+'</div>';return}
  if(modo==='entrega'&&!L.entrega.ativa) modo='retirada';
  if(modo==='retirada'&&!L.retirada.ativa) modo='entrega';
  if(form.bairro&&!L.entrega.bairros.some(b=>b[0]===form.bairro)) form.bairro='';
  const P=L.pagamento, pays=[P.dinheiro&&'dinheiro',P.debito.length&&'debito',P.credito.length&&'credito',P.online&&'online'].filter(Boolean);
  if(form.pag&&pays.indexOf(form.pag)<0) form.pag='';
  cotar();
  const sub=subtotal(), tx=cot?cot.taxa/100:taxa(), desc=cot?cot.desconto/100:descLocal(), total=cot?cot.total/100:sub-desc+(tx||0);
  const falta=modo==='entrega'&&L.entrega.pedidoMinimo>0&&sub<L.entrega.pedidoMinimo;
  sc.innerHTML=head+
    (st.aberta?'':'<p class="closed"><b>Loja fechada agora.</b> '+(st.abre?'Abre '+esc(st.abre)+'. ':'')+'Você pode montar o pedido, mas só dá para enviar quando a loja abrir.</p>')+
    (L.entrega.ativa&&L.retirada.ativa?'<div class="seg" data-mode="'+modo+'" role="group" aria-label="Como você quer receber"><button type="button" data-modo="entrega" aria-pressed="'+(modo==='entrega')+'">Entrega</button><button type="button" data-modo="retirada" aria-pressed="'+(modo==='retirada')+'">Retirada</button></div>':'')+
    '<ul class="lines">'+cart.map((l,i)=>{const it=ITEM[l.id],o=optText(l);
      return '<li class="line"><div><b>'+esc(it.nome)+'</b>'+(o?'<small>'+esc(o)+'</small>':'')+(l.obs?'<small class="obs">“'+esc(l.obs)+'”</small>':'')+'</div>'+
      '<div class="line__r">'+priceHTML(lineUnit(l)*l.q)+'<div class="qty on"><button type="button" class="qty__b qty__minus" data-line="'+i+'" data-d="-1" aria-label="Remover um"><span class="ic ic--minus"></span></button><output>'+l.q+'</output><button type="button" class="qty__b" data-line="'+i+'" data-d="1" aria-label="Adicionar um"><span class="ic ic--plus"></span></button></div></div></li>'}).join('')+'</ul>'+
    '<div class="pad">'+
    '<label class="field" id="f-nome"><span>Seu nome</span><input id="nome" type="text" maxlength="80" autocomplete="name" placeholder="Como devemos te chamar?" value="'+esc(form.nome)+'"></label>'+
    '<label class="field" id="f-fone"><span>Telefone com DDD</span><input id="fone" type="tel" inputmode="tel" maxlength="20" autocomplete="tel" placeholder="(91) 90000-0000" value="'+esc(form.fone)+'"></label>'+
    (modo==='entrega'
      ?'<label class="field" id="f-bairro"><span>Bairro</span><select id="bairro"><option value="">Selecione o bairro</option>'+L.entrega.bairros.map(b=>'<option'+(form.bairro===b[0]?' selected':'')+' value="'+esc(b[0])+'">'+esc(b[0])+' · '+fmt(b[1])+'</option>').join('')+'</select></label>'+
       '<label class="field" id="f-end"><span>Qual é o seu endereço?</span><input id="end" type="text" maxlength="160" autocomplete="street-address" placeholder="Rua, número e referência" value="'+esc(form.end)+'"></label>'+
       '<p class="note" style="margin-top:8px">Entrega em '+tempoEntrega+'. Seu bairro não está na lista? Fale com a loja pelo WhatsApp.'+(L.entrega.gratisAcima>0?' Entrega grátis a partir de '+fmt(L.entrega.gratisAcima)+'.':'')+'</p>'
      :'<div class="box" style="margin-top:22px"><h5>Retirar em</h5><p>'+esc(endLoja)+'<br>Pronto em cerca de '+L.retirada.minutos+' min.'+(L.retirada.descontoPct>0?'<br>'+L.retirada.descontoPct+'% de desconto na retirada.':'')+'</p></div>')+
    '<div class="field" id="f-pag"><span>Como você vai pagar?</span><div class="pays">'+pays.map(p=>'<button type="button" data-pag="'+p+'" aria-pressed="'+(form.pag===p)+'">'+PAGS[p]+'</button>').join('')+'</div></div>'+
    (form.pag==='online'?'<p class="note" style="margin-top:8px">'+(P.onlineModo==='mercadopago'?'Pix ou cartão pelo Mercado Pago, em ambiente de teste (sandbox).':'Pagamento simulado: nenhuma cobrança real é feita nesta demonstração.')+'</p>':form.pag?'<p class="note" style="margin-top:8px">Pagamento na '+(modo==='entrega'?'entrega':'retirada')+'.</p>':'')+
    (form.pag==='dinheiro'?'<label class="field" id="f-troco"><span>Troco para quanto?</span><input id="troco" type="text" inputmode="decimal" autocomplete="off" placeholder="Deixe vazio se não precisa" value="'+esc(form.troco)+'"></label>':'')+
    '<div class="field" id="f-cupom"><span>Cupom de desconto</span><div class="cupom"><input id="cupom" type="text" maxlength="30" autocomplete="off" autocapitalize="characters" placeholder="Código" value="'+esc(form.cupom)+'"><button type="button" id="cupom-ok">Aplicar</button></div></div>'+
    (cotErro?'<p class="note bad" style="margin-top:8px">'+esc(cotErro)+'</p>':cot&&cot.cupom?'<p class="note ok" style="margin-top:8px">Cupom '+esc(cot.cupom)+' aplicado.</p>':form.cupom.trim()&&modo==='entrega'&&!form.bairro?'<p class="note" style="margin-top:8px">Escolha o bairro para conferir o cupom.</p>':'')+
    '<label class="field"><span>Observações do pedido</span><input id="pobs" type="text" maxlength="300" autocomplete="off" placeholder="Opcional" value="'+esc(form.obs)+'"></label>'+
    '</div><div class="tot"><div><span>Subtotal</span><i></i><b>'+fmt(sub)+'</b></div>'+
    (desc>0?'<div><span>Desconto</span><i></i><b>− '+fmt(desc)+'</b></div>':'')+
    '<div><span>'+(modo==='entrega'?'Taxa de entrega':'Retirada')+'</span><i></i><b>'+(modo!=='entrega'||tx===0?'Grátis':tx===null?'—':fmt(tx))+'</b></div>'+
    '<div class="sum"><span>Total</span><i></i><b>'+fmt(total)+'</b></div></div>'+
    (falta?'<p class="closed" style="margin-bottom:8px">O pedido mínimo para entrega é '+fmt(L.entrega.pedidoMinimo)+'.</p>':'');
  cta.hidden=false; const b=$('#place'); b.textContent=enviando?'Enviando…':st.aberta?'Fazer pedido · '+fmt(total):'Loja fechada'; b.classList.toggle('wait',!st.aberta||enviando||falta);
}
const rerenderCart=()=>{const y=$('#cart-scroll').scrollTop;renderCart();$('#cart-scroll').scrollTop=y};
$('#cart-scroll').addEventListener('change',e=>{if(e.target.id==='bairro'){form.bairro=e.target.value;saveForm();rerenderCart()}});
$('#cart-scroll').addEventListener('input',e=>{const t=e.target,m={nome:'nome',fone:'fone',end:'end',troco:'troco',pobs:'obs',cupom:'cupom'}[t.id];if(m){form[m]=t.value;if(m!=='troco'&&m!=='obs'&&m!=='cupom')saveForm()}});
$('#cart-scroll').addEventListener('click',e=>{if(e.target.closest('#cupom-ok')){form.cupom=$('#cupom').value.trim().toUpperCase();cotSig='';rerenderCart()}});
$('#cart-scroll').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='cupom'){e.preventDefault();$('#cupom-ok').click()}});
function flag(sel,msg){const f=$(sel);if(f){f.scrollIntoView({behavior:'smooth',block:'center'});f.classList.remove('bad');void f.offsetWidth;f.classList.add('bad')}if(msg)toast(msg)}
$('#place').addEventListener('click',async()=>{
  if(enviando) return;
  if(!status().aberta){toast('A loja está fechada agora');return}
  if(form.nome.trim().length<2) return flag('#f-nome','Informe seu nome');
  if(form.fone.replace(/\D/g,'').length<10) return flag('#f-fone','Informe um telefone com DDD');
  if(modo==='entrega'&&!form.bairro) return flag('#f-bairro','Escolha o bairro da entrega');
  if(modo==='entrega'&&form.end.trim().length<5) return flag('#f-end','Informe o endereço da entrega');
  if(!form.pag) return flag('#f-pag','Escolha a forma de pagamento');
  let troco=null;
  if(form.pag==='dinheiro'&&form.troco.trim()){const v=parseFloat(form.troco.replace(/[^\d,.]/g,'').replace(/\.(?=\d{3})/g,'').replace(',','.'));if(!isFinite(v)||v<0) return flag('#f-troco','Valor de troco inválido');troco=cent(v)}
  const corpo=Object.assign(corpoPedido(),{cliente:{nome:form.nome.trim(),telefone:form.fone.trim()},endereco:form.end.trim(),pagamento:form.pag,troco:troco,obs:form.obs.trim()});
  const snap=cart.map(l=>({id:l.id,q:l.q,op:l.op,obs:l.obs,nome:ITEM[l.id].nome}));
  enviando=true; renderCart();
  let r;
  try{r=await api('pedidos',corpo)}
  catch(e){enviando=false;renderCart();toast(e.erro);if(e.status===409)atualizar();return}
  enviando=false;
  if(pedido) arquivar();
  pedido={token:r.token,n:r.numero,t0:Date.now(),itens:snap}; info=null;
  store.set('pedido',pedido); cart=[]; save(); form.cupom='';form.obs='';form.troco='';cot=null;cotSig='';
  if(navigator.vibrate){try{navigator.vibrate([18,60,30])}catch(e){}}
  if(r.pagamento&&r.pagamento.modo==='mercadopago'&&r.pagamento.url){location.href=r.pagamento.url;return}
  openSheet('acompanhar');
});

/* ── acompanhar pedido: o status vem da loja, pela API ── */
const FINAIS={concluido:1,recusado:1,cancelado:1};
const PASSOS=tipo=>tipo==='retirada'
  ?[['novo','受付','Pedido enviado','A loja recebeu o pedido e já vai confirmar.'],['aceito','確認','Confirmado pela loja','A loja aceitou o pedido.'],['em_preparo','調理','Em preparo','Seu pedido está sendo montado agora.'],['pronto_retirada','準備','Pronto para retirada','Pode vir buscar: '+endLoja+'.'],['concluido','完了','Retirado','Bom apetite!']]
  :[['novo','受付','Pedido enviado','A loja recebeu o pedido e já vai confirmar.'],['aceito','確認','Confirmado pela loja','A loja aceitou o pedido.'],['em_preparo','調理','Em preparo','Seu pedido está sendo montado agora.'],['saiu_entrega','配達','Saiu para entrega','O entregador está a caminho.'],['concluido','完了','Entregue','Bom apetite!']];
function tituloStatus(){
  if(!info) return 'Carregando…';
  if(info.status==='aguardando_pagamento') return 'Aguardando pagamento';
  if(info.status==='recusado') return 'Pedido recusado';
  if(info.status==='cancelado') return 'Pedido cancelado';
  const p=PASSOS(info.tipo).find(x=>x[0]===info.status); return p?p[2]:'';
}
const hora=t=>new Date(t).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
function arquivar(){if(!pedido)return;hist.unshift({n:pedido.n,t0:pedido.t0,total:info?info.total/100:0,modo:info?info.tipo:'entrega',itens:pedido.itens||[]});hist=hist.slice(0,8);store.set('hist',hist)}
function resumoHTML(p){
  return '<div class="box"><h5>Itens</h5><ul>'+p.itens.map(i=>'<li><span>'+i.qtd+'× '+esc(i.nome)+(i.opcoes.length?'<br><small class="note">'+esc(i.opcoes.join(', '))+'</small>':'')+(i.obs?'<br><small class="note">“'+esc(i.obs)+'”</small>':'')+'</span><span>'+fmt(i.total/100)+'</span></li>').join('')+
    (p.desconto?'<li><span>Desconto'+(p.cupom?' ('+esc(p.cupom)+')':'')+'</span><span>− '+fmt(p.desconto/100)+'</span></li>':'')+
    '<li><span>'+(p.tipo==='entrega'?'Taxa de entrega':'Retirada')+'</span><span>'+(p.taxa?fmt(p.taxa/100):'Grátis')+'</span></li><li style="font-weight:700"><span>Total</span><span>'+fmt(p.total/100)+'</span></li></ul></div>'+
    '<div class="box"><h5>'+(p.tipo==='entrega'?'Entrega':'Retirada')+' · '+PAGS[p.pagamento]+(p.pagStatus==='pago'?' · pago':p.pagStatus==='simulado'?' · pagamento simulado':'')+'</h5><p>'+(p.tipo==='entrega'?esc([p.endereco,p.bairro].filter(Boolean).join(' · '))+'<br>Previsão de '+tempoEntrega:esc(endLoja)+'<br>Cerca de '+L.retirada.minutos+' min')+'</p></div>';
}
function renderTrack(){
  const sc=$('#trk-scroll');
  if(!pedido){sc.innerHTML='<div class="shead"><div><p class="eyebrow">Acompanhar</p><h3>Nenhum pedido em andamento</h3></div></div><div class="empty"><p class="k" aria-hidden="true">火</p><p>Quando você fizer um pedido, o andamento aparece aqui.</p><button type="button" class="btn btn--ink" data-close>Ver cardápio</button></div>';return}
  const head='<div class="shead"><div><p class="eyebrow">Pedido nº '+pedido.n+' · '+hora(pedido.t0)+'</p><h3>Acompanhar</h3></div><p class="shead__jp" aria-hidden="true">追跡</p></div>';
  if(!info){sc.innerHTML=head+'<div class="trk"><div class="trk__now"><h4>Carregando…</h4><p>Buscando o status do pedido na loja.</p></div></div>';return}
  const E=PASSOS(info.tipo), quando={}; info.eventos.forEach(ev=>{quando[ev.status]=ev.em*1000});
  let topo, passos='';
  if(info.status==='aguardando_pagamento'){
    topo='<div class="trk__now" aria-live="polite"><h4>Aguardando pagamento</h4><p>O pedido só vai para a loja depois que o pagamento for confirmado.</p></div>'+
      (info.onlineModo==='mercadopago'
        ?'<div class="acts" style="margin-top:14px"><button type="button" class="btn btn--fire btn--wide" id="pg-link">Pagar com Mercado Pago</button><button type="button" class="btn btn--line btn--wide" id="pg-conf">Já paguei, conferir</button></div><p class="demo"><b>Teste</b><span>Ambiente de teste (sandbox) do Mercado Pago. Nenhuma cobrança real é feita.</span></p>'
        :'<p class="demo"><b>Simulado</b><span>Não há credenciais de pagamento configuradas. O botão abaixo simula um pagamento aprovado; nenhuma cobrança é feita.</span></p><div class="acts" style="margin-top:14px"><button type="button" class="btn btn--fire btn--wide" id="pg-sim">Simular pagamento aprovado</button></div>');
  }else if(info.status==='recusado'||info.status==='cancelado'){
    topo='<div class="trk__now bad" aria-live="polite"><h4>'+tituloStatus()+'</h4><p>'+(info.motivo?'Motivo: '+esc(info.motivo):'Fale com a loja para saber mais.')+'</p></div>';
  }else{
    const e=E.findIndex(x=>x[0]===info.status), fim=info.status==='concluido';
    topo='<div class="trk__now" aria-live="polite"><h4>'+E[e][2]+'</h4><p>'+esc(E[e][3])+'</p></div>';
    passos='<ol class="steps">'+E.map((x,i)=>'<li class="step '+(i<e||fim?'done':i===e?'now':'')+'"><span class="step__k" aria-hidden="true">'+x[1]+'</span><div><b>'+x[2]+'</b>'+(i===e&&!fim?'<small>Agora</small>':'')+'</div>'+(i<=e&&quando[x[0]]?'<time>'+hora(quando[x[0]])+'</time>':'')+'</li>').join('')+'</ol>';
  }
  sc.innerHTML=head+'<div class="trk">'+topo+passos+resumoHTML(info)+
    '<div class="acts"><a class="btn btn--ink btn--wide" href="'+esc(zap)+'" target="_blank" rel="noopener">Falar com a loja</a><button type="button" class="btn btn--line btn--wide" data-close>Voltar ao cardápio</button></div></div>';
}
$('#trk-scroll').addEventListener('click',async e=>{
  const b=e.target.closest('#pg-sim,#pg-conf,#pg-link'); if(!b||!pedido||b.disabled) return; b.disabled=true;
  try{
    if(b.id==='pg-link'){const r=await api('pedidos/'+pedido.token+'/link-pagamento',{});location.href=r.url;return}
    const r=await api('pedidos/'+pedido.token+(b.id==='pg-sim'?'/pagamento-simulado':'/conferir-pagamento'),{});
    if(r.pagStatus==='pendente') toast('O pagamento ainda não foi confirmado');
  }catch(err){toast(err.erro)}
  b.disabled=false; tickTrack();
});
let trackT=0, buscando=false;
async function tickTrack(){
  clearTimeout(trackT); if(!pedido||buscando) return;
  buscando=true; let novo=null;
  try{novo=await api('pedidos/'+pedido.token)}catch(e){if(e.status===404){pedido=null;info=null;store.set('pedido',null);buscando=false;if(openEl===SH.acompanhar)renderTrack();sync();return}}
  buscando=false; if(!pedido) return;
  if(novo){
    const mudou=!info||info.status!==novo.status||info.pagStatus!==novo.pagStatus, antes=info; info=novo;
    if(mudou){
      if(openEl===SH.acompanhar){const y=$('#trk-scroll').scrollTop;renderTrack();$('#trk-scroll').scrollTop=y}
      else if(antes) toast('Pedido nº '+pedido.n+': '+tituloStatus().toLowerCase());
      if(antes&&navigator.vibrate){try{navigator.vibrate(20)}catch(e){}}
      sync();
    }
  }
  if(info&&FINAIS[info.status]){if(Date.now()-info.atualizado*1000>2*3600e3&&openEl!==SH.acompanhar){arquivar();pedido=null;info=null;store.set('pedido',null);sync()}return}
  trackT=setTimeout(tickTrack,document.hidden?20000:4000);
}

/* ── loja ── */
function renderLoja(){
  const s=status(), hoje=agora().d, P=L.pagamento, E=L.endereco;
  const raios=L.entrega.raios.filter((r,i,a)=>!i||r[1]!==a[i-1][1]).map(r=>'até '+String(r[0]).replace('.',',')+' km, '+fmt(r[1])).join('; ');
  $('#loja-scroll').innerHTML='<div class="shead"><div><p class="eyebrow">'+esc(E.cidade)+' · '+esc(E.uf)+'</p><h3>A loja</h3></div><p class="shead__jp" aria-hidden="true">店舗</p></div><div class="info">'+
    '<span class="chip ink '+(s.aberta?'open':'')+'">'+esc(s.longo)+'</span>'+
    (L.sobre?'<div class="box"><h5>Sobre</h5><p>'+esc(L.sobre)+'</p></div>':'')+
    '<div class="box"><h5>Endereço</h5><p>'+esc(E.rua)+'<br>'+esc(E.bairro)+' · '+esc(E.cidade)+', '+esc(E.uf)+(E.complemento?'<br>'+esc(E.complemento):'')+'</p><a class="lnk" href="'+esc(mapa)+'" target="_blank" rel="noopener">Abrir no mapa</a></div>'+
    '<div class="box"><h5>Horários</h5><ul class="hours">'+[1,2,3,4,5,6,0].map(d=>'<li class="'+(d===hoje?'today ':'')+(AGENDA[d]?'':'off')+'"><span>'+sent(DIASL[d])+(d===hoje?' · hoje':'')+'</span><span>'+(AGENDA[d]?AGENDA[d][0]+' às '+AGENDA[d][1]:'Fechada')+'</span></li>').join('')+'</ul></div>'+
    (L.entrega.ativa?'<div class="box"><h5>Entrega</h5><p>'+tempoEntrega+(L.entrega.bairros.length?' · a partir de '+fmt(taxaMin):'')+'</p>'+
      (L.entrega.pedidoMinimo>0||L.entrega.gratisAcima>0?'<p class="note" style="margin-top:6px">'+[L.entrega.pedidoMinimo>0?'Pedido mínimo de '+fmt(L.entrega.pedidoMinimo):'',L.entrega.gratisAcima>0?'Entrega grátis a partir de '+fmt(L.entrega.gratisAcima):''].filter(Boolean).join('. ')+'.</p>':'')+
      (raios?'<p class="note" style="margin-top:6px">Fora dos bairros abaixo, combine a entrega com a loja. Referência por distância: '+raios+'.</p>':'')+
      '<ul class="pills">'+L.entrega.bairros.map(b=>'<li>'+esc(b[0])+' · '+fmt(b[1])+'</li>').join('')+'</ul></div>':'')+
    (L.retirada.ativa?'<div class="box"><h5>Retirada</h5><p>No balcão, em cerca de '+L.retirada.minutos+' min.'+(L.retirada.descontoPct>0?' '+L.retirada.descontoPct+'% de desconto.':'')+'</p></div>':'')+
    '<div class="box"><h5>Pagamento</h5><ul class="pills">'+(P.online?'<li>Online: Pix e cartão</li>':'')+(P.dinheiro?'<li>Dinheiro</li>':'')+(P.debito.length?'<li>Débito: '+esc(P.debito.join(', '))+'</li>':'')+(P.credito.length?'<li>Crédito: '+esc(P.credito.join(', '))+'</li>':'')+'</ul></div>'+
    '<div class="box"><h5>Contato</h5><p>'+esc(fone)+'</p>'+(L.whatsapp?'<a class="lnk" href="'+esc(zap)+'" target="_blank" rel="noopener">Chamar no WhatsApp</a>':'')+'</div></div>';
}

/* ── conta (demonstração) ── */
function seedHist(){
  if(hist.length) return;
  const mk=(dias,names)=>{const its=names.map(r=>findItem(r)).filter(Boolean);if(!its.length)return;const tot=its.reduce((a,i)=>a+i.preco,0)+7;
    hist.push({n:String(1000+Math.floor(Math.random()*9000)),t0:Date.now()-dias*864e5,total:tot,modo:'entrega',exemplo:true,itens:its.map(i=>({id:i.id,q:1,op:i.op.map(gi=>OG[gi].acomp?[OG[gi].itens.findIndex(o=>o.todos)]:[]).map(a=>a.filter(x=>x>=0)),obs:'',nome:i.nome}))})};
  mk(6,[/^combo taika 1/i,/^coca-cola$/i]); mk(19,[/^uramaki filad/i,/^temaki salmão especial/i,/^guioza/i]); store.set('hist',hist);
}
function renderConta(){
  const sc=$('#conta-scroll');
  if(!conta){sc.innerHTML='<div class="acc"><div class="logo logo--ink acc__logo"><img src="'+logoSrc+'" data-logo alt="Taika Sushi"></div>'+
    '<p class="acc__lead">Entre e peça com mais agilidade.</p><button type="button" class="btn btn--fire btn--wide" id="login">Entrar com a conta demo</button>'+
    '<p class="demo" style="margin:18px 0 0"><b>Demo</b><span>Aqui nenhum dado é pedido: a conta demo só preenche nome, telefone e endereço de exemplo neste aparelho e traz pedidos de exemplo.</span></p></div>';return}
  const quando=t=>{const d=Math.round((Date.now()-t)/864e5);return d<=0?'hoje, '+hora(t):d===1?'ontem':'há '+d+' dias'};
  sc.innerHTML='<div class="shead"><div><p class="eyebrow">Conta demo</p><h3>Sua conta</h3></div><p class="shead__jp" aria-hidden="true">会員</p></div><div class="acc">'+
    '<div class="who"><span aria-hidden="true">CD</span><div><b>'+esc(conta.nome)+'</b><small>'+esc(conta.fone)+'</small></div></div>'+
    '<div class="box"><h5>Endereço salvo</h5><p>'+esc(conta.end)+'<br>'+esc(conta.bairro)+' · '+esc(L.endereco.cidade)+', '+esc(L.endereco.uf)+'</p></div>'+
    '<div class="box"><h5>Meus pedidos</h5>'+
      (pedido?'<div class="ord"><b>#'+pedido.n+' · '+tituloStatus()+'</b>'+(info?priceHTML(info.total/100):'')+'<small>'+(pedido.itens||[]).map(i=>i.q+'× '+esc(i.nome)).join(', ')+'</small><button type="button" data-sheet="acompanhar">Acompanhar</button></div>':'')+
      (hist.length?hist.map((h,i)=>'<div class="ord"><b>#'+esc(h.n)+' · '+quando(h.t0)+'</b>'+priceHTML(h.total)+'<small>'+h.itens.map(x=>x.q+'× '+esc(x.nome)).join(', ')+(h.exemplo?' · exemplo':'')+'</small><button type="button" data-again="'+i+'">Pedir de novo</button></div>').join(''):(pedido?'':'<p class="note">Você ainda não fez pedidos.</p>'))+'</div>'+
    '<div class="acts"><button type="button" class="btn btn--line btn--wide" id="logout">Sair da conta demo</button></div></div>';
}
$('#conta-scroll').addEventListener('click',e=>{
  if(e.target.closest('#login')){conta={nome:'Cliente Demo',fone:'(91) 90000-0000',end:'Rua de Exemplo, 100',bairro:(L.entrega.bairros.find(b=>b[0]===L.endereco.bairro)||L.entrega.bairros[0]||[''])[0]};store.set('conta',conta);seedHist();
    form.nome=form.nome||conta.nome;form.fone=form.fone||conta.fone;form.bairro=form.bairro||conta.bairro;form.end=form.end||conta.end;saveForm();renderConta();sync();toast('Você entrou na conta demo');return}
  if(e.target.closest('#logout')){conta=null;store.set('conta',null);renderConta();sync();return}
  const ag=e.target.closest('[data-again]');
  if(ag){const h=hist[+ag.dataset.again];let fora=0;h.itens.forEach(i=>{const l={id:i.id,q:i.q,op:i.op||[],obs:i.obs||''};if(linhaOk(l))cart.push(l);else fora++});
    const m={};cart=cart.filter(l=>{const k=lineKey(l);if(m[k]){m[k].q+=l.q;return false}m[k]=l;return true});save();openSheet('pedido');toast(fora?fora+(fora===1?' item não está':' itens não estão')+' mais disponível':'Itens do pedido nº '+h.n+' adicionados')}
});

/* ── busca ── */
const SUG=['Salmão','Camarão','Trufado','Temaki','Hot','Combo','Maçaricado','Sem arroz'];
function renderBusca(){
  const q=norm($('#q').value.trim()), rows=$('#find-rows'), n=$('#find-n');
  if(!$('#sugg').children.length) $('#sugg').innerHTML=SUG.map(s=>'<button type="button" data-sug="'+s+'">'+s+'</button>').join('');
  if(q.length<2){n.textContent='Digite ao menos 2 letras';rows.innerHTML='';rows.hidden=true;return}
  const terms=q.split(/\s+/), res=ALL.filter(i=>terms.every(t=>i.busca.indexOf(t)>=0));
  res.sort((a,b)=>(norm(b.nome).indexOf(terms[0])>=0)-(norm(a.nome).indexOf(terms[0])>=0));
  n.textContent=res.length?res.length+(res.length===1?' resultado':' resultados'):'Nada encontrado para “'+$('#q').value.trim()+'”';
  rows.hidden=!res.length; rows.innerHTML=res.slice(0,60).map(i=>rowHTML(i,terms[0],true)).join(''); sync();
}
$('#q').addEventListener('input',renderBusca);
$('#sugg').addEventListener('click',e=>{const b=e.target.closest('[data-sug]');if(b){$('#q').value=b.dataset.sug;renderBusca()}});

/* ── global clicks ── */
document.addEventListener('click',e=>{
  const t=e.target; let el;
  if((el=t.closest('[data-add]'))){changeSimple(el.dataset.add,1);return}
  if((el=t.closest('[data-sub]'))){changeSimple(el.dataset.sub,-1);return}
  if((el=t.closest('[data-line]'))){const l=cart[+el.dataset.line];if(l){l.q+= +el.dataset.d;if(l.q<=0)cart.splice(cart.indexOf(l),1);save();sync();if(+el.dataset.d>0)bump(l.id)}return}
  if(t.closest('.qty')) return;
  if((el=t.closest('[data-modo]'))){modo=el.dataset.modo;store.set('modo',modo);renderCart();return}
  if((el=t.closest('[data-pag]'))){form.pag=el.dataset.pag;const y=$('#cart-scroll').scrollTop;renderCart();$('#cart-scroll').scrollTop=y;return}
  if((el=t.closest('[data-nav]'))){const n=el.dataset.nav;
    if(n==='menu'){closeSheet();$('#menu').scrollIntoView();return}
    if(n==='pedido'){openSheet(!cart.length&&pedido?'acompanhar':'pedido');return}
    openSheet(n);return}
  if((el=t.closest('[data-sheet]'))){openSheet(el.dataset.sheet);return}
  if(t.closest('[data-close]')||t===scrim){closeSheet();return}
  if((el=t.closest('[data-open]'))){openDish(el.dataset.open);return}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet()});
$$('[data-grab]').forEach(g=>{
  const sheet=g.parentElement; let y0=null,dy=0;
  g.addEventListener('pointerdown',e=>{y0=e.clientY;dy=0;sheet.classList.add('drag');g.setPointerCapture(e.pointerId)});
  g.addEventListener('pointermove',e=>{if(y0===null)return;dy=Math.max(0,e.clientY-y0);sheet.style.transform='translateY('+dy+'px)'});
  const end=()=>{if(y0===null)return;y0=null;sheet.classList.remove('drag');sheet.style.transform='';if(dy>90)closeSheet()};
  g.addEventListener('pointerup',end);g.addEventListener('pointercancel',end);
});

/* ── scroll: reveals, bars, tabs, parallax ── */
const RM=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
if('IntersectionObserver' in window){
  const rv=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');rv.unobserve(e.target)}}),{rootMargin:'0px 0px -7% 0px',threshold:.08});
  $$('[data-rv]').forEach(el=>rv.observe(el));
  const spy=spyObs=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)setTab(e.target.id)}),{rootMargin:'-38% 0px -58% 0px'});
  $$('.sec').forEach(s=>spy.observe(s));
}else $$('[data-rv]').forEach(el=>el.classList.add('in'));

const tabsEl=$('#tabs'), ink=$('#tabs-ink');
function setTab(id){
  const t=$('[data-tab="'+id+'"]'); if(!t) return; curTab=id;
  $$('.tab').forEach(x=>x.classList.toggle('on',x===t));
  ink.style.width=(t.offsetWidth-22)+'px'; ink.style.transform='translateX('+(t.offsetLeft+11)+'px)';
  tabsEl.scrollTo({left:t.offsetLeft-60,behavior:RM?'auto':'smooth'});
}
if(document.fonts&&document.fonts.ready) document.fonts.ready.then(()=>{if(CATS[0])setTab(curTab||CATS[0].id)});
if(CATS[0]) setTab(CATS[0].id);

const hero=$('.hero'), hlogo=$('.hero__logo'), lock=$('.lockup'), topbar=$('#topbar'); let ticking=false;
function onScroll(){
  ticking=false;
  const y=window.scrollY, hh=hero.offsetHeight, vh=window.innerHeight, past=y>hh*.6;
  topbar.classList.toggle('show',past); document.body.classList.toggle('navon',past);
  if(!RM&&y<hh){const ty=(y*.24).toFixed(1)+'px';hlogo.style.translate='0 '+ty;lock.style.translate='0 '+ty}
  if(!inter){inter=$('#inter');interImg=inter&&$('img',inter)}
  if(!RM&&interImg){const r=inter.getBoundingClientRect();if(r.bottom>0&&r.top<vh)interImg.style.transform='translate3d(0,'+((r.top/vh)*-44).toFixed(1)+'px,0)'}
}
window.addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(onScroll)}},{passive:true});
onScroll();

const track=$('#sig-track'); let sticking=false;
function sigPar(){sticking=false;if(RM)return;const tr=track.getBoundingClientRect(),mid=tr.left+tr.width/2;
  $$('.sigc',track).forEach(c=>{const r=c.getBoundingClientRect(),off=(r.left+r.width/2-mid)/tr.width;$('img',c).style.transform='translate3d('+(off*-34).toFixed(1)+'px,0,0)'})}
track.addEventListener('scroll',()=>{if(!sticking){sticking=true;requestAnimationFrame(sigPar)}},{passive:true});
sigPar();

/* ── o fogo: um risco de fósforo, depois brasas ── */
const fire=(function(){
  const cv=$('.hero__embers'), ctx=cv.getContext('2d'), P=[]; let w=0,h=0,on=false,lit=false,st=null,last=0,raf=0;
  function size(){const d=Math.min(window.devicePixelRatio||1,2);w=cv.clientWidth;h=cv.clientHeight;cv.width=w*d;cv.height=h*d;ctx.setTransform(d,0,0,d,0,0)}
  function ember(x,y,burst){P.push({x:x,y:y,vx:(Math.random()-.5)*(burst?300:24),vy:burst?-(Math.random()*280+20):-(Math.random()*62+22),r:Math.random()*1.5+.5,t:0,max:burst?Math.random()*.9+.3:Math.random()*4.2+2.4,g:burst?380:0,sw:Math.random()*6.28,k:Math.random()})}
  function bez(k){const a=1-k;return[a*a*w*.04+2*a*k*w*.4+k*k*w*.7,a*a*h*.72+2*a*k*h*.49+k*k*h*.56]}
  function dot(x,y,r,a,col){ctx.globalAlpha=a;ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,r,0,6.2832);ctx.fill()}
  function frame(t){
    if(!on) return;
    const dt=Math.min((t-last)/1000,.05); last=t;
    ctx.globalCompositeOperation='source-over'; ctx.clearRect(0,0,w,h); ctx.globalCompositeOperation='lighter';
    if(st){const k=(t-st.t0)/st.dur;
      if(k>=0&&k<1.5){const e=k<1?1-Math.pow(1-k,2.2):1, fa=k<1?1:Math.max(0,1-(k-1)*2.4);
        for(let i=0;i<22;i++){const kk=e-i*.02;if(kk<0)break;const p=bez(kk),f=1-i/22;dot(p[0],p[1],3.4*f+.5,.5*f*fa,'#ffd9a0');dot(p[0],p[1],11*f,.09*f*fa,'#ff8a2a')}
        if(k<1){const hp=bez(e);dot(hp[0],hp[1],30,.16,'#ff9a3c');dot(hp[0],hp[1],5,1,'#fff3d6');for(let j=0;j<3;j++)ember(hp[0],hp[1],true)}
        else if(!st.done){st.done=true;lit=true;const bp=bez(1);for(let b=0;b<64;b++)ember(bp[0],bp[1],true)}
      }else if(k>=1.5) st=null}
    if(lit&&P.length<74&&Math.random()<.5) ember(Math.random()*w,h*(.6+Math.random()*.42),false);
    for(let n=P.length-1;n>=0;n--){const q=P[n]; q.t+=dt; if(q.t>q.max){P.splice(n,1);continue}
      q.vy+=q.g*dt; q.x+=(q.vx+Math.sin(q.t*2.2+q.sw)*16)*dt; q.y+=q.vy*dt;
      const life=q.t/q.max, a=Math.min(1,q.t*5)*(1-life)*(.55+.45*Math.sin(q.t*13+q.sw));
      dot(q.x,q.y,q.r*4.5,a*.13,'#ff7a1f'); dot(q.x,q.y,q.r,a,q.k>.6?'#ffe2b0':'#ffab4a')}
    ctx.globalAlpha=1; raf=requestAnimationFrame(frame);
  }
  function start(){if(on||RM)return;on=true;last=performance.now();raf=requestAnimationFrame(frame)}
  function stop(){on=false;cancelAnimationFrame(raf)}
  size(); window.addEventListener('resize',size);
  if('IntersectionObserver' in window) new IntersectionObserver(es=>{es[0].isIntersecting?start():stop()}).observe(hero);
  return{strike(){size();st={t0:performance.now()+250,dur:560,done:false};start()}};
})();

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ready=im=>im.complete?0:new Promise(r=>{im.addEventListener('load',r);im.addEventListener('error',r)});
const gate=[ready($('#hero-img')),ready($('img',hlogo))];
if(document.fonts&&document.fonts.load) gate.push(document.fonts.load("500 16px 'Shippori Mincho B1'",'Sushi 寿司'),document.fonts.load("400 15px 'Dela Gothic One'",'Ver'));
Promise.race([Promise.all(gate).catch(()=>{}),wait(1800)]).then(()=>{hero.classList.add('go');if(!RM)fire.strike()});

paintStatus(); setInterval(paintStatus,30000);
sync();
if(pedido){
  if(/[?&]pagamento=retorno/.test(location.search)){history.replaceState(null,'',location.pathname);try{await api('pedidos/'+pedido.token+'/conferir-pagamento',{})}catch(e){}openSheet('acompanhar')}
  else tickTrack();
}
})();
