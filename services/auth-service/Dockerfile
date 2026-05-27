FROM node:18-alpine

WORKDIR /app

COPY shared/package*.json ./shared/
COPY services/auth-service/package*.json ./services/auth-service/

WORKDIR /app/services/auth-service
RUN npm install

WORKDIR /app
COPY shared ./shared
COPY services/auth-service ./services/auth-service

WORKDIR /app/services/auth-service
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "src/index.js"]