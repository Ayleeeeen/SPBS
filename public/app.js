// Minimarket POS 1.0 — interfaz (JS puro, sin dependencias)
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'S/ ' + Number(n).toFixed(2);
const MODE = { UNIT: 'Por unidad', WEIGHT: 'Por peso', FREE: 'Importe libre' };
const METHOD = { CASH: 'Efectivo', YAPE: 'Yape', PLIN: 'Plin' };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Error de servidor');
  return data;
}
let toastT;
function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2800);
}

/* ---------- Modal ---------- */
function openModal({ title, body, wide, actions = [] }) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="overlay"><div class="modal ${wide ? 'wide' : ''}">
    <h3>${esc(title)}</h3><div class="body">${body}<div class="err" id="m-err"></div></div>
    <div class="foot"></div></div></div>`;
  const foot = $('.foot', root);
  const close = () => { root.innerHTML = ''; };
  const api_ = { close, el: $('.modal', root), error: (m) => ($('#m-err').textContent = m) };
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls ?? ''); b.textContent = a.label; b.id = a.id ?? '';
    b.onclick = () => (a.run ? a.run(api_) : close());
    foot.append(b);
  }
  $('.overlay', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('overlay')) close(); });
  return api_;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal-root').innerHTML = ''; });

/* ---------- Navegación ---------- */
const views = { sale: renderSale, products: renderProducts, prices: renderPrices, sales: renderSales };
let current = 'sale';
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  current = b.dataset.view;
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('active', x === b));
  views[current]();
});
setInterval(() => { $('#clock').textContent = new Date().toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }); }, 1000);
$('#clock').textContent = new Date().toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });

/* =====================================================
   VENTA
   ===================================================== */
const cart = []; // { product, qty, amount }
let selected = -1;
const lineSub = (l) => {
  if (l.product.sale_mode === 'FREE') return Math.round(l.amount * 100) / 100;
  return Math.round(l.product.price * 100 * l.qty) / 100;
};
const cartTotal = () => Math.round(cart.reduce((s, l) => s + Math.round(lineSub(l) * 100), 0)) / 100;

function renderSale() {
  $('#view').innerHTML = `
  <div class="pos">
    <div class="left">
      <div class="selected" id="selected"></div>
      <div class="cart">
        <div class="cart-head"><span>#</span><span>En el carrito</span><span>Precio</span><span>Cantidad</span><span>Total</span></div>
        <div class="cart-body" id="cart-body"></div>
      </div>
      <div class="totals"><div><div class="lbl">Artículos: <b id="t-count">0</b></div><div class="lbl">Total a pagar</div></div><div class="big" id="t-total">S/ 0.00</div></div>
    </div>
    <div class="right">
      <div class="scan"><h4>Código de barras</h4>
        <input id="barcode" placeholder="Escanee o escriba + Enter" autocomplete="off" inputmode="numeric">
        <div class="hint">El lector de códigos escribe aquí automáticamente.</div></div>
      <button class="action" id="a-search"><span class="ic">🔍</span>Buscar en el catálogo</button>
      <button class="action" id="a-weight"><span class="ic">⚖</span>Productos por peso e importe libre</button>
      <button class="action" id="a-clear"><span class="ic">✕</span>Nueva venta (vaciar carrito)</button>
      <button class="paybtn" id="pay">Cobrar</button>
    </div>
  </div>`;
  const bc = $('#barcode'); bc.focus();
  bc.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !bc.value.trim()) return;
    const code = bc.value.trim(); bc.value = '';
    try { addProduct(await api('/products/barcode/' + encodeURIComponent(code))); }
    catch (err) { toast(err.message, 'error'); }
  });
  $('#a-search').onclick = () => openCatalog();
  $('#a-weight').onclick = () => openCatalog(['WEIGHT', 'FREE']);
  $('#a-clear').onclick = () => { if (cart.length && confirm('¿Vaciar el carrito?')) { cart.length = 0; selected = -1; drawCart(); } };
  $('#pay').onclick = openPayment;
  drawCart();
}

function drawCart() {
  if (current !== 'sale') return;
  const body = $('#cart-body');
  body.innerHTML = cart.length ? cart.map((l, i) => {
    const m = l.product.sale_mode;
    const qty = m === 'UNIT' ? `${l.qty} u` : m === 'WEIGHT' ? `${l.qty.toFixed(3)} kg` : '—';
    const price = m === 'FREE' ? 'libre' : m === 'WEIGHT' ? `${l.product.price.toFixed(2)}/kg` : l.product.price.toFixed(2);
    return `<div class="cart-row ${i === selected ? 'sel' : ''}" data-i="${i}"><span class="n">${i + 1}.</span>
      <span class="nm">${esc(l.product.name)}</span><span>${price}</span><span>${qty}</span><span class="tot">${lineSub(l).toFixed(2)}</span></div>`;
  }).reverse().join('') : '<div class="cart-empty">El carrito está vacío.<br>Escanee un producto o búsquelo en el catálogo.</div>';
  body.querySelectorAll('.cart-row').forEach((r) => (r.onclick = () => { selected = +r.dataset.i; drawCart(); }));
  $('#t-total').textContent = money(cartTotal());
  $('#t-count').textContent = cart.length;
  $('#pay').disabled = !cart.length;
  drawSelected();
}

function drawSelected() {
  const el = $('#selected'); const l = cart[selected];
  if (!l) { el.innerHTML = '<div class="empty">Seleccione un producto del carrito para editar su cantidad.</div>'; return; }
  const p = l.product;
  let control;
  if (p.sale_mode === 'UNIT') control = `<div><label>Cantidad, u</label><div class="stepper"><button id="q-minus" aria-label="menos">−</button><input id="q-in" value="${l.qty}" inputmode="numeric"><button id="q-plus" aria-label="más">+</button></div></div>`;
  else if (p.sale_mode === 'WEIGHT') control = `<div><label>Peso, kg</label><input class="qty-input" id="q-in" value="${l.qty.toFixed(3)}" inputmode="decimal"></div>`;
  else control = `<div><label>Importe, S/</label><input class="qty-input" id="q-in" value="${l.amount.toFixed(2)}" inputmode="decimal"></div>`;
  el.innerHTML = `<div class="name">${esc(p.name)}</div>
    <div><label>${p.sale_mode === 'WEIGHT' ? 'Precio por kg' : 'Precio'}</label><div class="price">${p.sale_mode === 'FREE' ? 'libre' : money(p.price)}</div></div>
    ${control}<div class="sub">${money(lineSub(l))}</div><button class="btn danger" id="del">Eliminar</button>`;
  const apply = (v) => {
    const n = Number(String(v).replace(',', '.'));
    if (p.sale_mode === 'UNIT') { if (Number.isInteger(n) && n >= 1) l.qty = n; }
    else if (p.sale_mode === 'WEIGHT') { if (n > 0 && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6) l.qty = n; else toast('Peso mayor que 0 con hasta 3 decimales', 'error'); }
    else { if (n > 0) l.amount = n; else toast('El importe debe ser mayor que cero', 'error'); }
    drawCart();
  };
  $('#q-in').onchange = (e) => apply(e.target.value);
  if ($('#q-minus')) { $('#q-minus').onclick = () => apply(l.qty - 1); $('#q-plus').onclick = () => apply(l.qty + 1); }
  $('#del').onclick = () => { cart.splice(selected, 1); selected = Math.min(selected, cart.length - 1); drawCart(); };
}

function addProduct(p) {
  if (p.sale_mode === 'UNIT') {
    const ex = cart.findIndex((l) => l.product.id === p.id);
    if (ex >= 0) { cart[ex].qty++; selected = ex; }
    else { cart.push({ product: p, qty: 1 }); selected = cart.length - 1; }
    drawCart(); return;
  }
  askQuantity(p);
}

function askQuantity(p) {
  const w = p.sale_mode === 'WEIGHT';
  const m = openModal({
    title: p.name,
    body: `<div class="field"><label>${w ? `Peso en kg (precio ${money(p.price)}/kg)` : 'Importe en S/'}</label>
      <input class="input" id="qv" inputmode="decimal" placeholder="${w ? '0.750' : '1.00'}" autocomplete="off"></div>
      <div class="paytotal"><div class="lbl">Subtotal</div><div class="v" id="qs">S/ 0.00</div></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Agregar', id: 'qok', run: ok }],
  });
  const inp = $('#qv'); inp.focus();
  const val = () => Number(inp.value.replace(',', '.'));
  inp.oninput = () => { const n = val(); $('#qs').textContent = money(n > 0 ? (w ? Math.round(p.price * 100 * n) / 100 : n) : 0); };
  inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  function ok() {
    const n = val();
    if (!(n > 0)) return m.error(w ? 'El peso debe ser mayor que cero' : 'El importe debe ser mayor que cero');
    if (w && Math.abs(n * 1000 - Math.round(n * 1000)) > 1e-6) return m.error('Máximo 3 decimales');
    cart.push(w ? { product: p, qty: n } : { product: p, qty: 1, amount: n });
    selected = cart.length - 1; m.close(); drawCart(); $('#barcode')?.focus();
  }
}

