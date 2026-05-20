require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { initCollection } = require('./config/chroma.config');
const { startAllConsumers } = require('./consumers/index.consumer');
const { closeAllWorkers } = require('shared');
const {createBullBoard} = require('@bull-board/api');
const {BullMQAdapter} = require('@bull-board/api/bullMQAdapter');
const {ExpressAdapter} = require('@bull-board/express');
const {getQueue, QUEUES} = require('shared');
const embedService = require('./services/embed.service');

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(getQueue(QUEUES.FILE)),
    new BullMQAdapter(getQueue(QUEUES.WORKSPACE)),
    new BullMQAdapter(getQueue(QUEUES.NOTIFICATION)),
    new BullMQAdapter(getQueue(QUEUES.SEARCH)),
  ],
  serverAdapter,
});


const app = express();

app.use('/api/search', require('./routes/search.route'));
app.use('/api/notifications', require('./routes/noti.route'));
app.use('/admin/queues', serverAdapter.getRouter());

app.get('/health', (_, res) =>
  res.json({ status: 'OK', service: 'search-worker & notification-service' })
);

app.use((_, res) =>
  res.status(404).json({ message: 'Route không tồn tại' })
);

async function start() {
  await embedService.loadModel();
  console.log('[search-worker] Embedding model ready');

  await mongoose.connect(process.env.MONGO_URI);
  console.log('[notification-service] MongoDB connected');

  await initCollection();
  startAllConsumers();
  
  app.listen(process.env.PORT || 3004, () =>
    console.log(`[search-worker & notification-service] Running on port ${process.env.PORT}`)
  );
}

async function shutdown() {
  console.log('[search-worker & notification-service] Shutting down...');
  await closeAllWorkers();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('[search-worker & notification-service] Failed to start:', err.message);
  process.exit(1);
});