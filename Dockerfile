FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data UPLOAD_DIR=/app/data/uploads PUBLIC_DIR=/app/public HTTP_PORT=3000 HTTPS_PORT=3001 PUBLIC_HTTPS_PORT=8093 HOST=0.0.0.0 HOMECHAT_AUTO_TLS=true
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=server-build /app/dist ./dist
COPY --from=client-build /app/client/dist ./public
VOLUME ["/app/data"]
EXPOSE 3000 3001
CMD ["node","dist/server.js"]
