import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock config before importing app
vi.mock('../src/utils/config', () => ({
  appConfig: {
    zendesk: {
      subdomain: 'test',
      email: 'test@test.com',
      token: 'test-token',
    },
    llm: {
      provider: 'openai',
      apiKey: 'test-key',
    },
    rag: {
      pineconeApiKey: 'test-key',
      indexName: 'test-index',
    },
    server: {
      port: 3000,
      nodeEnv: 'test',
    },
  },
}));

// Mock external services
vi.mock('../src/zendesk/client', () => ({
  ZendeskClient: vi.fn().mockImplementation(() => ({
    verifyConnection: vi.fn().mockResolvedValue({ success: true, subdomain: 'test', message: 'OK' }),
    addTags: vi.fn().mockResolvedValue([]),
    addDraftResponse: vi.fn().mockResolvedValue(undefined),
    setCustomField: vi.fn().mockResolvedValue(undefined),
    setPriority: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/llm/orchestrator', () => ({
  LLMOrchestrator: vi.fn().mockImplementation(() => ({
    verifyConnection: vi.fn().mockResolvedValue({ success: true, provider: 'openai', model: 'gpt-4' }),
    categorize: vi.fn().mockResolvedValue('technical_support'),
    extractIntent: vi.fn().mockResolvedValue({
      intent: 'get help',
      urgency: 'medium',
      sentiment: 'neutral',
      keyEntities: [],
    }),
    generateDraft: vi.fn().mockResolvedValue({
      draft: 'Thank you for contacting us...',
      confidence: 0.8,
      suggestedTags: [],
      requiresHumanReview: false,
      reasoning: 'Standard response',
    }),
  })),
}));

vi.mock('../src/rag/service', () => ({
  RAGService: vi.fn().mockImplementation(() => ({
    verifyConnection: vi.fn().mockResolvedValue({ success: true, index: 'test', namespace: 'default' }),
    retrieve: vi.fn().mockResolvedValue([]),
    hybridSearch: vi.fn().mockResolvedValue([]),
    indexDocuments: vi.fn().mockResolvedValue({ indexed: 1, errors: [] }),
    getStats: vi.fn().mockResolvedValue({ totalVectors: 100, namespaces: {}, dimension: 1536 }),
  })),
}));

vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    timed: vi.fn((name, fn) => fn()),
  },
}));

// Import app after mocks are set up
import app from '../src/index';

describe('API Endpoints', () => {
  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /health/detailed', () => {
    it('should return detailed health status', async () => {
      const response = await request(app)
        .get('/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.services.zendesk.success).toBe(true);
      expect(response.body.services.llm.success).toBe(true);
      expect(response.body.services.rag.success).toBe(true);
    });
  });

  describe('POST /webhook/ticket', () => {
    const validPayload = {
      ticket: {
        id: 12345,
        subject: 'Test ticket',
        description: 'This is a test ticket description',
        status: 'new',
        priority: 'normal',
        tags: [],
        requester: { name: 'Test User', email: 'test@example.com' },
      },
    };

    it('should accept valid webhook payload', async () => {
      const response = await request(app)
        .post('/webhook/ticket')
        .send(validPayload)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.ticketId).toBe(12345);
    });

    it('should reject payload without ticket', async () => {
      const response = await request(app)
        .post('/webhook/ticket')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('Missing ticket');
    });

    it('should reject payload with missing required fields', async () => {
      const response = await request(app)
        .post('/webhook/ticket')
        .send({ ticket: { id: 1 } })
        .expect(400);

      expect(response.body.error).toContain('Missing required');
      expect(response.body.missing).toContain('subject');
      expect(response.body.missing).toContain('description');
    });
  });

  describe('POST /api/categorize', () => {
    it('should categorize a ticket', async () => {
      const response = await request(app)
        .post('/api/categorize')
        .send({
          subject: 'Help with billing',
          description: 'I need help understanding my invoice',
        })
        .expect(200);

      expect(response.body.category).toBeDefined();
      expect(response.body.urgency).toBeDefined();
    });

    it('should require subject or description', async () => {
      const response = await request(app)
        .post('/api/categorize')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('required');
    });
  });

  describe('POST /api/draft', () => {
    it('should generate a draft response', async () => {
      const response = await request(app)
        .post('/api/draft')
        .send({
          subject: 'Need help',
          description: 'I cannot figure out how to use the feature',
          customerName: 'Jane',
        })
        .expect(200);

      expect(response.body.draft).toBeDefined();
      expect(response.body.confidence).toBeGreaterThan(0);
    });

    it('should require description', async () => {
      const response = await request(app)
        .post('/api/draft')
        .send({ subject: 'Test' })
        .expect(400);

      expect(response.body.error).toContain('Description required');
    });
  });

  describe('POST /api/analyze', () => {
    it('should perform full analysis', async () => {
      const response = await request(app)
        .post('/api/analyze')
        .send({
          subject: 'Feature not working',
          description: 'The export feature is broken and I need it urgently',
          customerName: 'Bob',
        })
        .expect(200);

      expect(response.body.category).toBeDefined();
      expect(response.body.intent).toBeDefined();
      expect(response.body.urgency).toBeDefined();
      expect(response.body.draftResponse).toBeDefined();
    });
  });

  describe('POST /admin/kb/index', () => {
    it('should index documents', async () => {
      const response = await request(app)
        .post('/admin/kb/index')
        .send({
          documents: [
            { id: 'doc-1', title: 'Test Doc', content: 'Test content' },
          ],
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.indexed).toBe(1);
    });

    it('should require documents array', async () => {
      const response = await request(app)
        .post('/admin/kb/index')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('Documents array required');
    });
  });

  describe('GET /admin/kb/stats', () => {
    it('should return KB statistics', async () => {
      const response = await request(app)
        .get('/admin/kb/stats')
        .expect(200);

      expect(response.body.totalVectors).toBeDefined();
      expect(response.body.dimension).toBeDefined();
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app)
        .get('/unknown/route')
        .expect(404);

      expect(response.body.error).toContain('not found');
      expect(response.body.availableEndpoints).toBeDefined();
    });
  });
});
