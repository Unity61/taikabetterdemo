// Importa taika/dados.js para o D1 local, envia as fotos para o R2 local e cria as contas de demonstração.
// Uso: node scripts/seed.mjs [--persist-to <dir>] [--cred <arquivo>] [--sem-fotos] [--remote]
// --remote grava no D1 e no R2 publicados na Cloudflare (apaga pedidos e alterações de lá).
// As senhas são geradas aqui e gravadas apenas no arquivo de credenciais (ignorado pelo git). Nada é impresso.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const persist = arg('--persist-to');
const credFile = path.resolve(arg('--cred') || path.join(raiz, '..', 'credenciais-demo.txt'));
const semFotos = process.argv.includes('--sem-fotos');
const remoto = process.argv.includes('--remote');
const alvo = remoto ? '--remote' : '--local';
const ITER = 600000;

const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(raiz, '..', 'taika', 'dados.js'), 'utf8'), ctx);
const D = ctx.window.TAIKA_DADOS;

const MIN = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, com: 1, na: 1, no: 1, em: 1, ao: 1, ou: 1, por: 1 };
const tc = (s) => s.toLowerCase().replace(/(^|[\s(\-\/])([^\s(\-\/]+)/g, (m, pre, w, off) => { if (off > 0 && MIN[w]) return pre + w; if (w === 'h2o') return pre + 'H2O'; return pre + w.charAt(0).toUpperCase() + w.slice(1); });
const sent = (s) => { s = s.toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const cent = (r) => Math.round(r * 100);
const agora = Math.floor(Date.now() / 1000);

function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.pbkdf2Sync(senha, sal, ITER, 32, 'sha256');
  return 'pbkdf2-sha256$' + ITER + '$' + sal.toString('base64') + '$' + h.toString('base64');
}
function credenciais() {
  const c = {};
  if (fs.existsSync(credFile)) for (const l of fs.readFileSync(credFile, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) c[m[1]] = m[2]; }
  const nova = () => crypto.randomBytes(15).toString('base64url');
  c.DONO_USUARIO ||= 'dono'; c.DONO_SENHA ||= nova();
  c.EQUIPE_USUARIO ||= 'equipe'; c.EQUIPE_SENHA ||= nova();
  fs.mkdirSync(path.dirname(credFile), { recursive: true });
  fs.writeFileSync(credFile, '# Contas de demonstração do painel Taika. Arquivo local, ignorado pelo git.\n# dono: acesso total. equipe: pedidos e pausar itens.\n' +
    ['DONO_USUARIO', 'DONO_SENHA', 'EQUIPE_USUARIO', 'EQUIPE_SENHA'].map((k) => k + '=' + c[k]).join('\n') + '\n');
  return c;
}

const sql = [];
for (const t of ['pedido_eventos', 'pedido_itens', 'pedidos', 'item_grupos', 'opcoes', 'grupos', 'itens', 'categorias', 'cupons', 'sessoes', 'usuarios', 'limites', 'auditoria', 'webhooks', 'config'])
  sql.push('DELETE FROM ' + t + ';');
sql.push("DELETE FROM sqlite_sequence;");

D.opcoes.forEach((g, gi) => {
  sql.push(`INSERT INTO grupos (id,nome,minimo,maximo) VALUES (${gi + 1},${q(g.nome)},${g.min},${g.max});`);
  g.itens.forEach((o, oi) => {
    const nome = sent(o[0].replace(/^ADD\s+/i, '').replace(/^ADICIONAL DE\s+/i, ''));
    sql.push(`INSERT INTO opcoes (grupo_id,nome,preco,pos) VALUES (${gi + 1},${q(nome)},${cent(o[1])},${oi});`);
  });
});
const fotos = [];
D.grupos.forEach((c, ci) => {
  sql.push(`INSERT INTO categorias (id,nome,pos) VALUES (${ci + 1},${q(tc(c.nome))},${ci});`);
  c.itens.forEach((it, ii) => {
    let foto = null;
    if (it.foto) { const id = it.foto.split('/')[0]; foto = 'seed/' + id + '.jpg'; fotos.push([foto, path.join(raiz, '..', 'taika', 'fotos', id + '.jpg')]); }
    sql.push(`INSERT INTO itens (id,categoria_id,nome,descricao,preco,foto,pos) VALUES (${it.id},${ci + 1},${q(tc(it.nome))},${q(it.desc)},${cent(it.preco)},${q(foto)},${ii});`);
    (it.op || []).forEach((gi, k) => sql.push(`INSERT INTO item_grupos (item_id,grupo_id,pos) VALUES (${it.id},${gi + 1},${k});`));
  });
});

const L = D.loja, DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const horarios = DIAS.map((_, dia) => ({ dia, ativo: false, abre: '18:30', fecha: '23:00' }));
for (const h of L.horarios) { const a = DIAS.indexOf(h.from), b = DIAS.indexOf(h.to); if (a < 0 || b < 0) continue; for (let d = a; ; d = (d + 1) % 7) { horarios[d] = { dia: d, ativo: true, abre: h.open, fecha: h.close }; if (d === b) break; } }
const config = {
  loja: { nome: L.nome, boasVindas: L.boasVindas, sobre: '', telefone: L.telefone, whatsapp: !!L.whatsapp, fuso: L.fuso,
    endereco: { rua: L.endereco.rua, bairro: L.endereco.bairro, cidade: L.endereco.cidade, uf: L.endereco.uf, complemento: tc(L.endereco.complemento || ''), lat: L.endereco.lat, lng: L.endereco.lng } },
  horarios,
  status: { modo: 'auto' },
  entrega: { ativa: !!L.entrega.ativa, bairros: L.entrega.bairros.map((b) => [b[0], cent(b[1])]), raios: L.entrega.raios.map((r) => [r[0], cent(r[1])]),
    tempoMin: L.entrega.raios[0]?.[2] ?? 60, tempoMax: L.entrega.raios[0]?.[3] ?? 100, pedidoMinimo: 0, gratisAcima: 0 },
  retirada: { ativa: !!L.retirada.ativa, minutos: L.retirada.minutos, descontoPct: 0 },
  pagamento: { dinheiro: !!L.pagamento.dinheiro, debito: L.pagamento.debito, credito: L.pagamento.credito, online: !!L.pagamento.pix }
};
for (const [k, v] of Object.entries(config)) sql.push(`INSERT INTO config (chave,valor,atualizado) VALUES (${q(k)},${q(JSON.stringify(v))},${agora});`);

const cred = credenciais();
sql.push(`INSERT INTO usuarios (usuario,nome,senha_hash,papel,criado) VALUES (${q(cred.DONO_USUARIO)},'Dono (demo)',${q(hashSenha(cred.DONO_SENHA))},'dono',${agora});`);
sql.push(`INSERT INTO usuarios (usuario,nome,senha_hash,papel,criado) VALUES (${q(cred.EQUIPE_USUARIO)},'Equipe (demo)',${q(hashSenha(cred.EQUIPE_SENHA))},'equipe',${agora});`);
sql.push(`INSERT INTO cupons (codigo,tipo,valor,minimo) VALUES ('TAIKA10','pct',10,5000);`);

const arquivo = path.join(raiz, 'seed.local.sql');
fs.writeFileSync(arquivo, sql.join('\n') + '\n');
const wr = path.join(raiz, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const extra = persist && !remoto ? ['--persist-to', persist] : [];
const run = (args) => execFileSync(process.execPath, [wr, ...args, ...extra], { cwd: raiz, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  run(['d1', 'migrations', 'apply', 'taika', alvo]);
  run(['d1', 'execute', 'taika', alvo, '--file', arquivo, '--yes']);
  if (!semFotos) for (const [chave, origem] of fotos) run(['r2', 'object', 'put', 'taika-fotos/' + chave, '--file', origem, '--content-type', 'image/jpeg', alvo]);
} catch (e) {
  console.error('Falha no seed:', String(e.stderr || e.message).slice(-1500)); process.exit(1);
} finally { fs.rmSync(arquivo, { force: true }); }
const itens = D.grupos.reduce((a, c) => a + c.itens.length, 0);
console.log(`Seed concluído: ${D.grupos.length} categorias, ${itens} itens, ${D.opcoes.length} grupos de opcionais, ${semFotos ? 0 : fotos.length} fotos, 2 contas.`);
console.log('Credenciais de demonstração em: ' + path.basename(credFile));
