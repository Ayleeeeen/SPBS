// Graba un video promocional de AuSale manejando la app real con Playwright.
// Uso: node src/server.js (con DB limpia) y luego: node promo/make-video.cjs <base-url> <salida.webm>
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://localhost:3112';
const OUT = process.argv[3] || 'promo/raw';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  const j = (p, o) => fetch(BASE + '/api' + p, o && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o) }).then((r) => r.json());
  const ps = await j('/products'); const id = (n) => ps.find((p) => p.name.startsWith(n)).id;
  const mk = (items, method, total) => j('/sales', { items, payments: [{ method, amount: total }] });
  await mk([{ product_id: id('Arroz'), quantity: 2 }, { product_id: id('Aceite'), quantity: 1 }], 'CASH', 20.9);
  await mk([{ product_id: id('Tomate'), quantity: 1.5 }, { product_id: id('Cebolla'), quantity: 0.5 }], 'YAPE', 6.65);
  await mk([{ product_id: id('Pollo'), quantity: 1.8 }], 'YAPE', 18);
  await mk([{ product_id: id('Gaseosa'), quantity: 3 }, { product_id: id('Culantro'), amount: 1 }], 'CASH', 8.5);
  await mk([{ product_id: id('Pollo'), quantity: 2.2 }, { product_id: id('Hierbabuena'), amount: 2 }], 'PLIN', 24);
  await mk([{ product_id: id('Detergente'), quantity: 2 }, { product_id: id('Aceite'), quantity: 2 }], 'PLIN', 32);
  await mk([{ product_id: id('Tomate'), quantity: 2 }, { product_id: id('Arroz'), quantity: 1 }], 'CASH', 12.2);
  await mk([{ product_id: id('Gaseosa'), quantity: 4 }], 'YAPE', 10);
}

const HELPERS = () => {
  const css = document.createElement('style');
  css.textContent = `
  #cur{position:fixed;z-index:5000;width:22px;height:22px;margin:-4px 0 0 -4px;border-radius:50%;background:#fff;border:3px solid #4540e8;box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;transition:transform .08s}
  #cur.down{transform:scale(.7)}
  .rip{position:fixed;z-index:4999;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid #4540e8;pointer-events:none;animation:rip .5s ease-out forwards}
  @keyframes rip{to{transform:scale(3.2);opacity:0}}
  #cap{pointer-events:none;position:fixed;z-index:4000;left:50%;bottom:34px;transform:translate(-50%,24px);opacity:0;transition:all .45s ease;text-align:center;max-width:1000px;
    background:rgba(20,36,95,.95);color:#fff;padding:15px 32px;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.35);font-family:Inter,'Segoe UI',sans-serif}
  #cap.on{opacity:1;transform:translate(-50%,0)} #cap.top{bottom:auto;top:12px;transform:translate(-50%,-20px)} #cap.top.on{transform:translate(-50%,0)}
  #cap b{display:block;font-size:30px;letter-spacing:-.01em} #cap i{display:block;font-style:normal;font-size:18px;color:#b9c5f2;margin-top:4px;font-weight:500}
  #card{position:fixed;inset:0;z-index:4500;background:linear-gradient(135deg,#14245f,#1b2f7a 60%,#2b3fb0);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:Inter,'Segoe UI',sans-serif;opacity:0;visibility:hidden;transition:opacity .6s,visibility .6s;text-align:center}
  #card.on{opacity:1;visibility:visible}
  #card .ln{font-size:54px;font-weight:800;letter-spacing:-.02em;opacity:0;transform:translateY(18px);margin:6px 0}
  #card.on .ln{animation:up .7s ease forwards} @keyframes up{to{opacity:1;transform:none}}
  #card .ln.sm{font-size:28px;font-weight:500;color:#b9c5f2}
  #card .hl{color:#8f8cff}
  #card img{width:120px;height:120px;border-radius:30px;box-shadow:0 16px 40px rgba(0,0,0,.4);opacity:0;transform:scale(.8)}
  #card.on img{animation:pop .8s .1s ease forwards} @keyframes pop{to{opacity:1;transform:none}}
  #card .chips{display:flex;gap:14px;margin-top:34px;opacity:0} #card.on .chips{animation:up .8s 1.6s ease forwards}
  #card .chip{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:99px;padding:10px 22px;font-size:20px;font-weight:600}`;
  document.head.append(css);
  const cur = document.createElement('div'); cur.id = 'cur'; cur.style.left = '-50px'; cur.style.top = '-50px';
  const cap = document.createElement('div'); cap.id = 'cap';
  const card = document.createElement('div'); card.id = 'card';
  document.body.append(card, cap, cur);
  addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', (e) => { cur.classList.add('down'); const r = document.createElement('div'); r.className = 'rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.append(r); setTimeout(() => r.remove(), 600); }, true);
  addEventListener('mouseup', () => cur.classList.remove('down'), true);
  window.cap = (t, s, top) => { cap.classList.toggle('top', !!top); cap.innerHTML = t ? `<b>${t}</b>${s ? `<i>${s}</i>` : ''}` : ''; cap.classList.toggle('on', !!t); };
  window.card = (html) => { card.innerHTML = html || ''; card.classList.toggle('on', !!html); };
};

