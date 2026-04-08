require('dotenv').config();
const express = require('express');
const {initMinio} = require('../src/config/minio.config');

const app = express();
app.use(express.json());

app.use('/api/storage', require('./routes/storage.routes'));
app.get('/health', (_,res) => res.json({status: "OK", service: 'storage-service'}));
app.use((_,res) => res.status(404).json({message: "Route not exists"}));

initMinio().then(() => {
    console.log('[storage-service] MinIO connected');
    app.listen(process.env.PORT || 3005, () => console.log(`[storage-service] Running on port ${process.env.PORT}`));
}).catch((err) => {
    console.error('[storage-service] Failed to start:', err.message);
    process.exit(1);
});