import { Request, Response, NextFunction } from 'express';

/**
 * Custom error class with HTTP status codes
 */
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  code?: string;

  constructor(message: string, statusCode = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Common error factory functions
 */
export const Errors = {
  notFound: (resource: string) => 
    new AppError(`${resource} not found`, 404, 'NOT_FOUND'),
  
  badRequest: (message: string) => 
    new AppError(message, 400, 'BAD_REQUEST'),
  
  unauthorized: (message = 'Unauthorized') => 
    new AppError(message, 401, 'UNAUTHORIZED'),
  
  forbidden: (message = 'Forbidden') => 
    new AppError(message, 403, 'FORBIDDEN'),
  
  conflict: (message: string) => 
    new AppError(message, 409, 'CONFLICT'),
  
  rateLimit: (retryAfter: number) => 
    new AppError(`Rate limit exceeded. Retry after ${retryAfter}s`, 429, 'RATE_LIMIT'),
  
  serviceUnavailable: (service: string) => 
    new AppError(`${service} is currently unavailable`, 503, 'SERVICE_UNAVAILABLE'),
  
  llmError: (message: string) => 
    new AppError(`LLM processing failed: ${message}`, 502, 'LLM_ERROR'),
  
  ragError: (message: string) => 
    new AppError(`RAG retrieval failed: ${message}`, 502, 'RAG_ERROR'),
  
  zendeskError: (message: string) => 
    new AppError(`Zendesk API error: ${message}`, 502, 'ZENDESK_ERROR'),
};

/**
 * Async handler wrapper to catch errors in async routes
 */
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error handler middleware
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Log error details
  console.error('Error:', {
    message: err.message,
    code: (err as AppError).code,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method,
    body: process.env.NODE_ENV === 'development' ? req.body : undefined,
  });

  // Determine status code
  const statusCode = (err as AppError).statusCode || 500;
  const isOperational = (err as AppError).isOperational || false;

  // Response payload
  const response: {
    success: false;
    error: string;
    code?: string;
    details?: unknown;
    stack?: string;
  } = {
    success: false,
    error: isOperational ? err.message : 'An unexpected error occurred',
    code: (err as AppError).code || 'INTERNAL_ERROR',
  };

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * 404 handler for undefined routes
 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND',
    availableEndpoints: [
      'GET  /health',
      'POST /webhook/ticket',
      'POST /api/categorize',
      'POST /api/draft',
      'POST /api/analyze',
      'POST /admin/kb/index',
      'GET  /admin/kb/search',
    ]
  });
}
