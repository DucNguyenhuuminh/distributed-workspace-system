FROM node:18-alpine AS deps
WORKDIR /app
COPY services/auth-service/package*.json ./
COPY shared/package*.json ./shared/

RUN npm install
COPY services/auth-service ./
COPY shared ./shared

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "src/index.js"]