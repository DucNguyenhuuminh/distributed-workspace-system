FROM node:18-alpine

WORKDIR /app

COPY shared/package*.json ./shared/
COPY services/file-service/package*.json ./services/file-service/

WORKDIR /app/services/file-service
RUN npm install

WORKDIR /app
COPY shared ./shared
COPY services/file-service ./services/file-service

WORKDIR /app/services/file-service
ENV NODE_ENV=production
EXPOSE 3002
CMD ["node", "src/index.js"]