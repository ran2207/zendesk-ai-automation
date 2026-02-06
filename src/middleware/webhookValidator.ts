import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Validates Zendesk webhook signatures for security
 * Zendesk signs webhooks using HMAC-SHA256
 */
export function validateZendeskWebhook(secret?: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip validation if no secret configured (development mode)
    if (!secret) {
      console.warn('⚠️  Webhook signature validation disabled (no secret configured)');
      return next();
    }

    const signature = req.headers['x-zendesk-webhook-signature'] as string;
    const timestamp = req.headers['x-zendesk-webhook-signature-timestamp'] as string;

    if (!signature || !timestamp) {
      console.warn('Missing webhook signature headers');
      return res.status(401).json({ 
        error: 'Missing signature headers',
        required: ['x-zendesk-webhook-signature', 'x-zendesk-webhook-signature-timestamp']
      });
    }

    // Verify timestamp is within 5 minutes to prevent replay attacks
    const timestampAge = Date.now() - parseInt(timestamp, 10) * 1000;
    if (timestampAge > 5 * 60 * 1000) {
      return res.status(401).json({ error: 'Webhook timestamp expired' });
    }

    // Verify HMAC signature
    const body = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('base64');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isValid) {
      console.warn('Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  };
}

/**
 * Validates required fields in the webhook payload
 */
export function validateTicketPayload(req: Request, res: Response, next: NextFunction) {
  const { ticket } = req.body;

  if (!ticket) {
    return res.status(400).json({ 
      error: 'Missing ticket object in payload',
      received: Object.keys(req.body)
    });
  }

  const required = ['id', 'subject', 'description'];
  const missing = required.filter(field => !ticket[field] && ticket[field] !== 0);

  if (missing.length > 0) {
    return res.status(400).json({
      error: 'Missing required ticket fields',
      missing,
      received: Object.keys(ticket)
    });
  }

  // Sanitize and normalize the ticket data
  req.body.ticket = {
    ...ticket,
    id: Number(ticket.id),
    subject: String(ticket.subject).trim(),
    description: String(ticket.description).trim(),
    tags: Array.isArray(ticket.tags) ? ticket.tags : [],
    requester: ticket.requester || { name: 'Customer', email: 'unknown@example.com' }
  };

  next();
}

/**
 * Rate limiting middleware for webhook endpoints
 */
const requestCounts = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const identifier = req.ip || 'unknown';
  const now = Date.now();
  
  let record = requestCounts.get(identifier);
  
  if (!record || now > record.resetTime) {
    record = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
    requestCounts.set(identifier, record);
  }
  
  record.count++;
  
  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    });
  }
  
  next();
}

// Cleanup old rate limit records periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of requestCounts.entries()) {
    if (now > value.resetTime) {
      requestCounts.delete(key);
    }
  }
}, 60 * 1000);
