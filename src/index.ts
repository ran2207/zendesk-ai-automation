import express, { Request, Response } from 'express';
import { ZendeskClient } from './zendesk/client';
import { LLMOrchestrator } from './llm/orchestrator';
import { RAGService } from './rag/service';
import { TicketProcessor } from './processor';
import { appConfig } from './utils/config';
import { logger } from './utils/logger';
import { 
  validateZendeskWebhook, 
  validateTicketPayload,
  rateLimit 
} from './middleware/webhookValidator';
import { 
  errorHandler, 
  notFoundHandler, 
  asyncHandler 
} from './middleware/errorHandler';
import { KnowledgeDocument, ZendeskWebhookPayload } from './types';

const app = express();
app.use(express.json({ limit: '10mb' }));

// Initialize services
const zendesk = new ZendeskClient({
  subdomain: appConfig.zendesk.subdomain,
  email: appConfig.zendesk.email,
  token: appConfig.zendesk.token,
});

const llm = new LLMOrchestrator({
  provider: appConfig.llm.provider,
  apiKey: appConfig.llm.apiKey,
  model: appConfig.llm.model,
});

const rag = new RAGService({
  pineconeApiKey: appConfig.rag.pineconeApiKey,
  indexName: appConfig.rag.indexName,
  openaiApiKey: appConfig.rag.openaiApiKey,
  namespace: appConfig.rag.namespace,
});

const processor = new TicketProcessor(zendesk, llm, rag, {
  addDraftToTicket: true,
  addTagsToTicket: true,
  categoryFieldId: appConfig.zendesk.categoryFieldId,
});

// ============================================================
// Health & Status Endpoints
// ============================================================

app.get('/health', async (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

app.get('/health/detailed', asyncHandler(async (_req: Request, res: Response) => {
  const [zendeskStatus, llmStatus, ragStatus] = await Promise.all([
    zendesk.verifyConnection(),
    llm.verifyConnection(),
    rag.verifyConnection(),
  ]);

  const allHealthy = zendeskStatus.success && llmStatus.success && ragStatus.success;

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      zendesk: zendeskStatus,
      llm: llmStatus,
      rag: ragStatus,
    },
  });
}));

// ============================================================
// Webhook Endpoints
// ============================================================

app.post(
  '/webhook/ticket',
  rateLimit,
  validateZendeskWebhook(appConfig.zendesk.webhookSecret),
  validateTicketPayload,
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body as ZendeskWebhookPayload;
    const { ticket } = payload;

    logger.info(`📥 Webhook received for ticket #${ticket.id}`, { 
      subject: ticket.subject,
      requester: ticket.requester?.email 
    });

    // Process ticket (async - respond immediately)
    const resultPromise = processor.process({
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description,
      requester: ticket.requester,
      tags: ticket.tags,
    });

    // Respond immediately to Zendesk (don't timeout)
    res.json({
      success: true,
      ticketId: ticket.id,
      message: 'Ticket received and processing started',
      timestamp: new Date().toISOString(),
    });

    // Log result when complete
    resultPromise.then(result => {
      logger.info(`📤 Ticket #${ticket.id} processing complete`, {
        category: result.category,
        urgency: result.intent.urgency,
        hasDraft: !!result.draftResponse,
        processingTimeMs: result.processingTimeMs,
      });
    }).catch(error => {
      logger.error(`📤 Ticket #${ticket.id} processing failed`, { error: error.message });
    });
  })
);

// Synchronous webhook - waits for processing to complete
app.post(
  '/webhook/ticket/sync',
  rateLimit,
  validateZendeskWebhook(appConfig.zendesk.webhookSecret),
  validateTicketPayload,
  asyncHandler(async (req: Request, res: Response) => {
    const { ticket } = req.body as ZendeskWebhookPayload;

    const result = await processor.process({
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description,
      requester: ticket.requester,
      tags: ticket.tags,
    });

    res.json({
      success: !result.error,
      ticketId: ticket.id,
      category: result.category,
      urgency: result.intent.urgency,
      sentiment: result.intent.sentiment,
      knowledgeArticles: result.relevantKnowledge.length,
      draftGenerated: !!result.draftResponse,
      draftConfidence: result.draftResponse?.confidence,
      processingTimeMs: result.processingTimeMs,
      error: result.error,
    });
  })
);

// ============================================================
// API Endpoints
// ============================================================

