const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

// app.use('/api/files/internal', require('./routes/internal.routes'));
app.use('/api/files', require('../../src/routes/file.routes'));
app.use('/api/files-worker', require('../../src/routes/file.worker.routes'))
app.get('/health', (_,res) => res.json({status: "OK", service: 'file-service'}));
app.use((_,res) => res.status(404).json({message: "Route not exist"}));

module.exports = app;