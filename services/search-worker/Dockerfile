FROM node:18-alpine

WORKDIR /app

COPY shared/package*.json ./shared/
COPY services/search-worker/package*.json ./services/search-worker/

WORKDIR /app/services/search-worker
RUN npm install

WORKDIR /app
COPY shared ./shared
COPY services/search-worker ./services/search-worker

WORKDIR /app/services/search-worker
ENV NODE_ENV=production
EXPOSE 3004
CMD ["node", "src/index.js"]