async function openCatalog(modes) {
  const m = openModal({ title: 'Buscar en el catálogo', wide: true,
    body: `<input class="input" id="cq" placeholder="Nombre del producto…" autocomplete="off"><div class="catalog-list" id="cl"></div>`,
    actions: [{ label: 'Cerrar', cls: 'ghost' }] });
  const inp = $('#cq'); inp.focus();
  const load = async () => {
    let ps = await api('/products?q=' + encodeURIComponent(inp.value));
    if (modes) ps = ps.filter((p) => modes.includes(p.sale_mode));
    $('#cl').innerHTML = ps.map((p) => `<div class="catalog-item" data-id="${p.id}"><div><b>${esc(p.name)}</b><div class="lbl" style="color:var(--muted);font-size:12px">${esc(p.category ?? 'Sin categoría')}</div></div>
      <div style="text-align:right"><span class="tag ${p.sale_mode}">${MODE[p.sale_mode]}</span><div>${p.sale_mode === 'FREE' ? 'precio libre' : money(p.price) + (p.sale_mode === 'WEIGHT' ? '/kg' : '')}</div></div></div>`).join('') || '<div class="cart-empty">Sin resultados</div>';
    $('#cl').querySelectorAll('.catalog-item').forEach((it) => (it.onclick = () => { m.close(); addProduct(ps.find((p) => p.id === +it.dataset.id)); $('#barcode')?.focus(); }));
    $('#cl').dataset.first = ps[0]?.id ?? '';
  };
  inp.oninput = load;
  inp.onkeydown = (e) => { if (e.key === 'Enter') $('#cl .catalog-item')?.click(); };
  load();
}

