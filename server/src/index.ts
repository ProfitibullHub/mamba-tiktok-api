import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables at the very top
dotenv.config();

import tiktokShopAuthRoutes from './routes/tiktok-shop-auth.routes.js';
import tiktokShopDataRoutes from './routes/tiktok-shop-data.routes.js';
import tiktokShopFinanceRoutes from './routes/tiktok-shop-finance.routes.js';
import adminRoutes from './routes/admin.routes.js';

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Middleware - Support both local and production frontend URLs
const allowedOrigins = [
    'http://localhost:5173',
    'https://tiktok-dashboard-frontend-eight.vercel.app',
    'https://mamba-frontend.vercel.app',
    'https://mamba-red.vercel.app',
    FRONTEND_URL
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
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

// Request logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'Mamba - TikTok Shop Dashboard Backend',
    });
});

// Mount TikTok Shop routes
app.use('/api/tiktok-shop/auth', tiktokShopAuthRoutes);
app.use('/api/tiktok-shop', tiktokShopDataRoutes);
app.use('/api/tiktok-shop/finance', tiktokShopFinanceRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
    });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal server error',
    });
});

// Start server if not running in Vercel (Vercel handles the serverless function execution)
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🛍️  Mamba - TikTok Shop Dashboard Backend               ║
║                                                            ║
║   Server running on: http://localhost:${PORT}              ║
║   Frontend URL: ${FRONTEND_URL}                            ║
║                                                            ║
║   TikTok Shop API Endpoints:                               ║
║   - POST /api/tiktok-shop/auth/start                       ║
║   - GET  /api/tiktok-shop/auth/callback                    ║
║   - GET  /api/tiktok-shop/auth/status/:accountId           ║
║   - DELETE /api/tiktok-shop/auth/disconnect/:accountId     ║
║   - GET  /api/tiktok-shop/shops/:accountId                 ║
║   - GET  /api/tiktok-shop/orders/:accountId                ║
║   - GET  /api/tiktok-shop/products/:accountId              ║
║   - GET  /api/tiktok-shop/settlements/:accountId           ║
║   - GET  /api/tiktok-shop/performance/:accountId           ║
║   - POST /api/tiktok-shop/sync/:accountId                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
      `);
    });
}

export default app;
