import axios, { AxiosInstance, AxiosError } from 'axios';
import { ZendeskTicket, TicketUpdate } from '../types';
import { logger } from '../utils/logger';
import { Errors } from '../middleware/errorHandler';

interface ZendeskConfig {
  subdomain: string;
  email: string;
  token: string;
}

interface SearchResult {
  results: ZendeskTicket[];
  count: number;
  next_page: string | null;
}

interface TicketComment {
  id: number;
  body: string;
  html_body: string;
  public: boolean;
  author_id: number;
  created_at: string;
}

/**
 * Zendesk API client with full CRUD operations
 */
export class ZendeskClient {
  private client: AxiosInstance;
  private subdomain: string;

  constructor(config: ZendeskConfig) {
    this.subdomain = config.subdomain;
    this.client = axios.create({
      baseURL: `https://${config.subdomain}.zendesk.com/api/v2`,
      auth: {
        username: `${config.email}/token`,
        password: config.token,
      },
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    });

    // Request interceptor for logging
    this.client.interceptors.request.use((config) => {
      logger.debug(`Zendesk API: ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const status = error.response?.status;
        const message = (error.response?.data as { error?: string })?.error || error.message;
        
        logger.error('Zendesk API error', { 
          status, 
          message, 
          url: error.config?.url 
        });

        if (status === 401) {
          throw Errors.unauthorized('Invalid Zendesk credentials');
        }
        if (status === 404) {
          throw Errors.notFound('Zendesk resource');
        }
        if (status === 429) {
          const retryAfter = parseInt(error.response?.headers['retry-after'] || '60', 10);
          throw Errors.rateLimit(retryAfter);
        }
        
        throw Errors.zendeskError(message);
      }
    );
  }

  /**
   * Get a single ticket by ID
   */
  async getTicket(ticketId: number): Promise<ZendeskTicket> {
    const response = await this.client.get(`/tickets/${ticketId}.json`);
    return response.data.ticket;
  }

  /**
   * Get multiple tickets by IDs
   */
  async getTickets(ticketIds: number[]): Promise<ZendeskTicket[]> {
    const ids = ticketIds.join(',');
    const response = await this.client.get(`/tickets/show_many.json?ids=${ids}`);
    return response.data.tickets;
  }

  /**
   * Update a ticket
   */
  async updateTicket(ticketId: number, update: TicketUpdate): Promise<ZendeskTicket> {
    const response = await this.client.put(`/tickets/${ticketId}.json`, {
      ticket: update,
    });
    logger.info(`Updated ticket #${ticketId}`, { fields: Object.keys(update) });
    return response.data.ticket;
  }

  /**
   * Add an internal note (not visible to customer)
   */
  async addInternalNote(ticketId: number, note: string): Promise<void> {
    await this.updateTicket(ticketId, {
      comment: { body: note, public: false },
    });
    logger.info(`Added internal note to ticket #${ticketId}`);
  }

  /**
   * Add a public reply (visible to customer)
   */
  async addPublicReply(ticketId: number, body: string): Promise<void> {
    await this.updateTicket(ticketId, {
      comment: { body, public: true },
    });
    logger.info(`Added public reply to ticket #${ticketId}`);
  }

  /**
   * Add an AI-generated draft response as internal note
   */
  async addDraftResponse(ticketId: number, draft: string, metadata?: {
    category?: string;
    confidence?: number;
    sources?: string[];
  }): Promise<void> {
    let note = `📝 **AI Draft Response**\n\n${draft}`;
    
    if (metadata) {
      note += '\n\n---\n*AI Metadata:*';
      if (metadata.category) note += `\n• Category: ${metadata.category}`;
      if (metadata.confidence) note += `\n• Confidence: ${Math.round(metadata.confidence * 100)}%`;
      if (metadata.sources?.length) note += `\n• Sources: ${metadata.sources.join(', ')}`;
    }
    
    await this.addInternalNote(ticketId, note);
  }

  /**
   * Set a custom field value (e.g., category)
   */
  async setCustomField(ticketId: number, fieldId: number, value: string): Promise<void> {
    await this.updateTicket(ticketId, {
      custom_fields: [{ id: fieldId, value }],
    });
    logger.debug(`Set custom field ${fieldId} on ticket #${ticketId}`);
  }

  /**
   * Add tags to a ticket (merges with existing)
   */
  async addTags(ticketId: number, tags: string[]): Promise<string[]> {
    const ticket = await this.getTicket(ticketId);
    const existingTags = ticket.tags || [];
    const newTags = [...new Set([...existingTags, ...tags])];
    
    if (newTags.length !== existingTags.length) {
      await this.updateTicket(ticketId, { tags: newTags });
      logger.info(`Added tags to ticket #${ticketId}`, { addedTags: tags });
    }
    
    return newTags;
  }

  /**
   * Remove tags from a ticket
   */
  async removeTags(ticketId: number, tagsToRemove: string[]): Promise<string[]> {
    const ticket = await this.getTicket(ticketId);
    const newTags = (ticket.tags || []).filter(t => !tagsToRemove.includes(t));
    
    await this.updateTicket(ticketId, { tags: newTags });
    return newTags;
  }

  /**
   * Set ticket priority
   */
  async setPriority(ticketId: number, priority: 'low' | 'normal' | 'high' | 'urgent'): Promise<void> {
    await this.updateTicket(ticketId, { priority });
    logger.info(`Set priority for ticket #${ticketId} to ${priority}`);
  }

  /**
   * Get ticket comments/conversation
   */
  async getComments(ticketId: number): Promise<TicketComment[]> {
    const response = await this.client.get(`/tickets/${ticketId}/comments.json`);
    return response.data.comments;
  }

  /**
   * Search tickets with query
   */
  async searchTickets(query: string, page = 1): Promise<SearchResult> {
    const response = await this.client.get('/search.json', {
      params: { query: `type:ticket ${query}`, page },
    });
    return response.data;
  }

  /**
   * Get recent tickets (new/open)
   */
  async getRecentTickets(status?: string, limit = 25): Promise<ZendeskTicket[]> {
    const query = status ? `status:${status}` : 'status:new status:open';
    const result = await this.searchTickets(query);
    return result.results.slice(0, limit);
  }

  /**
   * Verify API connection
   */
  async verifyConnection(): Promise<{ success: boolean; subdomain: string; message: string }> {
    try {
      await this.client.get('/users/me.json');
      return { 
        success: true, 
        subdomain: this.subdomain,
        message: 'Connected to Zendesk API'
      };
    } catch (error) {
      return { 
        success: false, 
        subdomain: this.subdomain,
        message: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }
}
