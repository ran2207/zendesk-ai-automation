import express, { Request, Response } from 'express';
import { config } from 'dotenv';
import { ZendeskClient } from './zendesk/client';
import { LLMOrchestrator } from './llm/orchestrator';
import { RAGService } from './rag/service';
import { TicketProcessor } from './processor';

config();

const app = express();
app.use(express.json());

// Initialize services
const zendesk = new ZendeskClient({
  subdomain: process.env.ZENDESK_SUBDOMAIN!,
  email: process.env.ZENDESK_EMAIL!,
  token: process.env.ZENDESK_API_TOKEN!,
});

const llm = new LLMOrchestrator({
  provider: process.env.LLM_PROVIDER as 'openai' | 'anthropic',
  apiKey: process.env.LLM_PROVIDER === 'openai' 
    ? process.env.OPENAI_API_KEY! 
    : process.env.ANTHROPIC_API_KEY!,
});

const rag = new RAGService({
  pineconeApiKey: process.env.PINECONE_API_KEY!,
  indexName: process.env.PINECONE_INDEX!,
});

const processor = new TicketProcessor(zendesk, llm, rag);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Zendesk webhook endpoint
app.post('/webhook/ticket', async (req: Request, res: Response) => {
  try {
    const { ticket } = req.body;
    console.log(`Processing ticket #${ticket.id}: ${ticket.subject}`);

    const result = await processor.process(ticket);

    res.json({
      success: true,
      ticketId: ticket.id,
      category: result.category,
      draftGenerated: result.hasDraft,
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Manual categorization endpoint
app.post('/api/categorize', async (req: Request, res: Response) => {
  try {
    const { ticketId, subject, description } = req.body;
    const category = await llm.categorize({ subject, description });
    
    res.json({ ticketId, category });
  } catch (error) {
    console.error('Categorization error:', error);
    res.status(500).json({ error: 'Categorization failed' });
  }
});

// Draft response endpoint
app.post('/api/draft', async (req: Request, res: Response) => {
  try {
    const { ticketId, subject, description, customerName } = req.body;
    
    // Retrieve relevant knowledge
    const context = await rag.retrieve(description);
    
    // Generate draft response
    const draft = await llm.generateDraft({
      subject,
      description,
      customerName,
      context,
    });

    res.json({ ticketId, draft });
  } catch (error) {
    console.error('Draft generation error:', error);
    res.status(500).json({ error: 'Draft generation failed' });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Zendesk AI Automation running on port ${PORT}`);
});

export default app;
