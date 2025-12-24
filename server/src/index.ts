import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import tiktokShopAuthRoutes from './routes/tiktok-shop-auth.routes.js';
import tiktokShopDataRoutes from './routes/tiktok-shop-data.routes.js';
import tiktokShopFinanceRoutes from './routes/tiktok-shop-finance.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

const allowedOrigins = [
    'http://localhost:5173',
    'https://tiktok-dashboard-frontend-eight.vercel.app',
    FRONTEND_URL
];

app.use(cors({
    origin: (origin, callback) => {

        if (!origin) return callback(null, true);

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Mamba - TikTok Shop Dashboard Backend',
    });
});

app.use('/api/tiktok-shop/auth', tiktokShopAuthRoutes);
app.use('/api/tiktok-shop', tiktokShopDataRoutes);
app.use('/api/tiktok-shop/finance', tiktokShopFinanceRoutes);

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
    });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error',
    });
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`
            Backend Started
      `);
    });
}

export default app;
