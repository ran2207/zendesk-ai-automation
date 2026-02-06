# 🎫 Zendesk AI Automation

AI-powered Zendesk ticket automation with LLM categorization, RAG knowledge retrieval, and intelligent response drafting.

## ✨ Features

- **🏷️ Smart Categorization** - Automatic ticket classification using LLMs
- **📚 RAG Knowledge Retrieval** - Context-aware responses from your knowledge base
- **✍️ Response Drafting** - AI-generated professional reply suggestions
- **🔄 Webhook Integration** - Real-time ticket processing
- **📊 Analytics Dashboard** - Track automation performance

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Zendesk Instance                            │
│                              │                                      │
│                    ┌─────────▼─────────┐                           │
│                    │   Webhook Trigger  │                           │
│                    └─────────┬─────────┘                           │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AI Automation Service                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   Express   │───▶│   Ticket    │───▶│    LLM Orchestrator     │ │
│  │   Server    │    │   Parser    │    │  (OpenAI / Claude API)  │ │
│  └─────────────┘    └─────────────┘    └───────────┬─────────────┘ │
│                                                     │               │
│  ┌─────────────────────────────────────────────────┼───────────┐   │
│  │                        │                         │           │   │
│  ▼                        ▼                         ▼           │   │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐      │   │
│  │Categorize│    │ RAG Retrieval│    │ Response Generator│      │   │
│  │  Agent   │    │    Agent     │    │      Agent        │      │   │
│  └────┬─────┘    └──────┬───────┘    └─────────┬─────────┘      │   │
│       │                 │                      │                │   │
│       └─────────────────┼──────────────────────┘                │   │
│                         ▼                                       │   │
│              ┌──────────────────┐                               │   │
│              │  Zendesk API     │                               │   │
│              │  (Update Ticket) │                               │   │
│              └──────────────────┘                               │   │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Vector Database                               │
│                    (Pinecone / Qdrant)                             │
│         ┌─────────────────────────────────────────┐                │
│         │  Knowledge Base Embeddings               │                │
│         │  • Help Articles  • FAQ  • Past Tickets │                │
│         └─────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ with TypeScript |
| LLM Provider | OpenAI GPT-4 / Anthropic Claude |
| Vector Store | Pinecone / Qdrant |
| Embeddings | OpenAI text-embedding-3-small |
| API Framework | Express.js |
| Zendesk | REST API v2 |

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/ran2207/zendesk-ai-automation.git
cd zendesk-ai-automation

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run development server
npm run dev

# Build for production
npm run build
npm start
```

## ⚙️ Configuration

Copy `.env.example` to `.env` and configure:

```env
# Zendesk Configuration
ZENDESK_SUBDOMAIN=your-subdomain
ZENDESK_EMAIL=your-email@company.com
ZENDESK_API_TOKEN=your-api-token

# LLM Configuration
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
LLM_PROVIDER=openai  # or 'anthropic'

# Vector Database
PINECONE_API_KEY=your-pinecone-key
PINECONE_INDEX=zendesk-knowledge
```

## 🚀 Usage

### Webhook Setup

1. Go to Zendesk Admin → Extensions → Webhooks
2. Create webhook pointing to `https://your-server.com/webhook/ticket`
3. Create trigger for new tickets → send to webhook

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/ticket` | POST | Receive Zendesk ticket webhooks |
| `/api/categorize` | POST | Manually categorize a ticket |
| `/api/draft` | POST | Generate response draft |
| `/health` | GET | Health check |

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.
