# Dockerfile raíz para deploys en plataformas que buscan el Dockerfile en la
# raíz del repositorio (Render). Es idéntico a backend/Dockerfile y se
# construye con contexto en la raíz del repo.
FROM node:22-alpine

WORKDIR /app

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/src ./src

# Se hornean dentro de la imagen porque en producción (Render, Zeabur) no hay
# volúmenes montados: las imágenes de producto y el Excel viajan con el build.
COPY products-assets ./products-assets
COPY bijou.xlsx ./bijou.xlsx

EXPOSE 4000

CMD ["sh", "-c", "node src/seed.js && node src/index.js"]
