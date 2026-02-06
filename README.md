# 🎫 Zendesk AI Automation

AI-powered Zendesk ticket automation with LLM categorization, RAG knowledge retrieval, and intelligent response drafting.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 🎯 Features

- **🏷️ Automatic Ticket Categorization** - LLM-based classification into billing, technical support, account management, etc.
- **🎭 Sentiment & Intent Analysis** - Detect customer mood and urgency for prioritization
- **📚 RAG Knowledge Retrieval** - Find relevant KB articles using semantic search (Pinecone)
- **✍️ Smart Draft Responses** - Context-aware response generation with confidence scoring
- **🔌 Zendesk Webhook Integration** - Real-time processing of incoming tickets
- **🔒 Secure & Scalable** - Rate limiting, webhook validation, structured error handling

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Zendesk       │────▶│   Express API    │────▶│   LLM Provider  │
│   Webhooks      │     │   (Node.js)      │     │  (OpenAI/Claude)│
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │   RAG Service    │
                        │   (Pinecone +    │
                        │   Embeddings)    │
                        └──────────────────┘
```

### Processing Pipeline

1. **Webhook Receives Ticket** → Validates signature, parses payload
2. **Categorization** → LLM classifies ticket into predefined categories
3. **Intent Extraction** → Extracts urgency, sentiment, and key entities
4. **Knowledge Retrieval** → Semantic + keyword search in vector DB
5. **Draft Generation** → LLM generates context-aware response
6. **Ticket Update** → Adds tags, draft note, and priority to Zendesk

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Zendesk account with API access
- OpenAI API key or Anthropic API key
- Pinecone account (free tier works)

### Installation

```bash
# Clone the repository
git clone https://github.com/ran2207/zendesk-ai-automation.git
cd zendesk-ai-automation

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Configuration

```env
# Required
ZENDESK_SUBDOMAIN=your-subdomain
ZENDESK_EMAIL=admin@company.com
ZENDESK_API_TOKEN=your-token

LLM_PROVIDER=openai  # or 'anthropic'
OPENAI_API_KEY=sk-...

PINECONE_API_KEY=your-pinecone-key
PINECONE_INDEX=zendesk-knowledge
```

### Running

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start

# Run tests
npm test
```

## 📡 API Reference

### Webhook Endpoints

#### `POST /webhook/ticket`
Zendesk webhook endpoint for incoming tickets. Processes asynchronously.

```json
// Request (from Zendesk)
{
  "ticket": {
    "id": 12345,
    "subject": "Cannot login to my account",
    "description": "I've been trying to login...",
    "requester": { "name": "John", "email": "john@example.com" }
  }
}

// Response
{
  "success": true,
  "ticketId": 12345,
  "message": "Ticket received and processing started"
}
```

#### `POST /webhook/ticket/sync`
Synchronous version that waits for processing to complete.

### API Endpoints

#### `POST /api/categorize`
Categorize a ticket without updating Zendesk.

```json
// Request
{ "subject": "Billing question", "description": "Why was I charged?" }

// Response
{
  "category": "billing",
  "intent": "payment inquiry",
  "urgency": "medium",
  "sentiment": "neutral",
  "keyEntities": ["charge", "billing"]
}
```

#### `POST /api/draft`
Generate a draft response with RAG context.

```json
// Request
{
  "subject": "Feature not working",
  "description": "The export button doesn't work",
  "customerName": "Jane"
}

