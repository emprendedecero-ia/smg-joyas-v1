# SMG Joyería — Catálogo Mayorista

Catálogo web con carrito, pedidos por WhatsApp y panel admin.

## Stack

- **PostgreSQL** — datos de productos y pedidos
- **Fastify (Node.js)** — API REST
- **Next.js** — frontend del catálogo y admin
- **Docker Compose** — entorno de desarrollo

## Levantar con Docker

```bash
cp .env.example .env
docker compose up --build
```

Servicios:

| Servicio | URL |
|----------|-----|
| Catálogo | http://localhost:3000 |
| API | http://localhost:4000 |
| PostgreSQL | localhost:5432 |

Admin: http://localhost:3000/admin (contraseña por defecto `admin123`)

Al iniciar, la API importa automáticamente `bijou.xlsx` si la base está vacía.
Los precios que se muestran en la página son los **redondeados** del catálogo
(`REDONDEO MAYORISTA`).

**Admin → Productos → Exportar / Importar** permite hacer cambios masivos sin
Excel en el servidor: **Exportar** baja todos los productos con sus datos
(`Cod interno`, categoría, descripción, costo, precios redondeados, stocks y
estado Activo) en un `.xlsx`; se edita en cualquier planilla y se vuelve a subir
con **Importar**, que aplica las modificaciones, da de alta los códigos nuevos
y actualiza los existentes (el historial de pedidos no se toca). El catálogo
vive en la base: la ABM (Agregar producto, editar campos, estado Activo) es la
vía principal y el Excel solo para cambios masivos.

## Flujo de pedidos

1. El cliente arma el carrito (máx. **1000 unidades por producto**).
2. Ingresa su **nombre** antes de confirmar.
3. Se guarda el pedido en la base y se abre WhatsApp con el detalle (PDF de **presupuesto**).
4. En **Admin → Pedidos** se puede **editar** un pendiente, **restablecer** un
   cancelado o **volver a Pendiente** un entregado (el stock se devuelve y se
   vuelve a descontar al reentregar). Al marcar **Entregado** se descuenta el stock.

Los precios visibles en el catálogo son **mayoristas** (redondeados). El costo de
cada producto queda **congelado en el pedido** al confirmarlo, así el informe de
**rentabilidad** (Admin → Reportes) siempre muestra la ganancia real:
`ganancia = facturado − costo`. También se puede editar el costo de cada producto
en Admin → Productos (columna **Costo**) y se ve la ganancia por unidad.

## Desarrollo local (sin Docker)

```bash
# Base de datos
docker compose up db -d

# API
cd backend && npm install
DATABASE_URL=postgres://smg:smg_dev@localhost:5432/smgjoyeria npm run seed
DATABASE_URL=postgres://smg:smg_dev@localhost:5432/smgjoyeria npm run dev

# Frontend (otra terminal)
cd frontend && npm install
NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev
```## Publicar gratis (Vercel + Render + Neon)

Stack recomendado para producción sin costo: **Vercel** (frontend), **Render**
(API) y **Neon** (PostgreSQL). Las imágenes y el Excel ya viajan dentro de la
imagen Docker del backend (no dependen de volúmenes).

1. **Neon** → crear proyecto, copiar `DATABASE_URL`, ejecutar `db/init.sql` en la
   consola SQL y dejar que el seed importe `bijou.xlsx` la primera vez. Después
   el catálogo se administra desde Admin → Productos (ABM + Exportar/Importar).

2. **Render** → New Web Service → conectar GitHub y elegir el repo. Render
   detecta el `Dockerfile` de la raíz. Setear las variables:
   - `DATABASE_URL`
   - `ADMIN_PASSWORD` y `JWT_SECRET`
   - `CORS_ORIGIN` = URL del frontend en Vercel (ej. `https://smgjoyeria.vercel.app`)

   Render pasa `PORT` automáticamente. El plan gratis duerme el servicio tras
   15 min sin visitas y lo despierta en ~1 min; se puede mantener despierto con
   un monitor de uptime gratuito (UptimeRobot) que lo pingee cada 5 min.

3. **Vercel** → importar el repo, directorio raíz `frontend/`, build por
defecto de Next.js, y setear:
   - `NEXT_PUBLIC_API_URL` = URL de la API en Render
   - `API_URL` = misma URL (para el SSR)
   - `NEXT_PUBLIC_WHATSAPP_NUMBER` = número WhatsApp

   El catálogo se recarga desde el navegador si la API estaba dormida.

## Estructura

```
backend/          API Fastify
frontend/         Next.js (catálogo + admin)
db/init.sql       Schema PostgreSQL
products-assets/  Imágenes de productos
bijou.xlsx        Catálogo vigente (cod interno, precios redondeados, costo)
```

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `ADMIN_PASSWORD` | Contraseña del panel admin |
| `JWT_SECRET` | Secreto para tokens admin |
| `NEXT_PUBLIC_API_URL` | URL de la API |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Número WhatsApp (sin + ni espacios) |
