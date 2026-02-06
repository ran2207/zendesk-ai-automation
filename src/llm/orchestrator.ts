import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { 
  LLMProvider, 
  TicketCategory, 
  TICKET_CATEGORIES,
  CategorizeInput,
  DraftInput,
  DraftResponse,
  IntentAnalysis,
  KnowledgeResult
} from '../types';
import { logger } from '../utils/logger';
import { Errors } from '../middleware/errorHandler';

interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
}

/**
 * LLM Orchestrator for ticket analysis and response generation
 * Supports both OpenAI and Anthropic Claude
 */
export class LLMOrchestrator {
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private provider: LLMProvider;
  private model: string;

  constructor(config: LLMConfig) {
    this.provider = config.provider;
    
    if (config.provider === 'openai') {
      this.openai = new OpenAI({ apiKey: config.apiKey });
      this.model = config.model || 'gpt-4-turbo-preview';
    } else {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
      this.model = config.model || 'claude-3-sonnet-20240229';
    }

    logger.info(`LLM Orchestrator initialized`, { provider: this.provider, model: this.model });
  }

  /**
   * Categorize a ticket into predefined categories
   */
  async categorize(input: CategorizeInput): Promise<TicketCategory> {
    const prompt = `You are a support ticket classifier. Analyze this customer support ticket and categorize it.

## Ticket
Subject: ${input.subject}
Description: ${input.description}
${input.tags?.length ? `Existing Tags: ${input.tags.join(', ')}` : ''}

## Available Categories
${TICKET_CATEGORIES.map(c => `- ${c}: ${this.getCategoryDescription(c)}`).join('\n')}

## Instructions
1. Read the ticket carefully
2. Identify the primary concern
3. Match to the most appropriate category
4. If multiple categories apply, choose the most specific one

Respond with ONLY the category name (e.g., "billing" or "technical_support"), nothing else.`;

    const response = await this.complete(prompt, { maxTokens: 50, temperature: 0.1 });
    const category = response.trim().toLowerCase().replace(/[^a-z_]/g, '') as TicketCategory;
    
    if (TICKET_CATEGORIES.includes(category)) {
      logger.debug(`Categorized ticket as: ${category}`);
      return category;
    }

    logger.warn(`Invalid category response: "${response}", defaulting to general_inquiry`);
    return 'general_inquiry';
  }