// Response
{
  "draft": "Hi Jane, I understand the export feature isn't working...",
  "confidence": 0.85,
  "suggestedTags": ["export_issue"],
  "requiresHumanReview": false,
  "sourcesUsed": 2
}
```

#### `POST /api/analyze`
Full analysis without Zendesk update.

#### `GET /api/kb/search?q=query`
Search the knowledge base directly.

### Admin Endpoints

#### `POST /admin/kb/index`
Index documents into the knowledge base.

```json
{
  "documents": [
    {
      "id": "kb-001",
      "title": "Password Reset Guide",
      "content": "To reset your password...",
      "category": "account",
      "url": "https://help.example.com/password-reset"
    }
  ]
}
```

#### `GET /admin/kb/stats`
Get knowledge base statistics.

#### `POST /admin/ticket/:id/reprocess`
Reprocess a specific ticket.

## 🛠️ Development

### Project Structure

```
src/
├── index.ts           # Express app & routes
├── processor.ts       # Main ticket processing pipeline
├── types/
│   └── index.ts       # TypeScript interfaces
├── zendesk/
│   └── client.ts      # Zendesk API client
├── llm/
│   └── orchestrator.ts # LLM provider abstraction
├── rag/
│   └── service.ts     # Pinecone RAG service
├── middleware/
│   ├── webhookValidator.ts
│   └── errorHandler.ts
└── utils/
    ├── config.ts      # Environment configuration
    └── logger.ts      # Structured logging
```

### Running Tests

```bash
npm test              # Run once
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

### Type Checking

```bash
npm run typecheck
```

## 🔧 Zendesk Setup

### Creating a Webhook

1. Go to **Admin Center** → **Apps and integrations** → **Webhooks**
2. Click **Create webhook**
3. Configure:
   - **Endpoint URL**: `https://your-server.com/webhook/ticket`
   - **Request method**: POST
   - **Request format**: JSON
4. (Optional) Enable **Signing secret** for security

### Creating a Trigger

1. Go to **Admin Center** → **Business rules** → **Triggers**
2. Create a new trigger:
   - **Name**: AI Automation
   - **Conditions**: `Ticket is Created`
   - **Actions**: `Notify webhook` → Select your webhook

### Webhook Payload Template

```json
{
  "ticket": {
    "id": "{{ticket.id}}",
    "subject": "{{ticket.title}}",
    "description": "{{ticket.description}}",
    "status": "{{ticket.status}}",
    "priority": "{{ticket.priority}}",
    "tags": "{{ticket.tags}}",
    "requester": {
      "name": "{{ticket.requester.name}}",
      "email": "{{ticket.requester.email}}"
    }
  }
}
```

## 🧠 AI Tools Used in Development

This project was built using modern AI-assisted development tools:

### Claude Code (Anthropic)
- **Architecture Design** - Designed the processing pipeline and service abstractions
- **Code Generation** - Generated TypeScript interfaces, Express routes, and service implementations
- **Error Handling** - Implemented comprehensive error handling patterns
- **Test Writing** - Created unit tests with proper mocking strategies

### Development Patterns Applied

1. **Structured Prompting** - LLM prompts use clear sections (context, instructions, format)
2. **Graceful Degradation** - RAG failures don't break the pipeline
3. **Confidence Scoring** - Draft responses include confidence for human review decisions
4. **Hybrid Search** - Combines semantic embeddings with keyword boosting
5. **Async Processing** - Webhooks respond immediately, process in background

### Lessons Learned

- **Prompt Engineering Matters** - Well-structured prompts significantly improve categorization accuracy
- **Always Validate LLM Output** - Parse JSON with fallbacks, validate enums
- **Rate Limiting is Essential** - Both for API protection and external service limits
- **Logging Enables Debugging** - Structured logs with context make troubleshooting easier

## 📊 Monitoring

The application logs structured JSON in production:

```json
{
  "level": "info",
  "message": "Ticket #12345 processed",
  "timestamp": "2024-01-15T10:30:00Z",
  "context": {
    "category": "technical_support",
    "processingTimeMs": 2341
  }
}
```

### Health Checks

- `GET /health` - Simple liveness check
- `GET /health/detailed` - Checks all service connections

## 🔒 Security Considerations

1. **Webhook Validation** - Enable ZENDESK_WEBHOOK_SECRET for signature verification
2. **Rate Limiting** - Built-in rate limiting (100 req/min per IP)
3. **Input Sanitization** - All inputs are validated and sanitized
4. **Error Masking** - Production errors don't leak stack traces
5. **API Token Security** - Never log or expose API tokens

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines and submit PRs.

---

Built with ❤️ using AI-assisted development (Claude Code, OpenClaw patterns)
