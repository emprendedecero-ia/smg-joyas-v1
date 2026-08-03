# SMG Joyas

Tienda Node.js preparada para Vercel. Los productos y pedidos se guardan en PostgreSQL; las fotos actuales se sirven como archivos estáticos del proyecto.

## Configuración

1. Creá una base PostgreSQL, por ejemplo con la integración Neon de Vercel, y copiá su cadena de conexión.
2. En el panel de Vercel agregá las variables de entorno `DATABASE_URL` y `ADMIN_KEY`. La clave inicial del panel es `123456`; cambiala antes de publicar una tienda real.
3. Ejecutá el contenido de [`db/schema.sql`](db/schema.sql) en la consola SQL de tu base.
4. En tu computadora, instalá dependencias con `npm install`, definí las mismas variables en `.env.local` y ejecutá `npm run db:seed`. El script importa los códigos y precios de `precios.xlsx`.
5. Publicá el proyecto en Vercel. La tienda usará `api/products` y el panel interno estará en `/admin.html`.

## Uso diario

- Para actualizar los precios desde el Excel: reemplazá `precios.xlsx` y ejecutá `npm run db:seed`.
- Para altas, bajas o cambios manuales: abrí `/admin.html`, ingresá `ADMIN_KEY` y administrá el catálogo. La baja es lógica: oculta el producto, sin borrar ventas anteriores.
- El ABM acepta una URL de imagen. Para fotos nuevas subilas primero a una URL pública; Vercel no permite guardar archivos subidos en su sistema de archivos durante la ejecución.

Cada pedido registra nombre del cliente, productos, cantidad, precio vendido, descuento y total antes de abrir WhatsApp.
