const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const {createProxyMiddleware} = require('http-proxy-middleware');

const app = express();

app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));

app.use(morgan((tokens, req, res) => {
    return [
        '\x1b[36m[GATEWAY]\x1b[0m',
        tokens.method(req, res),
        tokens.url(req, res),
        '|Status:', tokens.status(req, res),
        '|Size:', tokens.res(req, res, 'content-length') || '-', 'bytes',
        '|Time:', tokens['response-time'](req, res), 'ms',
        '|IP:', tokens['remote-addr'](req, res)
    ].join(' ');
}));

const services = {
    authService: process.env.AUTH_SERVICE_URL,
    fileService: process.env.FILE_SERVICE_URL,
    workspaceService: process.env.WORKSPACE_SERVICE_URL,
    searchService: process.env.SEARCH_SERVICE_URL,
    storageService: process.env.STORAGE_SERVICE_URL
};

app.use((req, res, next) => {
  if (req.path.includes('/internal/')) {
    console.warn(`[SECURITY WARNING] Blocked external access to internal route: ${req.originalUrl}`);
    return res.status(403).json({ message: 'Forbidden access to internal routes' });
  }
  next();
});

app.use(createProxyMiddleware({
    pathFilter: ['/api/auth', '/api/admin'],
    target: services.authService,
    changeOrigin: true
}));

app.use(createProxyMiddleware({
    pathFilter: ['/api/workspaces', '/api/folders'],
    target: services.workspaceService,
    changeOrigin: true
}));

app.use(createProxyMiddleware({
    pathFilter: ['/api/storage'],
    target: services.storageService,
    changeOrigin: true
}));

app.use(createProxyMiddleware({
    pathFilter: ['/api/files', '/api/files-worker'],
    target: services.fileService,
    changeOrigin: true
}));

app.use(createProxyMiddleware({
    pathFilter: ['/api/search', '/api/notifications'],
    target: services.searchService,
    changeOrigin: true
}));

app.use('*',(req,res) => {
    res.status(404).json({message: "API Gateway: Route not exists"});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`API Gateway is running at http://127.0.0.1:${PORT}`);
    console.log(`Direct Auth        -> ${services.authService}`);
    console.log(`Direct File        -> ${services.fileService}`);
    console.log(`Direct Workpace    -> ${services.workspaceService}`);
    console.log(`Direct Search      -> ${services.searchService}`);
    console.log(`Direct Storage     -> ${services.storageService}`);
});