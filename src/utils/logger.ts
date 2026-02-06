/**
 * Simple structured logger for the application
 * Can be replaced with Winston, Pino, etc. for production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

const LOG_COLORS = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
  reset: '\x1b[0m',
};

const LOG_ICONS = {
  debug: '🔍',
  info: 'ℹ️ ',
  warn: '⚠️ ',
  error: '❌',
};

class Logger {
  private minLevel: LogLevel;
  private isProduction: boolean;

  constructor() {
    this.minLevel = (process.env.LOG_LEVEL as LogLevel) || 'debug';
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private formatMessage(entry: LogEntry): string {
    if (this.isProduction) {
      // JSON format for production (log aggregation)
      return JSON.stringify(entry);
    }

    // Pretty format for development
    const color = LOG_COLORS[entry.level];
    const icon = LOG_ICONS[entry.level];
    const context = entry.context 
      ? '\n  ' + JSON.stringify(entry.context, null, 2).replace(/\n/g, '\n  ')
      : '';

    return `${color}${icon} [${entry.timestamp}] ${entry.message}${LOG_COLORS.reset}${context}`;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
    };

    const formatted = this.formatMessage(entry);

    switch (level) {
      case 'error':
        console.error(formatted);
        break;
      case 'warn':
        console.warn(formatted);
        break;
      default:
        console.log(formatted);
    }
  }

  debug(message: string, context?: Record<string, unknown>) {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>) {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>) {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>) {
    this.log('error', message, context);
  }

  /**
   * Log the start and end of an operation with timing
   */
  async timed<T>(
    operation: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const start = Date.now();
    this.debug(`Starting: ${operation}`, context);

    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.info(`Completed: ${operation}`, { ...context, durationMs: duration });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(`Failed: ${operation}`, { 
        ...context, 
        durationMs: duration, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export const logger = new Logger();
