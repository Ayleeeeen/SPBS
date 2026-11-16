import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, seed } from './db.js';
import { createService, HttpError } from './service.js';

const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

export function createApp(db) {
  const svc = createService(db);
  const routes = [
    ['GET', /^\/api\/categories$/, () => svc.listCategories()],
    ['POST', /^\/api\/categories$/, (_, b) => svc.createCategory(b.name)],
    ['GET', /^\/api\/products$/, (_, __, u) => svc.listProducts({ search: u.searchParams.get('q') ?? '', all: u.searchParams.get('all') === '1' })],
    ['POST', /^\/api\/products$/, (_, b) => svc.createProduct(b)],
    ['GET', /^\/api\/products\/barcode\/([^/]+)$/, (m) => svc.productByBarcode(decodeURIComponent(m[1]))],
    ['PUT', /^\/api\/products\/(\d+)$/, (m, b) => svc.updateProduct(+m[1], b)],
    ['POST', /^\/api\/products\/(\d+)\/active$/, (m, b) => svc.setActive(+m[1], !!b.active)],
    ['GET', /^\/api\/products\/(\d+)\/prices$/, (m) => svc.priceHistory(+m[1])],
    ['POST', /^\/api\/prices$/, (_, b) => svc.updatePrices(b.changes)],
    ['POST', /^\/api\/sales$/, (_, b) => svc.createSale(b)],
    ['GET', /^\/api\/sales$/, (_, __, u) => svc.listSales({ from: u.searchParams.get('from'), to: u.searchParams.get('to') })],
    ['POST', /^\/api\/sales\/(\d+)\/void$/, (m) => svc.voidSale(+m[1])],
    ['GET', /^\/api\/report$/, (_, __, u) => svc.report({ from: u.searchParams.get('from'), to: u.searchParams.get('to') })],
  ];

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [method, re, fn] of routes) {
          const m = url.pathname.match(re);
          if (m && req.method === method) {
            let body = {};
            if (method !== 'GET') {
              const chunks = [];
              for await (const c of req) chunks.push(c);
              if (chunks.length) body = JSON.parse(Buffer.concat(chunks).toString());
            }
            return send(200, await fn(m, body, url));
          }
        }
        return send(404, { error: 'Ruta no encontrada' });
      }
      const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
      const data = await readFile(join(PUBLIC, rel));
      send(200, data, TYPES[extname(rel)] ?? 'application/octet-stream');
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      if (e.code === 'ENOENT') return send(404, 'No encontrado', 'text/plain');
      if (e instanceof SyntaxError) return send(400, { error: 'JSON inválido' });
      console.error(e);
      send(500, { error: 'Error interno' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(process.env.DB_FILE ?? 'data/pos.db');
  seed(db);
  const port = Number(process.env.PORT ?? 3000);
  createApp(db).listen(port, () => console.log(`Minimarket POS en http://localhost:${port}`));
}
