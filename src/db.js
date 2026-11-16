import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Dinero en céntimos (enteros) y cantidades en milésimas (qty_milli) para evitar
// errores de coma flotante. UNIDAD: 2 u = 2000. PESO: 0.750 kg = 750. LIBRE: 1000.
export function openDb(file = 'data/pos.db') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS categories (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      barcode     TEXT UNIQUE,
      sale_mode   TEXT NOT NULL CHECK (sale_mode IN ('UNIT','WEIGHT','FREE')),
      price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id          INTEGER PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id),
      price_cents INTEGER NOT NULL,
      changed_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS sales (
      id          INTEGER PRIMARY KEY,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      sale_date   TEXT NOT NULL DEFAULT (date('now','localtime')),
      total_cents INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','VOIDED')),
      voided_at   TEXT
    );
    -- Copia del precio y nombre al momento de vender (RN-07, RN-08, RN-12)
    CREATE TABLE IF NOT EXISTS sale_items (
      id                INTEGER PRIMARY KEY,
      sale_id           INTEGER NOT NULL REFERENCES sales(id),
      product_id        INTEGER NOT NULL REFERENCES products(id),
      product_name      TEXT NOT NULL,
      sale_mode         TEXT NOT NULL,
      unit_price_cents  INTEGER NOT NULL,
      qty_milli         INTEGER NOT NULL,
      subtotal_cents    INTEGER NOT NULL
    );
    -- Muchos pagos por venta: hoy la UI usa uno, el modelo ya admite pagos combinados (RF-31)
    CREATE TABLE IF NOT EXISTS payments (
      id           INTEGER PRIMARY KEY,
      sale_id      INTEGER NOT NULL REFERENCES sales(id),
      method       TEXT NOT NULL CHECK (method IN ('CASH','YAPE','PLIN')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)
    );
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_items_sale ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_pay_sale ON payments(sale_id);
  `);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function seed(db) {
  if (db.prepare('SELECT COUNT(*) n FROM products').get().n > 0) return;
  const cat = db.prepare('INSERT INTO categories(name) VALUES (?)');
  const ids = {};
  for (const c of ['Limpieza', 'Bebidas', 'Abarrotes', 'Verduras', 'Carnes', 'Hierbas'])
    ids[c] = Number(cat.run(c).lastInsertRowid);
  const prod = db.prepare('INSERT INTO products(name,category_id,barcode,sale_mode,price_cents) VALUES (?,?,?,?,?)');
  const hist = db.prepare('INSERT INTO price_history(product_id,price_cents) VALUES (?,?)');
  const rows = [
    ['Detergente Bolívar 500 g', 'Limpieza', '7750000000012', 'UNIT', 550],
    ['Gaseosa Inca Kola 500 ml', 'Bebidas', '7750000000029', 'UNIT', 250],
    ['Arroz Costeño 1 kg', 'Abarrotes', '7750000000036', 'UNIT', 520],
    ['Aceite Primor 1 L', 'Abarrotes', '7750000000043', 'UNIT', 1050],
    ['Tomate', 'Verduras', null, 'WEIGHT', 350],
    ['Cebolla roja', 'Verduras', null, 'WEIGHT', 280],
    ['Pollo entero', 'Carnes', null, 'WEIGHT', 1000],
    ['Culantro', 'Hierbas', null, 'FREE', null],
    ['Hierbabuena', 'Hierbas', null, 'FREE', null],
  ];
  for (const [n, c, b, m, p] of rows) {
    const id = Number(prod.run(n, ids[c], b, m, p).lastInsertRowid);
    if (p != null) hist.run(id, p);
  }
}
