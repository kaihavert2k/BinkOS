// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = 'info';
  private isEnabled: boolean = true;

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  public disable(): boolean {
    this.isEnabled = false;
    return false;
  }

  public enable(): boolean {
    this.isEnabled = true;
    return true;
  }

  public setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private getTimestamp(): string {
    return new Date().toISOString();
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  public debug(message: string, ...args: any[]): void {
    if (!this.shouldLog('debug') || !this.isEnabled) return;
    console.log(`${colors.gray}[${this.getTimestamp()}] DEBUG:${colors.reset}`, message, ...args);
  }

  public info(message: string, ...args: any[]): void {
    if (!this.shouldLog('info') || !this.isEnabled) return;
    console.log(`${colors.green}[${this.getTimestamp()}] INFO:${colors.reset}`, message, ...args);
  }

  public warn(message: string, ...args: any[]): void {
    if (!this.shouldLog('warn') || !this.isEnabled) return;
    console.log(`${colors.yellow}[${this.getTimestamp()}] WARN:${colors.reset}`, message, ...args);
  }

  public error(message: string | Error, ...args: any[]): void {
    if (!this.shouldLog('error') || !this.isEnabled) return;
    const errorMessage = message instanceof Error ? message.stack || message.message : message;
    console.error(
      `${colors.red}[${this.getTimestamp()}] ERROR:${colors.reset}`,
      errorMessage,
      ...args,
    );
  }
}

// Export a default logger instance
export const logger = Logger.getInstance();
