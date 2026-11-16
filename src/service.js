import { tx } from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

export const MODES = ['UNIT', 'WEIGHT', 'FREE'];
export const METHODS = ['CASH', 'YAPE', 'PLIN'];

export const toCents = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad('Importe inválido');
  return Math.round(n * 100);
};
const money = (c) => (c == null ? null : c / 100);

const productOut = (p) => p && ({
  id: p.id, name: p.name, category_id: p.category_id, category: p.category,
  barcode: p.barcode, sale_mode: p.sale_mode, price: money(p.price_cents),
  active: !!p.active,
});

const PRODUCT_SQL = `SELECT p.*, c.name AS category FROM products p
  LEFT JOIN categories c ON c.id = p.category_id`;

export function createService(db) {
  const q = (sql) => db.prepare(sql);

  // ---------- Categorías ----------
  const listCategories = () => q('SELECT * FROM categories ORDER BY name').all();
  function createCategory(name) {
    name = String(name ?? '').trim();
    if (!name) throw bad('La categoría necesita un nombre');
    const ex = q('SELECT * FROM categories WHERE lower(name)=lower(?)').get(name);
    if (ex) return ex;
    const id = Number(q('INSERT INTO categories(name) VALUES (?)').run(name).lastInsertRowid);
    return { id, name };
  }

  // ---------- Productos ----------
  function listProducts({ search = '', all = false } = {}) {
    const like = `%${String(search).trim()}%`;
    const rows = q(`${PRODUCT_SQL} WHERE p.name LIKE ? ${all ? '' : 'AND p.active = 1'}
      ORDER BY p.active DESC, p.name COLLATE NOCASE`).all(like);
    return rows.map(productOut);
  }
  const getProduct = (id) => {
    const p = q(`${PRODUCT_SQL} WHERE p.id = ?`).get(id);
    if (!p) throw new HttpError(404, 'Producto no encontrado');
    return p;
  };
  const productByBarcode = (code) => {
    const p = q(`${PRODUCT_SQL} WHERE p.barcode = ?`).get(String(code).trim());
    if (!p) throw new HttpError(404, 'Código de barras no registrado');
    return productOut(p);
  };

  function validateProduct(d) {
    const name = String(d.name ?? '').trim();
    if (!name) throw bad('El producto necesita un nombre');
    if (!MODES.includes(d.sale_mode)) throw bad('Modalidad de venta inválida (RN-01)');
    const barcode = d.barcode ? String(d.barcode).trim() : null;
    let price_cents = null;
    if (d.sale_mode !== 'FREE') {
      if (d.price === '' || d.price == null) throw bad(d.sale_mode === 'UNIT'
        ? 'El producto por unidad necesita un precio vigente (RN-02)'
        : 'El producto por peso necesita un precio por kg vigente (RN-03)');
      price_cents = toCents(d.price);
      if (price_cents <= 0) throw bad('El precio debe ser mayor que cero');
    }
    const category_id = d.category_id ? Number(d.category_id) : null;
    return { name, barcode, price_cents, category_id, sale_mode: d.sale_mode };
  }
  const uniqueBarcode = (e) => {
    if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'Ese código de barras ya está registrado');
    throw e;
  };

  function createProduct(d) {
    const v = validateProduct(d);
    try {
      return tx(db, () => {
        const id = Number(q(`INSERT INTO products(name,category_id,barcode,sale_mode,price_cents)
          VALUES (?,?,?,?,?)`).run(v.name, v.category_id, v.barcode, v.sale_mode, v.price_cents).lastInsertRowid);
        if (v.price_cents != null) q('INSERT INTO price_history(product_id,price_cents) VALUES (?,?)').run(id, v.price_cents);
        return productOut(getProduct(id));
      });
    } catch (e) { uniqueBarcode(e); }
  }

  function updateProduct(id, d) {
    const cur = getProduct(id);
    const v = validateProduct({ ...d, sale_mode: d.sale_mode ?? cur.sale_mode });
    try {
      return tx(db, () => {
        q(`UPDATE products SET name=?, category_id=?, barcode=?, sale_mode=?, price_cents=? WHERE id=?`)
          .run(v.name, v.category_id, v.barcode, v.sale_mode, v.price_cents, id);
        if (v.price_cents != null && v.price_cents !== cur.price_cents)
          q('INSERT INTO price_history(product_id,price_cents) VALUES (?,?)').run(id, v.price_cents);
        return productOut(getProduct(id));
      });
    } catch (e) { uniqueBarcode(e); }
  }

  function setActive(id, active) {
    getProduct(id);
    q('UPDATE products SET active=? WHERE id=?').run(active ? 1 : 0, id);
    return productOut(getProduct(id));
  }

  // ---------- Precios ----------
  function updatePrices(changes) {
    if (!Array.isArray(changes) || !changes.length) throw bad('No hay cambios de precio');
    return tx(db, () => {
      let n = 0;
      for (const c of changes) {
        const p = getProduct(Number(c.product_id));
        if (p.sale_mode === 'FREE') throw bad(`"${p.name}" es de importe libre y no tiene precio fijo`);
        const cents = toCents(c.price);
        if (cents <= 0) throw bad(`Precio inválido para "${p.name}"`);
        if (cents === p.price_cents) continue;
        q('UPDATE products SET price_cents=? WHERE id=?').run(cents, p.id);
        q('INSERT INTO price_history(product_id,price_cents) VALUES (?,?)').run(p.id, cents);
        n++;
      }
      return { updated: n };
    });
  }
  const priceHistory = (id) => {
    getProduct(id);
    return q('SELECT price_cents, changed_at FROM price_history WHERE product_id=? ORDER BY id DESC')
      .all(id).map((r) => ({ price: money(r.price_cents), changed_at: r.changed_at }));
  };

  // ---------- Ventas ----------
  function createSale({ items, payments }) {
    if (!Array.isArray(items) || !items.length) throw bad('El carrito está vacío');
    if (!Array.isArray(payments) || !payments.length) throw bad('Toda venta necesita un método de pago (RN-09)');

    return tx(db, () => {
      const lines = items.map((it) => {
        const p = getProduct(Number(it.product_id));
        if (!p.active) throw bad(`"${p.name}" está desactivado y no puede venderse (RN-11)`);
        let unit, qty;
        if (p.sale_mode === 'UNIT') {
          qty = Number(it.quantity);
          if (!Number.isInteger(qty) || qty < 1) throw bad(`Cantidad inválida para "${p.name}"`);
          qty *= 1000; unit = p.price_cents;
        } else if (p.sale_mode === 'WEIGHT') {
          const kg = Number(it.quantity);
          qty = Math.round(kg * 1000);
          if (!(kg > 0) || qty < 1 || Math.abs(kg * 1000 - qty) > 1e-6)
            throw bad(`Peso inválido para "${p.name}": mayor que 0 y hasta 3 decimales (RN-05)`);
          unit = p.price_cents;
        } else {
          unit = toCents(it.amount);
          if (unit <= 0) throw bad(`El importe de "${p.name}" debe ser mayor que cero (RN-04)`);
          qty = 1000;
        }
        return { p, unit, qty, subtotal: Math.round((unit * qty) / 1000) };
      });
      const total = lines.reduce((s, l) => s + l.subtotal, 0);

      const pays = payments.map((x) => {
        if (!METHODS.includes(x.method)) throw bad('Método de pago inválido');
        const amount = toCents(x.amount);
        if (amount <= 0) throw bad('El monto del pago debe ser mayor que cero');
        return { method: x.method, amount };
      });
      if (pays.reduce((s, x) => s + x.amount, 0) !== total)
        throw bad('El importe pagado no coincide con el total (RN-10)');

      const saleId = Number(q('INSERT INTO sales(total_cents) VALUES (?)').run(total).lastInsertRowid);
      const ins = q(`INSERT INTO sale_items(sale_id,product_id,product_name,sale_mode,unit_price_cents,qty_milli,subtotal_cents)
        VALUES (?,?,?,?,?,?,?)`);
      for (const l of lines) ins.run(saleId, l.p.id, l.p.name, l.p.sale_mode, l.unit, l.qty, l.subtotal);
      const insP = q('INSERT INTO payments(sale_id,method,amount_cents) VALUES (?,?,?)');
      for (const x of pays) insP.run(saleId, x.method, x.amount);
      return getSale(saleId);
    });
  }

  function getSale(id) {
    const s = q('SELECT * FROM sales WHERE id=?').get(id);
    if (!s) throw new HttpError(404, 'Venta no encontrada');
    return saleOut(s);
  }
  function saleOut(s) {
    return {
      id: s.id, created_at: s.created_at, sale_date: s.sale_date, status: s.status,
      voided_at: s.voided_at, total: money(s.total_cents),
      items: q('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id').all(s.id).map((i) => ({
        product_id: i.product_id, name: i.product_name, sale_mode: i.sale_mode,
        unit_price: money(i.unit_price_cents), quantity: i.qty_milli / 1000, subtotal: money(i.subtotal_cents),
      })),
      payments: q('SELECT method, amount_cents FROM payments WHERE sale_id=? ORDER BY id').all(s.id)
        .map((p) => ({ method: p.method, amount: money(p.amount_cents) })),
    };
  }
  function listSales({ from, to }) {
    const today = q("SELECT date('now','localtime') d").get().d;
    from ||= today; to ||= from;
    return q('SELECT * FROM sales WHERE sale_date BETWEEN ? AND ? ORDER BY id DESC').all(from, to).map(saleOut);
  }
  function voidSale(id) {
    const s = getSale(id);
    if (s.status === 'VOIDED') throw bad('La venta ya está anulada');
    q("UPDATE sales SET status='VOIDED', voided_at=datetime('now','localtime') WHERE id=?").run(id);
    return getSale(id);
  }

  // ---------- Reportes ----------
  function report({ from, to }) {
    const today = q("SELECT date('now','localtime') d").get().d;
    from ||= today; to ||= from;
    const t = q(`SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) total FROM sales
      WHERE status='CONFIRMED' AND sale_date BETWEEN ? AND ?`).get(from, to);
    const by = q(`SELECT p.method, SUM(p.amount_cents) amount FROM payments p JOIN sales s ON s.id=p.sale_id
      WHERE s.status='CONFIRMED' AND s.sale_date BETWEEN ? AND ? GROUP BY p.method`).all(from, to);
    const by_method = Object.fromEntries(METHODS.map((m) => [m, 0]));
    for (const r of by) by_method[r.method] = money(r.amount);
    const voided = q(`SELECT COUNT(*) n FROM sales WHERE status='VOIDED' AND sale_date BETWEEN ? AND ?`).get(from, to).n;
    return { from, to, count: t.n, total: money(t.total), voided, by_method };
  }

  return {
    listCategories, createCategory, listProducts, getProduct: (id) => productOut(getProduct(id)),
    productByBarcode, createProduct, updateProduct, setActive, updatePrices, priceHistory,
    createSale, getSale, listSales, voidSale, report,
  };
}
