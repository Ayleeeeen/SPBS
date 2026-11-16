import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seed } from '../src/db.js';
import { createService } from '../src/service.js';

const setup = () => { const db = openDb(':memory:'); seed(db); return createService(db); };
const byName = (s, n) => s.listProducts({ search: n })[0];

test('peso: 0.750 kg x S/10 = S/7.50 y el precio histórico se conserva (RN-07/08)', () => {
  const s = setup();
  const pollo = byName(s, 'Pollo');
  const sale = s.createSale({ items: [{ product_id: pollo.id, quantity: 0.75 }], payments: [{ method: 'CASH', amount: 7.5 }] });
  assert.equal(sale.total, 7.5);
  s.updatePrices([{ product_id: pollo.id, price: 11 }]);
  assert.equal(s.getSale(sale.id).items[0].unit_price, 10);
  assert.equal(s.getSale(sale.id).total, 7.5);
  assert.deepEqual(s.priceHistory(pollo.id).map((h) => h.price), [11, 10]);
});

test('importe libre y pago combinado coherente', () => {
  const s = setup();
  const h = byName(s, 'Culantro');
  const det = byName(s, 'Detergente');
  const sale = s.createSale({
    items: [{ product_id: h.id, amount: 1 }, { product_id: det.id, quantity: 2 }],
    payments: [{ method: 'CASH', amount: 5 }, { method: 'YAPE', amount: 7 }],
  });
  assert.equal(sale.total, 12);
  const r = s.report({});
  assert.equal(r.by_method.CASH, 5);
  assert.equal(r.by_method.YAPE, 7);
});

test('reglas: pago distinto al total, peso inválido, importe 0, desactivado', () => {
  const s = setup();
  const t = byName(s, 'Tomate'), h = byName(s, 'Culantro'), d = byName(s, 'Detergente');
  assert.throws(() => s.createSale({ items: [{ product_id: d.id, quantity: 1 }], payments: [{ method: 'CASH', amount: 5 }] }), /RN-10/);
  assert.throws(() => s.createSale({ items: [{ product_id: t.id, quantity: 0.0001 }], payments: [{ method: 'CASH', amount: 1 }] }), /RN-05/);
  assert.throws(() => s.createSale({ items: [{ product_id: h.id, amount: 0 }], payments: [{ method: 'CASH', amount: 1 }] }), /RN-04/);
  s.setActive(d.id, false);
  assert.throws(() => s.createSale({ items: [{ product_id: d.id, quantity: 1 }], payments: [{ method: 'CASH', amount: 5.5 }] }), /RN-11/);
});

test('anular conserva el registro y no cuenta en reportes', () => {
  const s = setup();
  const d = byName(s, 'Detergente');
  const sale = s.createSale({ items: [{ product_id: d.id, quantity: 1 }], payments: [{ method: 'PLIN', amount: 5.5 }] });
  s.voidSale(sale.id);
  assert.equal(s.listSales({}).length, 1);
  assert.equal(s.report({}).total, 0);
});

test('productos: código de barras duplicado y precio obligatorio', () => {
  const s = setup();
  assert.throws(() => s.createProduct({ name: 'X', sale_mode: 'UNIT', price: 1, barcode: '7750000000012' }), /ya está registrado/);
  assert.throws(() => s.createProduct({ name: 'X', sale_mode: 'WEIGHT' }), /RN-03/);
});
