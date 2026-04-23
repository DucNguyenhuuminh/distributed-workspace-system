const {Queue} = require('bullmq');
const IORedis = require('ioredis');

const connection = process.env.REDIS_URL
    ? new IORedis(process.env.REDIS_URL, {maxRetriesPerRequest: null})
    : new IORedis({
        host: 'localhost',
        port: parseInt('6379',10),
        password: undefined,
            maxRetriesPerRequest: null
        });

const caches = new Map();

function getQueue(name) {
    if (!caches.has(name)) {
        const queue = new Queue(name, {connection: connection});
        caches.set(name, queue);
    }
    return caches.get(name).queue;
}

async function addJob(queueName, jobName, data, opts= {}) {
    const q = getQueue(queueName);
    return q.add(jobName, data, opts);
}

async function closeAll() {
    const tasks = [];
    for (const queue of caches.values()) {
        tasks.push(queue.close().catch(() => {}));
    }
    await Promise.all(tasks);
    caches.clear();
}

process.on('SIGINT', closeAll);
process.on('SIGTERM', closeAll);

module.exports = {addJob,getQueue, closeAll, connection};