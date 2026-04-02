require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use('/api/workspaces', require('./routes/workspace.routes'));
app.use('/api/folders', require('./routes/folder.routes'));
app.get('/health', (_,res) => res.json({status: "OK", service: 'workspace-service'}));
app.use((_,res) => res.status(404).json({message: "Route not exist"}));

mongoose.connect(process.env.MONGO_URI).then(() => {
        console.log('[workspace-service] MongoDB connected');
        app.listen(process.env.PORT || 3003, () =>
            console.log(`[workspace-service] Running on port ${process.env.PORT}`)
        );
    }).catch((err) => {
        console.error('[workspace-service] MongoDB error:', err.message);
        process.exit(1);
    });