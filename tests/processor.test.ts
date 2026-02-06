import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TicketProcessor } from '../src/processor';
import { ZendeskClient } from '../src/zendesk/client';
import { LLMOrchestrator } from '../src/llm/orchestrator';
import { RAGService } from '../src/rag/service';

// Mock the dependencies
vi.mock('../src/zendesk/client');
vi.mock('../src/llm/orchestrator');
vi.mock('../src/rag/service');
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    timed: vi.fn((name, fn) => fn()),
  },
}));

describe('TicketProcessor', () => {
  let processor: TicketProcessor;
  let mockZendesk: jest.Mocked<ZendeskClient>;
  let mockLLM: jest.Mocked<LLMOrchestrator>;
  let mockRAG: jest.Mocked<RAGService>;

  const sampleTicket = {
    id: 12345,
    subject: 'Cannot login to my account',
    description: 'I\'ve been trying to login for the past hour but keep getting an error. This is urgent as I need to access my data.',
    requester: { name: 'John Doe', email: 'john@example.com' },
    tags: ['vip'],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockZendesk = {
      getTicket: vi.fn(),
      addTags: vi.fn().mockResolvedValue([]),
      addDraftResponse: vi.fn().mockResolvedValue(undefined),
      setCustomField: vi.fn().mockResolvedValue(undefined),
      setPriority: vi.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ZendeskClient>;

    mockLLM = {
      categorize: vi.fn().mockResolvedValue('account_management'),
      extractIntent: vi.fn().mockResolvedValue({
        intent: 'login help',
        urgency: 'high',
        sentiment: 'frustrated',
        keyEntities: ['login', 'error'],
      }),
      generateDraft: vi.fn().mockResolvedValue({
        draft: 'Hi John, I understand you\'re having trouble logging in...',
        confidence: 0.85,
        suggestedTags: ['login_issue'],
        requiresHumanReview: false,
        reasoning: 'Clear login issue with relevant KB article found',
      }),
    } as unknown as jest.Mocked<LLMOrchestrator>;

    mockRAG = {
      retrieve: vi.fn().mockResolvedValue([]),
      hybridSearch: vi.fn().mockResolvedValue([
        {
          id: 'kb-001',
          text: 'To reset your password, go to the login page and click "Forgot Password"',
          title: 'Password Reset Guide',
          score: 0.92,
        },
      ]),
    } as unknown as jest.Mocked<RAGService>;

    processor = new TicketProcessor(mockZendesk, mockLLM, mockRAG, {
      addDraftToTicket: true,
      addTagsToTicket: true,
    });
  });

  describe('process()', () => {
    it('should categorize the ticket', async () => {
      const result = await processor.process(sampleTicket);

      expect(mockLLM.categorize).toHaveBeenCalledWith({
        subject: sampleTicket.subject,
        description: sampleTicket.description,
        tags: sampleTicket.tags,
      });
      expect(result.category).toBe('account_management');
    });

    it('should extract intent and urgency', async () => {
      const result = await processor.process(sampleTicket);

      expect(mockLLM.extractIntent).toHaveBeenCalledWith(sampleTicket.description);
      expect(result.intent.urgency).toBe('high');
      expect(result.intent.sentiment).toBe('frustrated');
    });

    it('should retrieve relevant knowledge', async () => {
      const result = await processor.process(sampleTicket);

      expect(mockRAG.hybridSearch).toHaveBeenCalled();
      expect(result.relevantKnowledge).toHaveLength(1);
      expect(result.relevantKnowledge[0].title).toBe('Password Reset Guide');
    });

    it('should generate draft response', async () => {
      const result = await processor.process(sampleTicket);

      expect(mockLLM.generateDraft).toHaveBeenCalled();
      expect(result.draftResponse).not.toBeNull();
      expect(result.draftResponse?.confidence).toBe(0.85);
    });

    it('should add tags to ticket', async () => {
      await processor.process(sampleTicket);

      // Wait for async tag addition
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockZendesk.addTags).toHaveBeenCalledWith(
        sampleTicket.id,
        expect.arrayContaining([
          'ai_category:account_management',
          'ai_urgency:high',
          'ai_sentiment:frustrated',
          'ai_processed',
        ])
      );
    });

    it('should add draft to ticket when confidence is high', async () => {
      await processor.process(sampleTicket);

      expect(mockZendesk.addDraftResponse).toHaveBeenCalledWith(
        sampleTicket.id,
        expect.stringContaining('John'),
        expect.objectContaining({
          category: 'account_management',
          confidence: 0.85,
        })
      );
    });

    it('should not add draft when confidence is low', async () => {
      mockLLM.generateDraft.mockResolvedValueOnce({
        draft: 'Low confidence draft',
        confidence: 0.4,
        suggestedTags: [],
        requiresHumanReview: true,
        reasoning: 'Not enough context',
      });

      processor = new TicketProcessor(mockZendesk, mockLLM, mockRAG, {
        addDraftToTicket: true,
        minConfidenceForDraft: 0.6,
      });

      await processor.process(sampleTicket);

      expect(mockZendesk.addDraftResponse).not.toHaveBeenCalled();
    });

    it('should include processing time in result', async () => {
      const result = await processor.process(sampleTicket);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.processingTimeMs).toBe('number');
    });

    it('should handle errors gracefully', async () => {
      mockLLM.categorize.mockRejectedValueOnce(new Error('LLM unavailable'));

      const result = await processor.process(sampleTicket);

      expect(result.error).toBe('LLM unavailable');
      expect(result.category).toBe('general_inquiry'); // Default
    });
  });

  describe('processBatch()', () => {
    it('should process multiple tickets', async () => {
      const tickets = [
        { ...sampleTicket, id: 1 },
        { ...sampleTicket, id: 2 },
        { ...sampleTicket, id: 3 },
      ];

      const results = await processor.processBatch(tickets, 2);

      expect(results).toHaveLength(3);
      expect(mockLLM.categorize).toHaveBeenCalledTimes(3);
    });
  });
});
