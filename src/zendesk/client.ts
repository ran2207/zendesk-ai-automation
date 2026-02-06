import axios, { AxiosInstance } from 'axios';

interface ZendeskConfig {
  subdomain: string;
  email: string;
  token: string;
}

interface Ticket {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string;
  tags: string[];
}

interface TicketUpdate {
  comment?: { body: string; public?: boolean };
  status?: string;
  priority?: string;
  tags?: string[];
  custom_fields?: Array<{ id: number; value: string }>;
}

export class ZendeskClient {
  private client: AxiosInstance;

  constructor(config: ZendeskConfig) {
    this.client = axios.create({
      baseURL: `https://${config.subdomain}.zendesk.com/api/v2`,
      auth: {
        username: `${config.email}/token`,
        password: config.token,
      },
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async getTicket(ticketId: number): Promise<Ticket> {
    const response = await this.client.get(`/tickets/${ticketId}.json`);
    return response.data.ticket;
  }

  async updateTicket(ticketId: number, update: TicketUpdate): Promise<Ticket> {
    const response = await this.client.put(`/tickets/${ticketId}.json`, {
      ticket: update,
    });
    return response.data.ticket;
  }

  async addInternalNote(ticketId: number, note: string): Promise<void> {
    await this.updateTicket(ticketId, {
      comment: { body: note, public: false },
    });
  }

  async addDraftResponse(ticketId: number, draft: string): Promise<void> {
    // Add as internal note with draft prefix
    await this.addInternalNote(ticketId, `📝 AI Draft Response:\n\n${draft}`);
  }

  async setCategory(ticketId: number, category: string, fieldId: number): Promise<void> {
    await this.updateTicket(ticketId, {
      custom_fields: [{ id: fieldId, value: category }],
    });
  }

  async addTags(ticketId: number, tags: string[]): Promise<void> {
    const ticket = await this.getTicket(ticketId);
    const existingTags = ticket.tags || [];
    const newTags = [...new Set([...existingTags, ...tags])];
    
    await this.updateTicket(ticketId, { tags: newTags });
  }
}
