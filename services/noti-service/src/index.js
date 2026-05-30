require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { startAllConsumers } = require('./consumers/index.consumer');
const { closeAllWorkers } = require('shared');
const {createBullBoard} = require('@bull-board/api');
const {BullMQAdapter} = require('@bull-board/api/bullMQAdapter');
const {ExpressAdapter} = require('@bull-board/express');
const {getQueue, QUEUES} = require('shared');

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(getQueue(QUEUES.FILE)),
    new BullMQAdapter(getQueue(QUEUES.NOTIFICATION)),
  ],
  serverAdapter,
});

const app = express();

app.use('/api/notifications', require('./routes/noti.route'));
app.use('/admin/queues', serverAdapter.getRouter());

app.get('/health', (_, res) =>
  res.json({ status: 'OK', service: 'notification-service' })
);

app.use((_, res) =>
  res.status(404).json({ message: 'Route not exists' })
);

async function start() {
  console.log('[notification-service] Service starting...');

  try {
      await mongoose.connect(process.env.MONGO_URI);
      console.log('[notification-service] Connected to MongoDB!');
  } catch (err) {
      console.error('[notification-service] Error connecting to MongoDB:', err.message);
      process.exit(1);
  }

  startAllConsumers();

  app.listen(process.env.PORT || 3006, () =>
    console.log(`[notification-service] Running on port ${process.env.PORT}`)
  );
}

async function shutdown() {
  console.log('[notification-service] Shutting down...');
  await closeAllWorkers();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('[notification-service] Failed to start:', err.message);
  process.exit(1);
});