FROM node:18-alpine
WORKDIR /app
COPY services/workspace-service/package*.json ./
COPY shared/package*.json ./shared/


RUN npm install
COPY services/workspace-service/ ./
COPY shared ./shared
ENV NODE_ENV=production
EXPOSE 3003
CMD ["node","src/index.js"]