  /**
   * Extract intent, urgency, and sentiment from ticket
   */
  async extractIntent(text: string): Promise<IntentAnalysis> {
    const prompt = `Analyze this customer support message and extract key information.

## Message
${text}

## Instructions
Analyze and provide:
1. intent: A brief description of what the customer wants (2-5 words)
2. urgency: low, medium, high, or critical based on:
   - low: general questions, no deadline
   - medium: needs attention but not time-sensitive
   - high: impacts customer's work, needs quick resolution
   - critical: system down, data loss, security issue
3. sentiment: positive, neutral, negative, or frustrated
4. keyEntities: Array of key terms (product names, features, error codes)

## Response Format
Respond with valid JSON only:
{"intent": "...", "urgency": "...", "sentiment": "...", "keyEntities": [...]}`;

    const response = await this.complete(prompt, { maxTokens: 200, temperature: 0.2 });
    
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      
      const parsed = JSON.parse(jsonMatch[0]) as IntentAnalysis;
      
      // Validate and normalize
      return {
        intent: parsed.intent || 'unknown',
        urgency: ['low', 'medium', 'high', 'critical'].includes(parsed.urgency) 
          ? parsed.urgency : 'medium',
        sentiment: ['positive', 'neutral', 'negative', 'frustrated'].includes(parsed.sentiment)
          ? parsed.sentiment : 'neutral',
        keyEntities: Array.isArray(parsed.keyEntities) ? parsed.keyEntities : [],
      };
    } catch (error) {
      logger.warn('Failed to parse intent analysis', { response, error });
      return { intent: 'unknown', urgency: 'medium', sentiment: 'neutral', keyEntities: [] };
    }
  }

  /**
   * Generate a draft response using RAG context
   */
  async generateDraft(input: DraftInput): Promise<DraftResponse> {
    const contextSection = this.formatContext(input.context);
    
    const prompt = `You are an expert customer support agent. Draft a professional response to this ticket.

## Customer Information
- Name: ${input.customerName}
- Sentiment: ${input.sentiment || 'unknown'}
- Category: ${input.category || 'unknown'}

## Ticket
Subject: ${input.subject}
Message: ${input.description}

${contextSection}

## Guidelines
1. Address the customer by name
2. Acknowledge their concern with empathy
3. Provide a clear, helpful response
4. If using knowledge base information, incorporate it naturally
5. Include specific next steps when applicable
6. Keep a professional but warm tone
7. End with an offer for further assistance

## Response Format
Respond with valid JSON:
{
  "draft": "The complete response to the customer",
  "confidence": 0.0-1.0 (how confident you are this addresses their needs),
  "suggestedTags": ["tag1", "tag2"],
  "requiresHumanReview": true/false,
  "reasoning": "Brief explanation of your approach"
}`;

    const response = await this.complete(prompt, { maxTokens: 1000, temperature: 0.5 });

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      
      const parsed = JSON.parse(jsonMatch[0]) as DraftResponse;
      
      return {
        draft: parsed.draft || response,
        confidence: Math.min(1, Math.max(0, parsed.confidence || 0.7)),
        suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags : [],
        requiresHumanReview: parsed.requiresHumanReview ?? true,
        reasoning: parsed.reasoning || '',
      };
    } catch (error) {
      // If JSON parsing fails, return the raw text as draft
      logger.warn('Failed to parse draft response as JSON, using raw text');
      return {
        draft: response,
        confidence: 0.5,
        suggestedTags: [],
        requiresHumanReview: true,
        reasoning: 'Auto-generated from raw LLM response',
      };
    }
  }

  /**
   * Summarize a long ticket thread
   */
  async summarizeThread(messages: string[]): Promise<string> {
    const prompt = `Summarize this customer support conversation thread concisely.

## Conversation
${messages.map((m, i) => `[Message ${i + 1}]: ${m}`).join('\n\n')}

## Instructions
Provide a brief summary (2-4 sentences) covering:
- The main issue
- Key points discussed
- Current status/resolution

Summary:`;

    return await this.complete(prompt, { maxTokens: 300, temperature: 0.3 });
  }

  /**
   * Core completion method supporting both providers
   */
  private async complete(
    prompt: string, 
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<string> {
    const { maxTokens = 1000, temperature = 0.3 } = options;

    try {
      if (this.provider === 'openai' && this.openai) {
        const response = await this.openai.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          max_tokens: maxTokens,
        });
        return response.choices[0]?.message?.content || '';
      } 
      
      if (this.anthropic) {
        const response = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        return response.content[0]?.type === 'text' ? response.content[0].text : '';
      }
      
      throw new Error('No LLM provider configured');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown LLM error';
      logger.error('LLM completion failed', { provider: this.provider, error: message });
      throw Errors.llmError(message);
    }
  }

  /**
   * Format RAG context for inclusion in prompts
   */
  private formatContext(context: KnowledgeResult[]): string {
    if (!context || context.length === 0) {
      return '## Knowledge Base\nNo relevant articles found. Rely on general knowledge.';
    }

    const articles = context
      .slice(0, 5) // Limit to top 5
      .map((c, i) => {
        const title = c.title ? `**${c.title}**\n` : '';
        const url = c.url ? `\nSource: ${c.url}` : '';
        return `### Article ${i + 1} (relevance: ${Math.round(c.score * 100)}%)\n${title}${c.text}${url}`;
      })
      .join('\n\n');

    return `## Knowledge Base Context\nUse these relevant articles to inform your response:\n\n${articles}`;
  }

  /**
   * Get human-readable category descriptions
   */
  private getCategoryDescription(category: TicketCategory): string {
    const descriptions: Record<TicketCategory, string> = {
      billing: 'Payment, invoices, charges, pricing, subscriptions',
      technical_support: 'Bugs, errors, troubleshooting, how-to questions',
      account_management: 'Login issues, profile changes, permissions',
      feature_request: 'New feature suggestions, enhancements',
      bug_report: 'Software bugs, unexpected behavior',
      general_inquiry: 'General questions, information requests',
      cancellation: 'Account or subscription cancellation',
      refund: 'Refund requests, money back',
      onboarding: 'Getting started, setup, initial configuration',
      integration: 'API, webhooks, third-party connections',
      security: 'Security concerns, data privacy, access issues',
    };
    return descriptions[category] || category;
  }

  /**
   * Verify LLM connection
   */
  async verifyConnection(): Promise<{ success: boolean; provider: string; model: string }> {
    try {
      await this.complete('Say "ok"', { maxTokens: 10 });
      return { success: true, provider: this.provider, model: this.model };
    } catch {
      return { success: false, provider: this.provider, model: this.model };
    }
  }
}
