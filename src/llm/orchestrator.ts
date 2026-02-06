import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

interface LLMConfig {
  provider: 'openai' | 'anthropic';
  apiKey: string;
}

interface CategorizeInput {
  subject: string;
  description: string;
}

interface DraftInput {
  subject: string;
  description: string;
  customerName: string;
  context: string[];
}

const CATEGORIES = [
  'billing',
  'technical_support',
  'account_management',
  'feature_request',
  'bug_report',
  'general_inquiry',
  'cancellation',
  'refund',
] as const;

type Category = typeof CATEGORIES[number];

export class LLMOrchestrator {
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private provider: 'openai' | 'anthropic';

  constructor(config: LLMConfig) {
    this.provider = config.provider;
    
    if (config.provider === 'openai') {
      this.openai = new OpenAI({ apiKey: config.apiKey });
    } else {
      this.anthropic = new Anthropic({ apiKey: config.apiKey });
    }
  }

  async categorize(input: CategorizeInput): Promise<Category> {
    const prompt = `Analyze this support ticket and categorize it.

Subject: ${input.subject}
Description: ${input.description}

Available categories: ${CATEGORIES.join(', ')}

Respond with ONLY the category name, nothing else.`;

    const response = await this.complete(prompt);
    const category = response.trim().toLowerCase() as Category;
    
    return CATEGORIES.includes(category) ? category : 'general_inquiry';
  }

  async generateDraft(input: DraftInput): Promise<string> {
    const contextSection = input.context.length > 0
      ? `Relevant knowledge base articles:\n${input.context.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n`
      : '';

    const prompt = `You are a helpful customer support agent. Draft a professional, empathetic response to this ticket.

${contextSection}Customer: ${input.customerName}
Subject: ${input.subject}
Message: ${input.description}

Guidelines:
- Be professional and empathetic
- Address their specific concern
- Use the knowledge base context if relevant
- Keep the response concise but complete
- End with a clear next step or offer for further assistance

Draft the response:`;

    return await this.complete(prompt);
  }

  async extractIntent(text: string): Promise<{ intent: string; urgency: 'low' | 'medium' | 'high' }> {
    const prompt = `Analyze this customer message and extract:
1. Primary intent (what they want)
2. Urgency level (low/medium/high)

Message: ${text}

Respond in JSON format: {"intent": "...", "urgency": "..."}`;

    const response = await this.complete(prompt);
    
    try {
      return JSON.parse(response);
    } catch {
      return { intent: 'unknown', urgency: 'medium' };
    }
  }

  private async complete(prompt: string): Promise<string> {
    if (this.provider === 'openai' && this.openai) {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1000,
      });
      return response.choices[0]?.message?.content || '';
    } else if (this.anthropic) {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });
      return response.content[0]?.type === 'text' ? response.content[0].text : '';
    }
    
    throw new Error('No LLM provider configured');
  }
}
