/**
 * Centralized Error Handling Middleware
 * Provides consistent API responses and proper HTTP status codes
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';

// ==================== CUSTOM ERROR CLASSES ====================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    this.details = details;
    
    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', true, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(message, 404, 'NOT_FOUND', true);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED', true);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN', true);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', true, details);
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests, please try again later') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', true);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string = 'Database operation failed', details?: unknown) {
    super(message, 500, 'DATABASE_ERROR', true, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message?: string) {
    super(message || `External service '${service}' unavailable`, 503, 'SERVICE_UNAVAILABLE', true);
  }
}

// ==================== API RESPONSE HELPERS ====================

export function errorResponse(res: Response, error: AppError | Error, requestId?: string): Response {
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  const details = error instanceof AppError ? error.details : undefined;

  // Preserve the existing API's error shape ({ error: ... }) to avoid
  // breaking the current client while still adding structured fields.
  return res.status(statusCode).json({
    error: error.message,
    code,
    details,
    requestId,
    timestamp: new Date().toISOString()
  });
}

// ==================== ERROR HANDLER MIDDLEWARE ====================

function formatZodError(error: ZodError): unknown {
  return error.errors.map(err => ({
    path: err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Generate request ID for tracking
  const requestId = req.headers['x-request-id'] as string || 
                    `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Log error for debugging
  console.error(`[${requestId}] Error:`, {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: (req as any).user?.id,
  });

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const validationError = new ValidationError(
      'Validation failed',
      formatZodError(err)
    );
    errorResponse(res, validationError, requestId);
    return;
  }

  // Handle known AppErrors
  if (err instanceof AppError) {
    errorResponse(res, err, requestId);
    return;
  }

  // Handle Prisma errors
  if (err.constructor.name === 'PrismaClientKnownRequestError') {
    const prismaErr = err as any;
    let appError: AppError;

    switch (prismaErr.code) {
      case 'P2002':
        appError = new ConflictError(
          'A record with this value already exists',
          { field: prismaErr.meta?.target }
        );
        break;
      case 'P2025':
        appError = new NotFoundError('Record');
        break;
      case 'P2003':
        appError = new ValidationError(
          'Foreign key constraint failed',
          { field: prismaErr.meta?.field_name }
        );
        break;
      default:
        appError = new DatabaseError('Database operation failed');
    }
    errorResponse(res, appError, requestId);
    return;
  }

  // Handle unknown errors
  const isProduction = process.env.NODE_ENV === 'production';
  const genericError = new AppError(
    isProduction ? 'An unexpected error occurred' : err.message,
    500,
    'INTERNAL_ERROR',
    false
  );
  errorResponse(res, genericError, requestId);
}

// ==================== ASYNC HANDLER WRAPPER ====================

/**
 * Wraps async route handlers to automatically catch errors
 * and pass them to the error handling middleware
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ==================== NOT FOUND HANDLER ====================

export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  const error = new NotFoundError('Endpoint', req.path);
  errorResponse(res, error);
}

// ==================== REQUEST VALIDATION HELPERS ====================

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new ValidationError('Request body validation failed', formatZodError(result.error));
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      throw new ValidationError('Query parameter validation failed', formatZodError(result.error));
    }
    req.query = result.data as any;
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      throw new ValidationError('URL parameter validation failed', formatZodError(result.error));
    }
    req.params = result.data as any;
    next();
  };
}
