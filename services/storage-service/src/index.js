require('dotenv').config();
const express = require('express');
const {initMinio} = require('../src/config/minio.config');

const app = express();
app.use(express.json());

app.get('/health', (_,res) => res.json({status: "OK", service: 'storage-service'}));
app.use((_,res) => res.status(404).json({message: "Route not exists"}));

const startServer = async () => {
    await initMinio();
    const port = process.env.PORT || 3005;
    app.listen(port, () => {
        console.log(`[storage-service] Running on port ${port}`);
    });
};

startServer();