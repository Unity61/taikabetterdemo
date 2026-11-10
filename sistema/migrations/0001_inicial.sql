-- Taika: esquema inicial. Valores em centavos, datas em segundos (epoch).
CREATE TABLE config (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado INTEGER NOT NULL
);

CREATE TABLE categorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  pos INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  excluido INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id),
  nome TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '',
  preco INTEGER NOT NULL CHECK (preco >= 0),
  foto TEXT,
  pausado INTEGER NOT NULL DEFAULT 0,
  pos INTEGER NOT NULL DEFAULT 0,
  excluido INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX itens_cat ON itens(categoria_id, pos);

CREATE TABLE grupos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  minimo INTEGER NOT NULL DEFAULT 0 CHECK (minimo >= 0),
  maximo INTEGER NOT NULL DEFAULT 1 CHECK (maximo >= 1),
  excluido INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE opcoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grupo_id INTEGER NOT NULL REFERENCES grupos(id),
  nome TEXT NOT NULL,
  preco INTEGER NOT NULL DEFAULT 0 CHECK (preco >= 0),
  pos INTEGER NOT NULL DEFAULT 0,
  pausado INTEGER NOT NULL DEFAULT 0,
  excluido INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX opcoes_grupo ON opcoes(grupo_id, pos);

CREATE TABLE item_grupos (
  item_id INTEGER NOT NULL REFERENCES itens(id),
  grupo_id INTEGER NOT NULL REFERENCES grupos(id),
  pos INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, grupo_id)
);

CREATE TABLE cupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tipo TEXT NOT NULL CHECK (tipo IN ('pct', 'valor')),
  valor INTEGER NOT NULL CHECK (valor > 0),
  minimo INTEGER NOT NULL DEFAULT 0,
  validade INTEGER,
  limite INTEGER,
  usos INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  ref TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('aguardando_pagamento','novo','aceito','em_preparo','saiu_entrega','pronto_retirada','concluido','recusado','cancelado')),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrega', 'retirada')),
  cliente_nome TEXT NOT NULL,
  cliente_tel TEXT NOT NULL,
  endereco TEXT NOT NULL DEFAULT '',
  bairro TEXT NOT NULL DEFAULT '',
  obs TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL,
  taxa INTEGER NOT NULL DEFAULT 0,
  desconto INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  cupom TEXT,
  pagamento TEXT NOT NULL CHECK (pagamento IN ('dinheiro', 'debito', 'credito', 'online')),
  troco INTEGER,
  pag_status TEXT NOT NULL DEFAULT 'na_entrega' CHECK (pag_status IN ('na_entrega', 'pendente', 'pago', 'simulado')),
  pag_id TEXT,
  pag_metodo TEXT,
  motivo TEXT,
  criado INTEGER NOT NULL,
  atualizado INTEGER NOT NULL
);
CREATE INDEX pedidos_status ON pedidos(status, criado);
CREATE INDEX pedidos_criado ON pedidos(criado);
CREATE INDEX pedidos_tel ON pedidos(cliente_tel);

CREATE TABLE pedido_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  item_id INTEGER NOT NULL,
  nome TEXT NOT NULL,
  preco_unit INTEGER NOT NULL,
  qtd INTEGER NOT NULL,
  opcoes TEXT NOT NULL DEFAULT '[]',
  obs TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL
);
CREATE INDEX pedido_itens_pedido ON pedido_itens(pedido_id);

CREATE TABLE pedido_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id),
  status TEXT NOT NULL,
  usuario TEXT,
  em INTEGER NOT NULL
);
CREATE INDEX pedido_eventos_pedido ON pedido_eventos(pedido_id);

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('dono', 'equipe')),
  ativo INTEGER NOT NULL DEFAULT 1,
  criado INTEGER NOT NULL
);

CREATE TABLE sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  csrf_hash TEXT NOT NULL,
  criado INTEGER NOT NULL,
  visto INTEGER NOT NULL
);
CREATE INDEX sessoes_usuario ON sessoes(usuario_id);

-- Contadores para limite de tentativas (chave já vem com hash, nunca IP ou usuário em claro).
CREATE TABLE limites (
  chave TEXT NOT NULL,
  em INTEGER NOT NULL
);
CREATE INDEX limites_chave ON limites(chave, em);

CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  usuario TEXT NOT NULL,
  acao TEXT NOT NULL,
  alvo TEXT NOT NULL DEFAULT '',
  detalhe TEXT NOT NULL DEFAULT '',
  em INTEGER NOT NULL
);
CREATE INDEX auditoria_em ON auditoria(em);

-- Notificações de pagamento já processadas (proteção contra repetição).
CREATE TABLE webhooks (
  chave TEXT PRIMARY KEY,
  em INTEGER NOT NULL
);