function openPayment() {
  const total = cartTotal(); let method = 'CASH';
  const m = openModal({ title: 'Cobrar venta',
    body: `<div class="paytotal"><div class="lbl">Total a pagar</div><div class="v">${money(total)}</div></div>
      <div class="methods">${Object.entries(METHOD).map(([k, v]) => `<button class="method ${k === method ? 'on' : ''}" data-m="${k}">${v}</button>`).join('')}</div>
      <div class="field" id="cash-box"><label>Efectivo recibido (opcional, para calcular vuelto)</label><input class="input" id="recv" inputmode="decimal"></div>
      <div class="change" id="chg"></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Confirmar venta', id: 'confirm', run: confirmSale }] });
  const root = m.el;
  root.querySelectorAll('.method').forEach((b) => (b.onclick = () => {
    method = b.dataset.m;
    root.querySelectorAll('.method').forEach((x) => x.classList.toggle('on', x === b));
    $('#cash-box').hidden = method !== 'CASH'; $('#chg').textContent = '';
  }));
  $('#recv').oninput = (e) => { const r = Number(e.target.value.replace(',', '.')); $('#chg').textContent = r >= total ? `Vuelto: ${money(r - total)}` : ''; };
  $('#recv').focus();
  async function confirmSale() {
    const btn = $('#confirm'); btn.disabled = true;
    try {
      const items = cart.map((l) => ({ product_id: l.product.id, quantity: l.qty, amount: l.amount }));
      const sale = await api('/sales', { method: 'POST', body: { items, payments: [{ method, amount: total }] } });
      cart.length = 0; selected = -1; m.close(); drawCart();
      toast(`Venta #${sale.id} guardada — ${money(sale.total)} (${METHOD[method]})`, 'ok');
      $('#barcode')?.focus();
    } catch (e) { m.error(e.message); btn.disabled = false; }
  }
}

