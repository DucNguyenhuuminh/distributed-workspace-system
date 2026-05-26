FROM node:18-alpine
WORKDIR /app
COPY services/file-service/package*.json ./
COPY shared/package*.json ./shared/

RUN npm install
COPY services/file-service ./
COPY shared ./shared

ENV NODE_ENV=production
EXPOSE 3002
CMD ["node","src/index.js"]