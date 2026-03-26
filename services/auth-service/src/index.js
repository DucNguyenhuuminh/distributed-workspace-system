require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());
app.use('/api/auth',require('./routes/auth.routes'));
app.get('/healthy', (_,res) => 
    res.json({status: "OK", service: 'auth-service'})
);
app.use((_,res) =>
    res.status(404).json({message: 'Route not exist'})
);

mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log('[auth-service] MongoDB connected');
    app.listen(process.env.PORT || 3001, () => 
        console.log(`[auth-service] Running on port ${process.env.PORT}`)
    );
}).catch ((err) => {
    console.error('[auth-service] MongoDB error:', err.message);
    process.exit(1);
});
