import { config as dotenvConfig } from 'dotenv';
import { AppConfig, LLMProvider } from '../types';

// Load environment variables
dotenvConfig();

/**
 * Validate and load application configuration from environment variables
 */
function loadConfig(): AppConfig {
  const missingVars: string[] = [];

  const required = (name: string, defaultValue?: string): string => {
    const value = process.env[name] || defaultValue;
    if (!value) {
      missingVars.push(name);
      return '';
    }
    return value;
  };

  const optional = (name: string, defaultValue = ''): string => {
    return process.env[name] || defaultValue;
  };

  const llmProvider = (process.env.LLM_PROVIDER || 'openai') as LLMProvider;
  const llmApiKey = llmProvider === 'openai' 
    ? required('OPENAI_API_KEY')
    : required('ANTHROPIC_API_KEY');

  const config: AppConfig = {
    zendesk: {
      subdomain: required('ZENDESK_SUBDOMAIN'),
      email: required('ZENDESK_EMAIL'),
      token: required('ZENDESK_API_TOKEN'),
      webhookSecret: optional('ZENDESK_WEBHOOK_SECRET'),
      categoryFieldId: process.env.ZENDESK_CATEGORY_FIELD_ID 
        ? parseInt(process.env.ZENDESK_CATEGORY_FIELD_ID, 10) 
        : undefined,
    },
    llm: {
      provider: llmProvider,
      apiKey: llmApiKey,
      model: optional('LLM_MODEL'),
    },
    rag: {
      pineconeApiKey: required('PINECONE_API_KEY'),
      indexName: required('PINECONE_INDEX', 'zendesk-knowledge'),
      openaiApiKey: optional('OPENAI_API_KEY'), // For embeddings
      namespace: optional('PINECONE_NAMESPACE', 'default'),
    },
    server: {
      port: parseInt(process.env.PORT || '3000', 10),
      nodeEnv: process.env.NODE_ENV || 'development',
    },
  };

  // Warn about missing variables but don't fail in development
  if (missingVars.length > 0) {
    console.warn('⚠️  Missing environment variables:', missingVars.join(', '));
    console.warn('   Copy .env.example to .env and fill in the values');
    
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  return config;
}

export const appConfig = loadConfig();