/* =====================================================
   PRODUCTOS
   ===================================================== */
async function renderProducts() {
  const v = $('#view');
  v.innerHTML = `<div class="toolbar"><input class="input grow" id="ps" placeholder="Buscar producto por nombre…"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pall" checked> Mostrar desactivados</label><button class="btn" id="pnew">+ Nuevo producto</button></div><div id="plist"></div>`;
  const load = async () => {
    const ps = await api(`/products?all=${$('#pall').checked ? 1 : 0}&q=` + encodeURIComponent($('#ps').value));
    $('#plist').innerHTML = `<table class="grid"><thead><tr><th>Producto</th><th>Categoría</th><th>Código de barras</th><th>Modalidad</th><th class="r">Precio</th><th></th></tr></thead><tbody>${
      ps.map((p) => `<tr class="${p.active ? '' : 'off'}"><td><b>${esc(p.name)}</b> ${p.active ? '' : '<span class="tag VOIDED">Desactivado</span>'}</td><td>${esc(p.category ?? '—')}</td><td>${esc(p.barcode ?? '—')}</td>
      <td><span class="tag ${p.sale_mode}">${MODE[p.sale_mode]}</span></td><td class="r">${p.sale_mode === 'FREE' ? '—' : money(p.price) + (p.sale_mode === 'WEIGHT' ? '/kg' : '')}</td>
      <td class="actions"><button class="link" data-a="edit" data-id="${p.id}">Editar</button><button class="link" data-a="hist" data-id="${p.id}">Precios</button><button class="link ${p.active ? 'red' : ''}" data-a="tog" data-id="${p.id}">${p.active ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('') || '<tr><td colspan="6" class="cart-empty">Sin productos</td></tr>'}</tbody></table>`;
    $('#plist').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const p = ps.find((x) => x.id === +b.dataset.id);
      if (b.dataset.a === 'edit') productForm(p, load);
      if (b.dataset.a === 'hist') priceHistory(p);
      if (b.dataset.a === 'tog') { await api(`/products/${p.id}/active`, { method: 'POST', body: { active: !p.active } }); load(); }
    };
  };
  $('#ps').oninput = load; $('#pall').onchange = load; $('#pnew').onclick = () => productForm(null, load);
  load();
}

async function productForm(p, done) {
  const cats = await api('/categories');
  const m = openModal({ title: p ? 'Editar producto' : 'Registrar producto',
    body: `<div class="field"><label>Nombre</label><input class="input" id="f-name" value="${esc(p?.name ?? '')}"></div>
    <div class="row2"><div class="field"><label>Categoría</label><select class="input" id="f-cat"><option value="">Sin categoría</option>${cats.map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__new">+ Nueva categoría…</option></select></div>
    <div class="field"><label>Código de barras</label><input class="input" id="f-bar" value="${esc(p?.barcode ?? '')}" inputmode="numeric"></div></div>
    <div class="row2"><div class="field"><label>Modalidad de venta</label><select class="input" id="f-mode">${Object.entries(MODE).map(([k, t]) => `<option value="${k}" ${p?.sale_mode === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field" id="f-price-box"><label id="f-price-l">Precio de venta (S/)</label><input class="input" id="f-price" inputmode="decimal" value="${p?.price ?? ''}"></div></div>`,
    actions: [{ label: 'Cancelar', cls: 'ghost' }, { label: 'Guardar', run: save }] });
  const sync = () => {
    const mode = $('#f-mode').value;
    $('#f-price-box').hidden = mode === 'FREE';
    $('#f-price-l').textContent = mode === 'WEIGHT' ? 'Precio por kg (S/)' : 'Precio de venta (S/)';
  };
  $('#f-mode').onchange = sync; sync();
  $('#f-cat').onchange = async (e) => {
    if (e.target.value !== '__new') return;
    const name = prompt('Nombre de la nueva categoría');
    if (!name) { e.target.value = ''; return; }
    try {
      const c = await api('/categories', { method: 'POST', body: { name } });
      e.target.insertAdjacentHTML('afterbegin', `<option value="${c.id}">${esc(c.name)}</option>`); e.target.value = c.id;
    } catch (err) { m.error(err.message); e.target.value = ''; }
  };
  async function save() {
    const body = { name: $('#f-name').value, category_id: $('#f-cat').value === '__new' ? '' : $('#f-cat').value,
      barcode: $('#f-bar').value, sale_mode: $('#f-mode').value, price: $('#f-price').value.replace(',', '.') };
    try { await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PUT' : 'POST', body }); m.close(); toast('Producto guardado', 'ok'); done(); }
    catch (e) { m.error(e.message); }
  }
}

async function priceHistory(p) {
  const h = await api(`/products/${p.id}/prices`);
  openModal({ title: `Historial de precios — ${p.name}`,
    body: h.length ? `<table class="grid"><thead><tr><th>Fecha</th><th class="r">Precio</th></tr></thead><tbody>${h.map((x) => `<tr><td>${esc(x.changed_at)}</td><td class="r">${money(x.price)}</td></tr>`).join('')}</tbody></table>` : '<div class="cart-empty">Sin precios registrados</div>',
    actions: [{ label: 'Cerrar', cls: 'ghost' }] });
}

/* =====================================================
   PRECIOS (actualización masiva)
   ===================================================== */
async function renderPrices() {
  const v = $('#view');
  v.innerHTML = `<div class="toolbar"><input class="input grow" id="xs" placeholder="Filtrar por nombre…"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="xw" checked> Solo productos por peso</label><button class="btn" id="xsave">Guardar cambios</button></div><div id="xlist"></div>`;
  let all = (await api('/products')).filter((p) => p.sale_mode !== 'FREE');
  const draw = () => {
    const f = $('#xs').value.toLowerCase(), onlyW = $('#xw').checked;
    const ps = all.filter((p) => p.name.toLowerCase().includes(f) && (!onlyW || p.sale_mode === 'WEIGHT'));
    $('#xlist').innerHTML = `<table class="grid"><thead><tr><th>Producto</th><th>Modalidad</th><th class="r">Precio actual</th><th class="r">Nuevo precio (S/)</th></tr></thead><tbody>${
      ps.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="tag ${p.sale_mode}">${MODE[p.sale_mode]}</span></td><td class="r">${money(p.price)}${p.sale_mode === 'WEIGHT' ? '/kg' : ''}</td>
      <td class="r"><input class="input px" style="width:110px;text-align:right" data-id="${p.id}" data-old="${p.price}" inputmode="decimal" placeholder="${p.price.toFixed(2)}"></td></tr>`).join('')}</tbody></table>`;
  };
  $('#xs').oninput = draw; $('#xw').onchange = draw; draw();
  $('#xsave').onclick = async () => {
    const changes = [...document.querySelectorAll('.px')].filter((i) => i.value.trim() !== '')
      .map((i) => ({ product_id: +i.dataset.id, price: i.value.replace(',', '.') }));
    if (!changes.length) return toast('Escriba al menos un precio nuevo', 'error');
    try { const r = await api('/prices', { method: 'POST', body: { changes } }); toast(`${r.updated} precio(s) actualizado(s)`, 'ok'); renderPrices(); }
    catch (e) { toast(e.message, 'error'); }
  };
}

/* =====================================================
   VENTAS Y REPORTES
   ===================================================== */
async function renderSales() {
  const v = $('#view'); const t = todayStr();
  v.innerHTML = `<div class="toolbar"><label>Desde <input type="date" class="input" id="d1" value="${t}"></label><label>Hasta <input type="date" class="input" id="d2" value="${t}"></label><button class="btn ghost" id="dtoday">Hoy</button></div><div id="rep"></div><div id="slist"></div>`;
  const load = async () => {
    const qs = `from=${$('#d1').value}&to=${$('#d2').value}`;
    const [r, sales] = await Promise.all([api('/report?' + qs), api('/sales?' + qs)]);
    $('#rep').innerHTML = `<div class="cards"><div class="card dark"><div class="k">Total vendido</div><div class="v">${money(r.total)}</div></div>
      <div class="card"><div class="k">Ventas</div><div class="v">${r.count}</div></div>
      ${Object.entries(METHOD).map(([k, n]) => `<div class="card"><div class="k">${n}</div><div class="v">${money(r.by_method[k])}</div></div>`).join('')}
      <div class="card"><div class="k">Anuladas</div><div class="v">${r.voided}</div></div></div>`;
    $('#slist').innerHTML = `<table class="grid"><thead><tr><th>N.º</th><th>Fecha y hora</th><th>Pago</th><th>Estado</th><th class="r">Total</th><th></th></tr></thead><tbody>${
      sales.map((s) => `<tr class="${s.status === 'VOIDED' ? 'off' : ''}"><td>#${s.id}</td><td>${esc(s.created_at)}</td>
      <td>${s.payments.map((p) => `<span class="tag ${p.method}">${METHOD[p.method]}${s.payments.length > 1 ? ' ' + money(p.amount) : ''}</span>`).join(' ')}</td>
      <td>${s.status === 'VOIDED' ? '<span class="tag VOIDED">Anulada</span>' : 'Confirmada'}</td><td class="r"><b>${money(s.total)}</b></td>
      <td class="actions"><button class="link" data-a="det" data-id="${s.id}">Detalle</button>${s.status === 'CONFIRMED' ? `<button class="link red" data-a="void" data-id="${s.id}">Anular</button>` : ''}</td></tr>
      <tr class="sale-detail" id="det-${s.id}" hidden><td colspan="6">${s.items.map((i) => `${esc(i.name)} — ${i.sale_mode === 'UNIT' ? i.quantity + ' u × ' + money(i.unit_price) : i.sale_mode === 'WEIGHT' ? i.quantity.toFixed(3) + ' kg × ' + money(i.unit_price) : 'importe libre'} = <b>${money(i.subtotal)}</b>`).join('<br>')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="cart-empty">No hay ventas en este periodo</td></tr>'}</tbody></table>`;
    $('#slist').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.a === 'det') { const r2 = $('#det-' + b.dataset.id); r2.hidden = !r2.hidden; }
      if (b.dataset.a === 'void' && confirm(`¿Anular la venta #${b.dataset.id}? El registro se conserva.`)) {
        try { await api(`/sales/${b.dataset.id}/void`, { method: 'POST' }); toast('Venta anulada', 'ok'); load(); } catch (err) { toast(err.message, 'error'); }
      }
    };
  };
  $('#d1').onchange = $('#d2').onchange = load;
  $('#dtoday').onclick = () => { $('#d1').value = $('#d2').value = todayStr(); load(); };
  load();
}

renderSale();

/* Pantalla de presentación (solo una vez por sesión del navegador) */
const splash = $('#splash');
let seen = false;
try { seen = sessionStorage.getItem('ausale-seen') === '1'; } catch {}
if (seen) splash.remove();
else $('#start').onclick = () => {
  try { sessionStorage.setItem('ausale-seen', '1'); } catch {}
  splash.classList.add('hide');
  setTimeout(() => { splash.remove(); $('#barcode')?.focus(); }, 450);
};
