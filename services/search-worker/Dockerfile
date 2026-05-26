FROM node:18-alpine AS deps
WORKDIR /app
COPY services/search-worker/package*.json ./
COPY shared/package*.json ./shared/

RUN npm install
COPY services/search-worker ./
COPY shared ./shared
ENV NODE_ENV=production
EXPOSE 3004
CMD ["node","src/index.js"]