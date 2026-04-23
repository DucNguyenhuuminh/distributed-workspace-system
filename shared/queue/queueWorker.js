const {Worker} = require('bullmq');
const {connection} = require('./queueProducer');

const workers = new Map();

function createWorker(queueName, processor, opts = {}) {
    if (workers.has(queueName)){
        return workers.get(queueName);
    }
    const worker = new Worker(queueName, processor, {connection: connection, ...opts});
    worker.on('failed',(job,err) => {
        console.error(`[Queue: ${queueName}] job ${job?.id} failed:`, err)
    });

    worker.on('completed',job => {
        console.log(`[Queue: ${queueName}] job ${job?.id} completed`)
    });
    worker.set(queueName,worker);
    return worker;
}

async function closeAllWorkers() {
    const tasks = [];
    for (const worker of workers.values()) {
        tasks.push(worker.close().catch(() => {}));
    }
    await Promise.all(tasks);
    workers.clear();
}

process.on('SIGINT', closeAllWorkers);
process.on('SIGTERM', closeAllWorkers);

module.exports = {createWorker, closeAllWorkers};