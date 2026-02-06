import { ZendeskClient } from './zendesk/client';
import { LLMOrchestrator } from './llm/orchestrator';
import { RAGService } from './rag/service';

interface Ticket {
  id: number;
  subject: string;
  description: string;
  requester?: { name: string; email: string };
}

interface ProcessResult {
  ticketId: number;
  category: string;
  hasDraft: boolean;
  urgency: string;
}

export class TicketProcessor {
  constructor(
    private zendesk: ZendeskClient,
    private llm: LLMOrchestrator,
    private rag: RAGService
  ) {}

  async process(ticket: Ticket): Promise<ProcessResult> {
    console.log(`🎫 Processing ticket #${ticket.id}`);

    // Step 1: Categorize the ticket
    const category = await this.llm.categorize({
      subject: ticket.subject,
      description: ticket.description,
    });
    console.log(`  → Category: ${category}`);

    // Step 2: Extract intent and urgency
    const { intent, urgency } = await this.llm.extractIntent(ticket.description);
    console.log(`  → Intent: ${intent}, Urgency: ${urgency}`);

    // Step 3: Add category tags to ticket
    await this.zendesk.addTags(ticket.id, [
      `ai_category:${category}`,
      `ai_urgency:${urgency}`,
    ]);

    // Step 4: Retrieve relevant knowledge
    const context = await this.rag.retrieve(ticket.description);
    console.log(`  → Found ${context.length} relevant KB articles`);

    // Step 5: Generate draft response
    let hasDraft = false;
    if (context.length > 0 || category !== 'general_inquiry') {
      const draft = await this.llm.generateDraft({
        subject: ticket.subject,
        description: ticket.description,
        customerName: ticket.requester?.name || 'Customer',
        context,
      });

      await this.zendesk.addDraftResponse(ticket.id, draft);
      hasDraft = true;
      console.log(`  → Draft response added`);
    }

    return {
      ticketId: ticket.id,
      category,
      hasDraft,
      urgency,
    };
  }
}
