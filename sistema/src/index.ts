import { Env, Erro, json } from './util';
import { login, logout, eu } from './auth';
import { admin } from './admin';
import { cardapioPublico, foto, cotar, criarPedido, verPedido } from './publico';
import { webhook, conferirPagamento, pagamentoSimulado, pixDoPedido, qrDoPedido } from './pagamento';

const COMUNS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};
const CSP_API = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
// Painel: nada inline, nada de fora além do desafio anti-robô da Cloudflare na tela de login.
const CSP_PAINEL = "default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
// Site: scripts só do próprio domínio. Estilos inline são permitidos porque as animações do site usam atributos style.
const CSP_SITE = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com data:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

function comCabecalhos(r: Response, extra: Record<string, string>): Response {
  const h = new Headers(r.headers);
  for (const [k, v] of Object.entries({ ...COMUNS, ...extra })) if (!h.has(k) || k !== 'content-security-policy') h.set(k, v);
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}

async function api(req: Request, env: Env, caminho: string): Promise<Response> {
  const p = caminho.split('/').filter(Boolean), m = req.method, n = p.length;
  if (p[0] === 'admin') {
    if (n === 2 && p[1] === 'login' && m === 'POST') return login(req, env);
    if (n === 2 && p[1] === 'logout' && m === 'POST') return logout(req, env);
    if (n === 2 && p[1] === 'eu' && m === 'GET') return eu(req, env);
    return admin(req, env, p.slice(1));
  }
  if (n === 1 && p[0] === 'cardapio' && m === 'GET') return cardapioPublico(env);
  if (p[0] === 'fotos' && m === 'GET') return foto(env, p.slice(1).join('/'));
  if (n === 1 && p[0] === 'cotacao' && m === 'POST') return cotar(req, env);
  if (p[0] === 'pedidos') {
    if (n === 1 && m === 'POST') return criarPedido(req, env);
    if (n === 2 && m === 'GET') return verPedido(env, p[1]);
    if (n === 3 && m === 'POST' && p[2] === 'conferir-pagamento') return conferirPagamento(env, p[1]);
    if (n === 3 && m === 'POST' && p[2] === 'pagamento-simulado') return pagamentoSimulado(env, p[1]);
    if (n === 3 && m === 'POST' && p[2] === 'pix') return pixDoPedido(env, p[1]);
    if (n === 3 && m === 'GET' && p[2] === 'pix-qr') return qrDoPedido(env, p[1]);
  }
  if (n === 2 && p[0] === 'pagamentos' && p[1] === 'webhook' && m === 'POST') return webhook(req, env);
  if (n === 2 && p[0] === 'painel' && p[1] === 'chave' && m === 'GET') return json({ turnstile: env.TURNSTILE_SITEKEY || '' });
  throw new Erro(404, 'Não encontrado.');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      let r: Response;
      try { r = await api(req, env, url.pathname.slice(4)); }
      catch (e) {
        if (e instanceof Erro) r = json({ erro: e.mensagem, ...(e.extra || {}) }, e.status);
        else { console.error('erro interno em', req.method, url.pathname.replace(/[A-Za-z0-9_-]{20,}/g, '…'), e instanceof Error ? e.name + ': ' + e.message : ''); r = json({ erro: 'Erro interno. Tente de novo.' }, 500); }
      }
      return comCabecalhos(r, { 'content-security-policy': r.headers.get('content-security-policy') || CSP_API, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return comCabecalhos(new Response('Método não permitido', { status: 405 }), { 'content-security-policy': CSP_API });
    const r = await env.ASSETS.fetch(req);
    if (url.pathname === '/painel' || url.pathname.startsWith('/painel/'))
      return comCabecalhos(r, { 'content-security-policy': CSP_PAINEL, 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow, noarchive', 'cache-control': 'no-store' });
    return comCabecalhos(r, { 'content-security-policy': CSP_SITE, 'referrer-policy': 'strict-origin-when-cross-origin', 'cache-control': 'no-cache' });
  }
};