(async () => {
  await seed();
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
  const p = await ctx.newPage();
  const cap = (t, s, top) => p.evaluate(([t, s, top]) => window.cap(t, s, top), [t, s, top]);
  const card = (h) => p.evaluate((h) => window.card(h), h);
  const move = async (sel) => { const bx = await p.locator(sel).first().boundingBox(); await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2, { steps: 28 }); await wait(180); };
  const click = async (sel) => { await move(sel); await p.locator(sel).first().click({ delay: 70 }); await wait(120); };
  const scan = async (code) => { await p.locator('#barcode').pressSequentially(code, { delay: 22 }); await wait(250); await p.keyboard.press('Enter'); await wait(900); };

  await p.goto(BASE); await p.evaluate(HELPERS); await p.mouse.move(640, 700);
  await wait(3200);                                   // 1. pantalla de inicio real
  await click('#start'); await wait(900);

  await card(`<div class="ln">¿Unidades, kilos, hierbas por sol…</div><div class="ln">y pagos por <span class="hl">Yape, Plin</span> o efectivo?</div><div class="ln sm" style="animation-delay:1.4s">Todo en una sola pantalla.</div>`);
  await wait(5200); await card(''); await wait(800);

  // 2. escaneo
  await cap('Escanea y vende en segundos', 'Códigos de barras para todo lo envasado');
  await move('#barcode'); await scan('7750000000012'); await scan('7750000000012'); await scan('7750000000029'); await wait(1200);

  // 3. peso
  await cap('Pollo y verduras: pon el peso', 'El total se calcula solo, al céntimo');
  await click('#a-weight'); await wait(500); await click('text=Pollo entero'); await wait(400);
  await p.locator('#qv').pressSequentially('0.750', { delay: 220 }); await wait(1800);
  await click('#qok'); await wait(1500);

  // 4. importe libre
  await cap('Hierbas: el cliente dice cuánto', 'Importe libre, sin balanza ni cálculos');
  await click('#a-weight'); await wait(500); await click('text=Culantro'); await wait(400);
  await p.locator('#qv').pressSequentially('1', { delay: 250 }); await wait(1000); await click('#qok'); await wait(2200);

  // 5. cobro
  await cap('Efectivo, Yape o Plin', 'Cobra en un toque', true);
  await click('#pay'); await wait(1200); await click('[data-m=CASH]'); await p.locator('#recv').pressSequentially('50', { delay: 200 }); await wait(1200);
  await click('[data-m=YAPE]'); await wait(1400); await click('#confirm'); await wait(1800);

  // 6. ticket
  await cap('Ticket listo para tu impresora térmica', '80 mm o 58 mm · reimprímelo cuando quieras', true);
  await wait(4500); await click('.foot .btn.ghost'); await wait(1000);

  // 7. precios
  await cap('¿Subió el pollo? Cámbialo en segundos', 'Las ventas anteriores conservan su precio');
  await click('[data-view=prices]'); await wait(1200);
  const row = p.locator('tr', { hasText: 'Pollo entero' }).locator('input.px');
  const bx = await row.boundingBox(); await p.mouse.move(bx.x + 40, bx.y + 18, { steps: 25 }); await p.mouse.down(); await p.mouse.up();
  await row.pressSequentially('11.00', { delay: 230 }); await wait(1400);
  await click('#xsave'); await wait(2600);

  // 8. reportes
  await cap('Sabe cuánto vendiste hoy', 'Total por Efectivo, Yape y Plin, listo al cierre');
  await click('[data-view=sales]'); await wait(2600);
  await click('[data-a=det] >> nth=0'); await wait(2800);

  // 9. cierre
  await cap('');
  await card(`<img src="logo.svg"><div class="ln" style="margin-top:22px;font-size:66px">AuSale</div><div class="ln sm" style="animation-delay:.5s">Vende más rápido. Cuenta claro.</div>
    <div class="chips"><span class="chip">Unidad · Peso · Importe libre</span><span class="chip">Yape · Plin · Efectivo</span><span class="chip">Ticket térmico</span></div>`);
  await wait(6500);
  await ctx.close(); await b.close();
})();
