CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  reference VARCHAR(50) NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  description TEXT NOT NULL DEFAULT '',
  -- "viaje": stock que lleva el vendedor (se descuenta al vender, puede quedar negativo)
  stock INTEGER NOT NULL DEFAULT 0,
  -- "casa": stock de reposición en depósito
  stock_casa INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_wholesale NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_retail NUMERIC(12, 2) NOT NULL DEFAULT 0,
  price_ml NUMERIC(12, 2) NOT NULL DEFAULT 0,
  image_path VARCHAR(255),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_active ON products(active);

CREATE TYPE order_status AS ENUM ('pending', 'delivered', 'cancelled');

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_name VARCHAR(200) NOT NULL,
  status order_status NOT NULL DEFAULT 'pending',
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_type VARCHAR(10),
  discount_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  stock_applied BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_reference VARCHAR(50) NOT NULL,
  product_description TEXT NOT NULL,
  -- Mantener el límite sincronizado con MAX_PER_ITEM en backend/src/seed.js
  -- (la migración en backend/src/index.js re-crea este CHECK en cada arranque).
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000),
  unit_price NUMERIC(12, 2) NOT NULL,
  line_total NUMERIC(12, 2) NOT NULL
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
