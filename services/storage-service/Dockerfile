FROM node:18-alpine
WORKDIR /app
COPY services/storage-service/package*.json ./

RUN npm install
COPY services/storage-service/ ./
ENV NODE_ENV=production
EXPOSE 3005
CMD ["node","src/index.js"]