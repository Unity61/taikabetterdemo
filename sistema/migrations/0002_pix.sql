-- Pix pelo Mercado Pago (API de Orders): a cobrança é criada uma vez por pedido e mostrada no próprio site.
ALTER TABLE pedidos ADD COLUMN pix_ordem TEXT;
ALTER TABLE pedidos ADD COLUMN pix_codigo TEXT;
ALTER TABLE pedidos ADD COLUMN pix_qr TEXT;
ALTER TABLE pedidos ADD COLUMN pix_expira INTEGER;
