# Taika: site de pedidos + painel da loja (demonstração)

Site de pedidos do Taika Sushi e um painel interno para a loja receber pedidos e cuidar do cardápio. Tudo roda em um único Cloudflare Worker, com D1 (banco) e R2 (fotos). Os pedidos e o painel são de demonstração; a segurança é de verdade.

## Pastas

| Pasta | O que é |
|---|---|
| `sistema/` | Worker (API em TypeScript), site do cliente e painel |
| `sistema/public/` | Site do cliente, servido em `/` |
| `sistema/public/painel/` | Painel da loja, servido em `/painel/` (sem links no site, `noindex`) |
| `taika/` | Versão estática anterior do site, usada como origem do seed (`dados.js`, fotos) |
| `taika-v1-conceito/` | Primeiro conceito visual |

## Rodar localmente

Precisa de Node 22 ou mais novo.

```bash
cd sistema
npm install
npm run seed
npm run dev
```

- Site: http://localhost:8787/
- Painel: http://localhost:8787/painel/

`npm run seed` cria o banco local, importa o cardápio de `taika/dados.js`, envia as 20 fotos para o R2 local e cria duas contas. Rodar de novo **apaga pedidos e alterações** e volta ao estado inicial (as senhas são mantidas).

## Contas de demonstração

As senhas são geradas no seed e ficam só em `credenciais-demo.txt`, na raiz do projeto (ignorado pelo git). São duas contas: `dono` (tudo) e `equipe` (pedidos e pausar itens). Não existe tela de cadastro; novas contas são criadas pelo dono em **Equipe**.

## Segredos (`sistema/.dev.vars`, ignorado pelo git)

| Variável | Para quê |
|---|---|
| `TURNSTILE_SECRET` | Já vem com a chave de **teste** pública da Cloudflare (sempre aprova) |
| `MP_ACCESS_TOKEN` | Credencial de **teste** do Mercado Pago: prefixo `TEST-`, ou `APP_USR-` de uma conta de teste (o servidor confirma em `/users/me` que a conta tem a tag `test_user`). Qualquer outra é recusada |
| `MP_WEBHOOK_SECRET` | Assinatura secreta dos webhooks do Mercado Pago |

Sem `MP_ACCESS_TOKEN`, o pagamento online vira um **pagamento simulado**, identificado assim para o cliente e no painel.

## Testes

```bash
cd sistema
npm test
```

Sobe um Worker separado (porta 8798, banco próprio em `.wrangler/teste`) com Turnstile e Mercado Pago trocados por um servidor falso local. São 21 testes: rotas do painel sem cookie e com cookie forjado, CSRF, equipe tentando ações de dono, total adulterado, webhook forjado e repetido, upload, bloqueio de login, expiração de sessão, cabeçalhos e o fluxo completo do pedido.

`node tests/api-painel.mjs <MÉTODO> <caminho> [json]` faz uma chamada à API do painel como dono (ou `--equipe`), lendo as credenciais do arquivo sem mostrá-las.

## O que funciona de ponta a ponta

- **Pedidos:** pedido feito no site aparece no painel em até 4 s, com som e alerta visual. Status: novo → aceito → em preparo → saiu para entrega / pronto para retirada → concluído, mais recusado e cancelado com motivo. A tela de acompanhamento do cliente lê o status real.
- **Cardápio:** criar, editar, excluir e reordenar categorias e itens; nome, descrição, preço e foto (upload para o R2); grupos de opcionais com mínimo, máximo e preço; pausar item ou opção ("esgotado"), que fica cinza no site em até 15 s.
- **Loja:** aberta/fechada (manual ou pelos horários), horários, dados e texto de boas-vindas, taxa por bairro, tempos, pedido mínimo, entrega grátis acima de um valor, desconto na retirada, formas de pagamento.
- **Início:** pedidos, faturamento e ticket médio do dia, últimos 7 dias, itens e opcionais mais vendidos.
- **Histórico** com filtros, **cupons**, **clientes** (a partir dos pedidos), **equipe**, **auditoria**, **impressão** do pedido pelo navegador, **transações** online.

Inspirado na organização do painel da Goomer (início, operação, cardápio, loja, pagamentos, delivery, marketing, recursos), sem usar nome, marca ou visual dela.

