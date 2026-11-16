# AuSale 1.0

Punto de venta para bodega: ventas por **unidad**, **peso** e **importe libre**, con pago en Efectivo, Yape o Plin.

## Ejecutar

Requiere Node.js ≥ 22.13 (usa `node:sqlite`, sin dependencias que instalar).

```bash
npm start        # http://localhost:3000
npm test         # reglas de negocio
```

Variables opcionales: `PORT`, `DB_FILE` (por defecto `data/pos.db`). La primera vez se cargan productos de ejemplo.

## Cobertura del MVP

| Módulo | Qué incluye |
|---|---|
| Productos | Alta/edición, categorías, código de barras único, modalidad de venta, desactivar sin perder historial |
| Precios | Precio por unidad o por kg, actualización masiva (varias veces al día), historial de precios |
| Ventas | Escaneo de código de barras, búsqueda manual, peso (3 decimales), importe libre, totales automáticos, anulación que conserva el registro |
| Pagos | Efectivo / Yape / Plin, vuelto opcional en efectivo |
| Reportes | Ventas por fecha o rango, totales por método de pago |

## Reglas de negocio (RN-01…RN-12)

Se validan en el servidor (`src/service.js`), nunca solo en la interfaz. El cliente envía únicamente
producto + cantidad/importe; el **servidor** toma el precio vigente y lo copia a `sale_items`
(`unit_price_cents`), por lo que cambiar un precio no altera ventas pasadas (RN-07/08).

## Modelo de datos

`categories`, `products`, `price_history`, `sales`, `sale_items`, `payments`.
Dinero en céntimos y cantidades en milésimas (enteros, sin errores de coma flotante).
`payments` es 1-a-N con `sales`: la UI usa un solo pago por venta, pero **los pagos combinados
(RF-31, v2) solo requieren cambiar la interfaz**; la API y la validación (suma = total) ya los aceptan.

## Fuera del MVP

Productos más vendidos, exportación a Excel, ventas por periodo con gráficos (P2/P3).
