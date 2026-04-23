// src/app.js
const express = require('express');

const app = express();
app.use(express.json());

app.use('/api/workspaces', require('../../src/routes/workspace.routes'));
app.use('/api/folders', require('../../src/routes/folder.routes'));

app.get('/health', (_, res) => res.json({status: "OK", service: 'workspace-service'}));
app.use((_, res) => res.status(404).json({message: "Route not exist"}));

// XUẤT APP RA ĐỂ CHO FILE TEST VÀ FILE INDEX SỬ DỤNG
module.exports = app;