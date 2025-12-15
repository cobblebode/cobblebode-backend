CREATE TABLE shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  description TEXT,
  price REAL,
  item_command TEXT,
  category TEXT,
  is_active INTEGER
);

CREATE TABLE vip_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  description TEXT,
  price REAL,
  duration_days INTEGER,
  features TEXT,
  is_active INTEGER
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player TEXT,
  product_type TEXT,
  product_id INTEGER,
  payment_id TEXT,
  status TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
