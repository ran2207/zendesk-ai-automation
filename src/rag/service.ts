import { Pinecone, Index, RecordMetadata } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { RAGConfig, KnowledgeDocument, KnowledgeResult } from '../types';
import { logger } from '../utils/logger';
import { Errors } from '../middleware/errorHandler';

interface VectorMetadata extends RecordMetadata {
  text: string;
  title: string;
  category: string;
  url: string;
  lastUpdated: string;
  [key: string]: string | number | boolean | string[];
}

/**
 * RAG (Retrieval-Augmented Generation) Service
 * Handles knowledge base indexing and retrieval using Pinecone + OpenAI embeddings
 */
export class RAGService {
  private pinecone: Pinecone;
  private indexName: string;
  private namespace: string;
  private openai: OpenAI;
  private embeddingModel = 'text-embedding-3-small';
  private embeddingDimension = 1536;

  constructor(config: RAGConfig) {
    this.pinecone = new Pinecone({ apiKey: config.pineconeApiKey });
    this.indexName = config.indexName;
    this.namespace = config.namespace || 'default';
    this.openai = new OpenAI({ 
      apiKey: config.openaiApiKey || process.env.OPENAI_API_KEY 
    });

    logger.info('RAG Service initialized', { 
      index: this.indexName, 
      namespace: this.namespace 
    });
  }

  /**
   * Get the Pinecone index
   */
  private getIndex(): Index<VectorMetadata> {
    return this.pinecone.index<VectorMetadata>(this.indexName);
  }

  /**
   * Retrieve relevant knowledge for a query
   */
  async retrieve(query: string, options?: {
    topK?: number;
    minScore?: number;
    filter?: Record<string, unknown>;
  }): Promise<KnowledgeResult[]> {
    const { topK = 5, minScore = 0.7, filter } = options || {};

    try {
      // Generate embedding for query
      const embedding = await this.embed(query);
      
      // Query Pinecone
      const index = this.getIndex();
      const results = await index.namespace(this.namespace).query({
        vector: embedding,
        topK,
        includeMetadata: true,
        filter,
      });

      // Filter by score and format results
      const relevant = results.matches
        ?.filter((match) => match.score && match.score >= minScore)
        ?.map((match) => ({
          id: match.id,
          text: (match.metadata?.text as string) || '',
          title: match.metadata?.title as string | undefined,
          score: match.score || 0,
          url: match.metadata?.url as string | undefined,
        }))
        ?.filter(r => r.text) || [];

      logger.info(`Retrieved ${relevant.length} relevant documents`, { 
        query: query.substring(0, 100),
        totalMatches: results.matches?.length,
        aboveThreshold: relevant.length,
      });

      return relevant;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('RAG retrieval failed', { error: message, query: query.substring(0, 100) });
      
      // Return empty array instead of throwing - graceful degradation
      return [];
    }
  }

  /**
   * Index a single document
   */
  async indexDocument(doc: KnowledgeDocument): Promise<void> {
    await this.indexDocuments([doc]);
  }

