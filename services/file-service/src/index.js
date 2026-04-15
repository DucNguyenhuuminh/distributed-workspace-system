require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
require('./cleanup.worker');

const app = express();
app.use(express.json());
app.use('/api/files/internal', require('./routes/internal.routes'));
app.use('/api/files', require('./routes/file.routes'));
app.use('/api/files-worker', require('./routes/file.worker.routes'))
app.get('/health', (_,res) => res.json({status: "OK", service: 'file-service'}));
app.use((_,res) => res.status(404).json({message: "Route not exist"}));

mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log('[file-service] MongoDB connected');
    app.listen(process.env.PORT || 3002, () => console.log(`[file-service] Running on port ${process.env.PORT || 3002}`));
}).catch((err) => {
    console.error('[file-service] MongoDB error:', err.message);
    process.exit(1);
});
