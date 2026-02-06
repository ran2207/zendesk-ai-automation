import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

interface RAGConfig {
  pineconeApiKey: string;
  indexName: string;
  openaiApiKey?: string;
}

interface Document {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export class RAGService {
  private pinecone: Pinecone;
  private indexName: string;
  private openai: OpenAI;

  constructor(config: RAGConfig) {
    this.pinecone = new Pinecone({ apiKey: config.pineconeApiKey });
    this.indexName = config.indexName;
    this.openai = new OpenAI({ apiKey: config.openaiApiKey || process.env.OPENAI_API_KEY });
  }

  async retrieve(query: string, topK: number = 5): Promise<string[]> {
    try {
      // Generate embedding for query
      const embedding = await this.embed(query);
      
      // Query Pinecone
      const index = this.pinecone.index(this.indexName);
      const results = await index.query({
        vector: embedding,
        topK,
        includeMetadata: true,
      });

      // Extract and return text content
      return results.matches
        ?.filter((match) => match.score && match.score > 0.7)
        ?.map((match) => match.metadata?.text as string)
        ?.filter(Boolean) || [];
    } catch (error) {
      console.error('RAG retrieval error:', error);
      return [];
    }
  }

  async indexDocuments(documents: Document[]): Promise<void> {
    const index = this.pinecone.index(this.indexName);
    
    const vectors = await Promise.all(
      documents.map(async (doc) => ({
        id: doc.id,
        values: await this.embed(doc.text),
        metadata: { text: doc.text, ...doc.metadata },
      }))
    );

    // Upsert in batches of 100
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await index.upsert(batch);
    }
  }

  private async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }
}
