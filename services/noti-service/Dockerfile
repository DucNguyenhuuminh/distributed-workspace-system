FROM node:18-slim

WORKDIR /app

COPY shared/package*.json ./shared/
WORKDIR /app/shared
RUN npm install

WORKDIR /app
COPY services/noti-service/package*.json ./services/noti-service/
WORKDIR /app/services/noti-service
RUN npm install

WORKDIR /app
COPY shared ./shared
COPY services/noti-service ./services/noti-service

WORKDIR /app/services/noti-service
ENV NODE_ENV=production
EXPOSE 3006
CMD ["node", "src/index.js"]