FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data UPLOAD_DIR=/app/data/uploads PORT=3000 HOST=0.0.0.0
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node","dist/server.js"]