  /**
   * Index multiple documents
   */
  async indexDocuments(documents: KnowledgeDocument[]): Promise<{ 
    indexed: number; 
    errors: Array<{ id: string; error: string }>;
  }> {
    const index = this.getIndex();
    const errors: Array<{ id: string; error: string }> = [];
    const batchSize = 100;
    let indexed = 0;

    logger.info(`Indexing ${documents.length} documents...`);

    // Process in batches
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      
      try {
        // Generate embeddings for batch
        const vectors = await Promise.all(
          batch.map(async (doc) => {
            try {
              // Combine title and content for embedding
              const textToEmbed = doc.title 
                ? `${doc.title}\n\n${doc.content}`
                : doc.content;
              
              const embedding = await this.embed(textToEmbed);
              
              return {
                id: doc.id,
                values: embedding,
                metadata: {
                  text: doc.content,
                  title: doc.title || '',
                  category: doc.category || '',
                  url: doc.url || '',
                  lastUpdated: doc.lastUpdated || new Date().toISOString(),
                } as VectorMetadata,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              errors.push({ id: doc.id, error: message });
              return null;
            }
          })
        );

        // Filter out failed embeddings and upsert
        const validVectors = vectors.filter(v => v !== null) as NonNullable<typeof vectors[0]>[];
        if (validVectors.length > 0) {
          await index.namespace(this.namespace).upsert(validVectors);
          indexed += validVectors.length;
        }

        logger.debug(`Indexed batch ${Math.floor(i / batchSize) + 1}`, { 
          count: validVectors.length 
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Batch indexing failed`, { batchStart: i, error: message });
        batch.forEach(doc => errors.push({ id: doc.id, error: message }));
      }
    }

    logger.info(`Indexing complete`, { indexed, errors: errors.length });
    return { indexed, errors };
  }

  /**
   * Delete documents by IDs
   */
  async deleteDocuments(ids: string[]): Promise<void> {
    const index = this.getIndex();
    await index.namespace(this.namespace).deleteMany(ids);
    logger.info(`Deleted ${ids.length} documents`);
  }

  /**
   * Delete all documents in namespace
   */
  async clearNamespace(): Promise<void> {
    const index = this.getIndex();
    await index.namespace(this.namespace).deleteAll();
    logger.warn(`Cleared all documents in namespace: ${this.namespace}`);
  }

  /**
   * Get index statistics
   */
  async getStats(): Promise<{
    totalVectors: number;
    namespaces: Record<string, { vectorCount: number }>;
    dimension: number;
  }> {
    const index = this.getIndex();
    const stats = await index.describeIndexStats();
    
    // Transform namespaces to expected format
    const namespaces: Record<string, { vectorCount: number }> = {};
    if (stats.namespaces) {
      for (const [key, value] of Object.entries(stats.namespaces)) {
        namespaces[key] = { vectorCount: value.recordCount || 0 };
      }
    }
    
    return {
      totalVectors: stats.totalRecordCount || 0,
      namespaces,
      dimension: stats.dimension || this.embeddingDimension,
    };
  }

  /**
   * Generate embedding for text
   */
  private async embed(text: string): Promise<number[]> {
    try {
      // Truncate to model's max input (8191 tokens ≈ 32000 chars for safety)
      const truncated = text.length > 32000 ? text.substring(0, 32000) : text;
      
      const response = await this.openai.embeddings.create({
        model: this.embeddingModel,
        input: truncated,
      });
      
      return response.data[0].embedding;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw Errors.ragError(`Embedding generation failed: ${message}`);
    }
  }

  /**
   * Verify Pinecone connection
   */
  async verifyConnection(): Promise<{ 
    success: boolean; 
    index: string; 
    namespace: string;
    vectorCount?: number;
  }> {
    try {
      const stats = await this.getStats();
      return { 
        success: true, 
        index: this.indexName,
        namespace: this.namespace,
        vectorCount: stats.totalVectors,
      };
    } catch (error) {
      return { 
        success: false, 
        index: this.indexName,
        namespace: this.namespace,
      };
    }
  }

  /**
   * Hybrid search with keyword + semantic matching
   */
  async hybridSearch(query: string, keywords?: string[]): Promise<KnowledgeResult[]> {
    // Semantic search
    const semanticResults = await this.retrieve(query, { topK: 10, minScore: 0.5 });

    if (!keywords || keywords.length === 0) {
      return semanticResults.slice(0, 5);
    }

    // Boost results that contain keywords
    const boosted = semanticResults.map(result => {
      const keywordMatches = keywords.filter(kw => 
        result.text.toLowerCase().includes(kw.toLowerCase()) ||
        result.title?.toLowerCase().includes(kw.toLowerCase())
      );
      
      return {
        ...result,
        score: result.score + (keywordMatches.length * 0.1), // Boost by 10% per keyword match
      };
    });

    // Re-sort by boosted score
    return boosted
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }
}