## Apenas visual

Dependem de serviços que não temos: mensagem automática no WhatsApp, impressão automática e estações de preparo, integração com PDV, entregadores sob demanda, Pixel e Analytics, e-mail marketing, gerador de artes, domínio próprio, fidelidade, plano e fatura. Ficam na tela **Recursos**, marcados como "Apenas visual".

## Limites conhecidos

- **Taxa por distância** é só informativa. O pedido usa a taxa por bairro, porque calcular distância exige um serviço de mapas.
- **Mercado Pago em localhost:** o Mercado Pago não envia webhook para `localhost`. Localmente o pagamento é confirmado quando o cliente volta ao site e o servidor consulta a API. O webhook assinado só é exercitado pelos testes automáticos (com o servidor falso) ou em um endereço público.
- **Credenciais `APP_USR-`:** só são aceitas se a API do Mercado Pago confirmar que a conta é de teste (tag `test_user`). Se a consulta falhar, o pagamento online fica bloqueado; nunca cai para produção.

## Teste do gateway Mercado Pago (endereço público)

O webhook só chega a um endereço HTTPS público. Passos:

1. Publicar o Worker (Cloudflare Workers, plano grátis):
   ```bash
   cd sistema
   npx wrangler login
   npx wrangler d1 create taika        # copie o database_id para wrangler.jsonc
   npx wrangler r2 bucket create taika-fotos
   npx wrangler d1 migrations apply taika --remote
   npm run seed:remoto                 # cardápio, fotos e contas de demonstração no D1/R2 publicados
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put MP_ACCESS_TOKEN
   npx wrangler deploy
   ```
2. No painel do Mercado Pago (Suas integrações → aplicação → **Webhooks** → modo de teste): URL `https://<seu-endereço>/api/pagamentos/webhook`, evento **Pagamentos**. Salvar e copiar a **assinatura secreta**.
3. `npx wrangler secret put MP_WEBHOOK_SECRET` com essa assinatura.
4. Fazer um pedido com pagamento online e pagar no checkout com o **comprador de teste** (Contas de teste no painel) e um cartão de teste do Mercado Pago. O pedido deve virar "pago" no painel sem o cliente voltar ao site.
5. O botão **Simular** do painel de Webhooks também serve para conferir a assinatura: o servidor responde 200 (ou 409 se repetido) com assinatura válida e 401 com assinatura errada.

## Segurança, em resumo

- Visitante só lê cardápio e status, faz pedido e vê o próprio pedido por um token de 192 bits. Todo o resto exige sessão conferida no servidor.
- Senhas com PBKDF2-SHA256, 100.000 iterações (o máximo que os Workers publicados aceitam). Bloqueio após 5 falhas em 15 min, Turnstile no login, mesma mensagem para usuário ou senha errados.
- Sessão: token aleatório guardado só como hash; cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Strict`; expira com 30 min sem uso ou 12 h; logout apaga a sessão. CSRF por token + conferência de origem.
- O servidor recalcula todo pedido com os preços do banco. SQL sempre com parâmetros. O painel monta a tela só com `textContent`. CSP estrita no painel (nada inline).
- Uploads conferidos pelo conteúdo (JPG, PNG, WebP, até 2 MB). Auditoria de toda ação do painel. Nada de senha, token ou dado de cliente em log.

## Antes de publicar de verdade

1. **Hash de senha:** os Workers publicados limitam o PBKDF2 a 100.000 iterações (600.000 dava erro 500 no login). Para mais força, trocar por um hash que não dependa desse limite.
2. **LGPD:** aviso de privacidade no site, base legal, prazo de retenção de pedidos e de dados de clientes, canal para pedidos de exclusão.
3. **2FA** para contas de dono.
4. **Backups** do D1 e do R2, com teste de restauração.
5. **Mercado Pago real:** credenciais de produção, webhook em endereço público, revisar a regra do prefixo `TEST-`.
6. **Domínio próprio**, chaves reais do Turnstile, painel em subdomínio separado.
7. Criar o banco D1 e o bucket R2 reais e trocar o `database_id` em `wrangler.jsonc`.
8. Limite de requisições na borda (regras da Cloudflare) além do limite que já existe no banco.
