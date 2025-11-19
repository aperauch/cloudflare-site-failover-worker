import type { LogLevel } from './types';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = 'debug') {
    this.level = level;
  }

  setLevel(level: LogLevel) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  debug(message: string, data?: any) {
    if (this.shouldLog('debug')) {
      console.log(`[DEBUG] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  info(message: string, data?: any) {
    if (this.shouldLog('info')) {
      console.log(`[INFO] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  warn(message: string, data?: any) {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  error(message: string, data?: any) {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, data ? JSON.stringify(data) : '');
    }
  }
}
