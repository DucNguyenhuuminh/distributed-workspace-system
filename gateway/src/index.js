const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const {createProxyMiddleware} = require('http-proxy-middleware');

const app = express();

app.use(helmet());
app.use(cors({
    origin: 'http://localhost:5173',
    credentials: true
}));

app.use(morgan((tokens, req, res) => {
    return [
        '\x1b[36m[GATEWAY]\x1b[0m',
        tokens.method(req, res),
        tokens.url(req, res),
        '| Status:', tokens.status(req, res),
        '| Size:', tokens.res(req, res, 'content-length') || '-', 'bytes',
        '| Time:', tokens['response-time'](req, res), 'ms',
        '| IP:', tokens['remote-addr'](req, res)
    ].join(' ');
}));

const services = {
    authService: 'http://127.0.0.1:3001',
    fileService: 'http://127.0.0.1:3002',
    workspaceService: 'http://127.0.0.1:3003',
    searchService: 'http://127.0.0.1:3004',
    storageService: 'http://127.0.0.1:3005'
};

app.use(createProxyMiddleware({
    pathFilter: '/api/auth',
    target: services.authService,
    changeOrigin: true
}));
app.use('api/workspaces', createProxyMiddleware({
    pathFilter: ['/api/workspaces','/api/folders'],
    target: services.workspaceService,
    changeOrigin: true
}));

app.use('*',(req,res) => {
    res.status(404).json({message: "API Gateway: Route not exists"});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API Gateway is running at http://127.0.0.1: ${PORT}`);
    console.log(`Direct Auth -> ${services.authService}`);
    console.log(`Direct Workpace -> ${services.workspaceService}`);
});