FROM node:18-slim
WORKDIR /app

COPY shared/package*.json ./shared/
WORKDIR /app/shared
RUN npm install

WORKDIR /app
COPY services/storage-service/package*.json ./services/storage-service/
WORKDIR /app/services/storage-service
RUN npm install

WORKDIR /app
COPY shared ./shared
COPY services/storage-service ./services/storage-service

WORKDIR /app/services/storage-service
ENV NODE_ENV=production
EXPOSE 3005
CMD ["node", "src/index.js"]