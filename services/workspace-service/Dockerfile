FROM node:18-alpine

WORKDIR /app

COPY shared/package*.json ./shared/
COPY services/workspace-service/package*.json ./services/workspace-service/

WORKDIR /app/services/workspace-service
RUN npm install

WORKDIR /app
COPY shared ./shared
COPY services/workspace-service ./services/workspace-service

WORKDIR /app/services/workspace-service
ENV NODE_ENV=production
EXPOSE 3003
CMD ["node", "src/index.js"]