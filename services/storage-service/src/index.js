require('dotenv').config();
const express = require('express');
const {initMinio} = require('../src/config/minio.config');

const app = express();
app.use(express.json());

app.use((req,res,next) => {
    res.header("Access-Control-Allow-Origin","*");
    res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept, Authorization"
    );
    if (req.method === "OPTIONS") {
        res.header("Access-Control-Allow-Methods", "PUT, POST, PATCH, DELETE, GET");
        return res.status(200).json({});
    }
    next();
})

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