/**
 * Core type definitions for Zendesk AI Automation
 */

// Zendesk Types
export interface ZendeskTicket {
  id: number;
  subject: string;
  description: string;
  status: 'new' | 'open' | 'pending' | 'hold' | 'solved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent' | null;
  tags: string[];
  requester_id: number;
  assignee_id: number | null;
  created_at: string;
  updated_at: string;
  custom_fields: Array<{ id: number; value: string | null }>;
}

export interface ZendeskRequester {
  id: number;
  name: string;
  email: string;
}

export interface ZendeskWebhookPayload {
  ticket: {
    id: number;
    subject: string;
    description: string;
    status: string;
    priority: string;
    tags: string[];
    requester: ZendeskRequester;
  };
  current_user?: {
    id: number;
    name: string;
    email: string;
  };
}

export interface TicketUpdate {
  comment?: { body: string; public?: boolean; author_id?: number };
  status?: string;
  priority?: string;
  tags?: string[];
  custom_fields?: Array<{ id: number; value: string }>;
  assignee_id?: number;
}

// LLM Types
export type LLMProvider = 'openai' | 'anthropic';

export const TICKET_CATEGORIES = [
  'billing',
  'technical_support', 
  'account_management',
  'feature_request',
  'bug_report',
  'general_inquiry',
  'cancellation',
  'refund',
  'onboarding',
  'integration',
  'security',
] as const;

export type TicketCategory = typeof TICKET_CATEGORIES[number];

export type UrgencyLevel = 'low' | 'medium' | 'high' | 'critical';

export interface IntentAnalysis {
  intent: string;
  urgency: UrgencyLevel;
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  keyEntities: string[];
}

export interface CategorizeInput {
  subject: string;
  description: string;
  tags?: string[];
}

export interface DraftInput {
  subject: string;
  description: string;
  customerName: string;
  context: KnowledgeResult[];
  category?: TicketCategory;
  sentiment?: string;
}

export interface DraftResponse {
  draft: string;
  confidence: number;
  suggestedTags: string[];
  requiresHumanReview: boolean;
  reasoning: string;
}

// RAG Types
export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  category?: string;
  url?: string;
  lastUpdated?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeResult {
  id: string;
  text: string;
  title?: string;
  score: number;
  url?: string;
}

export interface RAGConfig {
  pineconeApiKey: string;
  indexName: string;
  openaiApiKey?: string;
  namespace?: string;
}

// Processing Types
export interface ProcessingResult {
  ticketId: number;
  category: TicketCategory;
  intent: IntentAnalysis;
  relevantKnowledge: KnowledgeResult[];
  draftResponse: DraftResponse | null;
  processingTimeMs: number;
  error?: string;
}

// API Response Types
export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

// Configuration Types
export interface AppConfig {
  zendesk: {
    subdomain: string;
    email: string;
    token: string;
    webhookSecret?: string;
    categoryFieldId?: number;
  };
  llm: {
    provider: LLMProvider;
    apiKey: string;
    model?: string;
  };
  rag: RAGConfig;
  server: {
    port: number;
    nodeEnv: string;
  };
}
