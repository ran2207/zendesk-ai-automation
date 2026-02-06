import { ZendeskClient } from './zendesk/client';
import { LLMOrchestrator } from './llm/orchestrator';
import { RAGService } from './rag/service';
import { 
  ProcessingResult, 
  TicketCategory, 
  IntentAnalysis, 
  DraftResponse,
  KnowledgeResult 
} from './types';
import { logger } from './utils/logger';

interface TicketInput {
  id: number;
  subject: string;
  description: string;
  requester?: { name: string; email: string };
  tags?: string[];
}

interface ProcessorConfig {
  addDraftToTicket?: boolean;      // Add draft as internal note
  addTagsToTicket?: boolean;       // Add AI tags to ticket
  minConfidenceForDraft?: number;  // Minimum confidence to generate draft
  categoryFieldId?: number;        // Custom field ID for category
}

/**
 * Main ticket processor orchestrating the AI pipeline
 * 1. Categorizes ticket
 * 2. Extracts intent and sentiment
 * 3. Retrieves relevant knowledge
 * 4. Generates draft response
 */
export class TicketProcessor {
  private zendesk: ZendeskClient;
  private llm: LLMOrchestrator;
  private rag: RAGService;
  private config: ProcessorConfig;

  constructor(
    zendesk: ZendeskClient,
    llm: LLMOrchestrator,
    rag: RAGService,
    config: ProcessorConfig = {}
  ) {
    this.zendesk = zendesk;
    this.llm = llm;
    this.rag = rag;
    this.config = {
      addDraftToTicket: true,
      addTagsToTicket: true,
      minConfidenceForDraft: 0.6,
      ...config,
    };
  }

  /**
   * Process a ticket through the AI pipeline
   */
  async process(ticket: TicketInput): Promise<ProcessingResult> {
    const startTime = Date.now();
    logger.info(`🎫 Processing ticket #${ticket.id}`, { subject: ticket.subject });

    let category: TicketCategory = 'general_inquiry';
    let intent: IntentAnalysis = { intent: 'unknown', urgency: 'medium', sentiment: 'neutral', keyEntities: [] };
    let relevantKnowledge: KnowledgeResult[] = [];
    let draftResponse: DraftResponse | null = null;
    let error: string | undefined;

    try {
      // Step 1: Categorize the ticket
      category = await logger.timed('categorize', async () => 
        this.llm.categorize({
          subject: ticket.subject,
          description: ticket.description,
          tags: ticket.tags,
        })
      );
      logger.info(`  📁 Category: ${category}`);

      // Step 2: Extract intent, urgency, and sentiment
      intent = await logger.timed('extractIntent', async () =>
        this.llm.extractIntent(ticket.description)
      );
      logger.info(`  🎯 Intent: ${intent.intent} | Urgency: ${intent.urgency} | Sentiment: ${intent.sentiment}`);

      // Step 3: Retrieve relevant knowledge using hybrid search
      relevantKnowledge = await logger.timed('ragRetrieval', async () =>
        this.rag.hybridSearch(
          `${ticket.subject}\n${ticket.description}`,
          intent.keyEntities
        )
      );
      logger.info(`  📚 Found ${relevantKnowledge.length} relevant KB articles`);

      // Step 4: Add tags to ticket (async, don't wait)
      if (this.config.addTagsToTicket) {
        const tags = this.generateTags(category, intent);
        this.zendesk.addTags(ticket.id, tags).catch(e => 
          logger.warn('Failed to add tags', { ticketId: ticket.id, error: e.message })
        );
      }

      // Step 5: Set category custom field if configured
      if (this.config.categoryFieldId) {
        this.zendesk.setCustomField(ticket.id, this.config.categoryFieldId, category).catch(e =>
          logger.warn('Failed to set category field', { ticketId: ticket.id, error: e.message })
        );
      }

      // Step 6: Generate draft response
      draftResponse = await logger.timed('generateDraft', async () =>
        this.llm.generateDraft({
          subject: ticket.subject,
          description: ticket.description,
          customerName: ticket.requester?.name || 'Customer',
          context: relevantKnowledge,
          category,
          sentiment: intent.sentiment,
        })
      );
      logger.info(`  ✍️  Draft generated (confidence: ${Math.round(draftResponse.confidence * 100)}%)`);

      // Step 7: Add draft to ticket if confidence is high enough
      if (
        this.config.addDraftToTicket && 
        draftResponse.confidence >= (this.config.minConfidenceForDraft || 0.6)
      ) {
        await this.zendesk.addDraftResponse(ticket.id, draftResponse.draft, {
          category,
          confidence: draftResponse.confidence,
          sources: relevantKnowledge.slice(0, 3).map(k => k.title || k.id),
        });
        logger.info(`  📝 Draft added to ticket`);
      }

      // Step 8: Set priority based on urgency
      if (intent.urgency === 'critical' || intent.urgency === 'high') {
        const priority = intent.urgency === 'critical' ? 'urgent' : 'high';
        this.zendesk.setPriority(ticket.id, priority).catch(e =>
          logger.warn('Failed to set priority', { ticketId: ticket.id, error: e.message })
        );
      }

    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown processing error';
      logger.error(`Failed to process ticket #${ticket.id}`, { error });
    }

    const processingTimeMs = Date.now() - startTime;
    logger.info(`✅ Ticket #${ticket.id} processed in ${processingTimeMs}ms`);

    return {
      ticketId: ticket.id,
      category,
      intent,
      relevantKnowledge,
      draftResponse,
      processingTimeMs,
      error,
    };
  }

  /**
   * Process multiple tickets in parallel
   */
  async processBatch(tickets: TicketInput[], concurrency = 5): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];
    
    for (let i = 0; i < tickets.length; i += concurrency) {
      const batch = tickets.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(ticket => this.process(ticket))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Generate AI tags based on category and intent
   */
  private generateTags(category: TicketCategory, intent: IntentAnalysis): string[] {
    const tags: string[] = [
      `ai_category:${category}`,
      `ai_urgency:${intent.urgency}`,
      `ai_sentiment:${intent.sentiment}`,
      'ai_processed',
    ];

    // Add entity tags (sanitized)
    intent.keyEntities.slice(0, 3).forEach(entity => {
      const sanitized = entity.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20);
      if (sanitized) {
        tags.push(`ai_entity:${sanitized}`);
      }
    });

    return tags;
  }

  /**
   * Reprocess a ticket (useful for manual retry)
   */
  async reprocess(ticketId: number): Promise<ProcessingResult> {
    const ticket = await this.zendesk.getTicket(ticketId);
    return this.process({
      id: ticket.id,
      subject: ticket.subject,
      description: ticket.description || '',
      tags: ticket.tags,
    });
  }
}
