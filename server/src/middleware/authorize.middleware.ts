import type { NextFunction, Request, Response } from 'express';
import { authorize, type AuthorizeOptions } from '../services/authorization.service.js';

type AuthorizeOptionsFactory = AuthorizeOptions | ((req: Request) => AuthorizeOptions);

export function requireAuthorization(optionsFactory: AuthorizeOptionsFactory) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const options = typeof optionsFactory === 'function' ? optionsFactory(req) : optionsFactory;
            const result = await authorize(req, options);
            if (!result.allowed) {
                res.status(result.status).json({ success: false, error: result.reason });
                return;
            }
            next();
        } catch (error) {
            next(error);
        }
    };
}
