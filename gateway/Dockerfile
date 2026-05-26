FROM node:18-alpine

WORKDIR /app
COPY gateway/package*.json ./
RUN npm install

COPY gateway ./
COPY shared ./shared
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]