// Categorize a ticket (standalone)
app.post('/api/categorize', asyncHandler(async (req: Request, res: Response) => {
  const { subject, description, tags } = req.body;

  if (!subject && !description) {
    return res.status(400).json({ error: 'Subject or description required' });
  }

  const category = await llm.categorize({ subject, description, tags });
  const intent = await llm.extractIntent(description || subject);

  res.json({
    category,
    intent: intent.intent,
    urgency: intent.urgency,
    sentiment: intent.sentiment,
    keyEntities: intent.keyEntities,
  });
}));

// Generate draft response (standalone)
app.post('/api/draft', asyncHandler(async (req: Request, res: Response) => {
  const { subject, description, customerName, category } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'Description required' });
  }

  // Retrieve relevant knowledge
  const context = await rag.retrieve(description);

  // Generate draft
  const draft = await llm.generateDraft({
    subject: subject || 'Support Request',
    description,
    customerName: customerName || 'Customer',
    context,
    category,
  });

  res.json({
    draft: draft.draft,
    confidence: draft.confidence,
    suggestedTags: draft.suggestedTags,
    requiresHumanReview: draft.requiresHumanReview,
    reasoning: draft.reasoning,
    sourcesUsed: context.length,
  });
}));

// Full analysis without Zendesk update
app.post('/api/analyze', asyncHandler(async (req: Request, res: Response) => {
  const { subject, description, customerName } = req.body;

  if (!description) {
    return res.status(400).json({ error: 'Description required' });
  }

  const queryText = `${subject || ''}\n${description}`;

  const [category, intent, knowledge] = await Promise.all([
    llm.categorize({ subject, description }),
    llm.extractIntent(description),
    rag.retrieve(queryText),
  ]);

  const draft = await llm.generateDraft({
    subject: subject || 'Support Request',
    description,
    customerName: customerName || 'Customer',
    context: knowledge,
    category,
    sentiment: intent.sentiment,
  });

  res.json({
    category,
    intent: intent.intent,
    urgency: intent.urgency,
    sentiment: intent.sentiment,
    keyEntities: intent.keyEntities,
    relevantKnowledge: knowledge.map(k => ({
      title: k.title,
      score: Math.round(k.score * 100),
      preview: k.text.substring(0, 200) + '...',
    })),
    draftResponse: draft,
  });
}));

// Search knowledge base
app.get('/api/kb/search', asyncHandler(async (req: Request, res: Response) => {
  const { q, limit } = req.query;

  if (!q || typeof q !== 'string') {
    return res.status(400).json({ error: 'Query parameter q required' });
  }

  const results = await rag.retrieve(q, { 
    topK: parseInt(limit as string, 10) || 5,
    minScore: 0.5,
  });

  res.json({
    query: q,
    results: results.map(r => ({
      id: r.id,
      title: r.title,
      preview: r.text.substring(0, 300) + (r.text.length > 300 ? '...' : ''),
      score: Math.round(r.score * 100),
      url: r.url,
    })),
  });
}));

// ============================================================
// Admin Endpoints
// ============================================================

// Index documents to knowledge base
app.post('/admin/kb/index', asyncHandler(async (req: Request, res: Response) => {
  const { documents } = req.body as { documents: KnowledgeDocument[] };

  if (!documents || !Array.isArray(documents)) {
    return res.status(400).json({ error: 'Documents array required' });
  }

  const result = await rag.indexDocuments(documents);

  res.json({
    success: true,
    indexed: result.indexed,
    errors: result.errors,
  });
}));

// Get KB stats
app.get('/admin/kb/stats', asyncHandler(async (_req: Request, res: Response) => {
  const stats = await rag.getStats();
  res.json(stats);
}));

// Delete KB documents
app.delete('/admin/kb/documents', asyncHandler(async (req: Request, res: Response) => {
  const { ids } = req.body as { ids: string[] };

  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'Document IDs array required' });
  }

  await rag.deleteDocuments(ids);
  res.json({ success: true, deleted: ids.length });
}));

// Reprocess a ticket
app.post('/admin/ticket/:id/reprocess', asyncHandler(async (req: Request, res: Response) => {
  const ticketId = parseInt(req.params.id, 10);
  const result = await processor.reprocess(ticketId);
  res.json(result);
}));

// ============================================================
// Error Handling
// ============================================================

app.use(notFoundHandler);
app.use(errorHandler);

// ============================================================
// Server Startup
// ============================================================

const PORT = appConfig.server.port;

app.listen(PORT, () => {
  logger.info(`🚀 Zendesk AI Automation running on port ${PORT}`, {
    env: appConfig.server.nodeEnv,
    llmProvider: appConfig.llm.provider,
  });
});

export default app;
