import chalk from 'chalk';
import { CLIConfig } from '../types';

export class Logger {
  private config: CLIConfig;

  constructor(config: CLIConfig) {
    this.config = config;
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: string, message: string, timestamp?: Date): string {
    const time = timestamp || new Date();
    const timeStr = time.toISOString();
    const levelStr = level.toUpperCase().padEnd(5);

    let coloredLevel: string;
    switch (level) {
      case 'debug':
        coloredLevel = chalk.gray(levelStr);
        break;
      case 'info':
        coloredLevel = chalk.blue(levelStr);
        break;
      case 'warn':
        coloredLevel = chalk.yellow(levelStr);
        break;
      case 'error':
        coloredLevel = chalk.red(levelStr);
        break;
      default:
        coloredLevel = levelStr;
    }

    return `${chalk.gray(timeStr)} ${coloredLevel} ${message}`;
  }

  public debug(message: string, data?: any): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message));
      if (data) {
        console.log(chalk.gray('Data:'), data);
      }
    }
  }

  public info(message: string, data?: any): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message));
      if (data) {
        console.log(chalk.blue('Info:'), data);
      }
    }
  }

  public warn(message: string, data?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message));
      if (data) {
        console.warn(chalk.yellow('Warning:'), data);
      }
    }
  }

  public error(message: string, error?: Error | any): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message));
      if (error) {
        if (error instanceof Error) {
          console.error(chalk.red('Error:'), error.message);
          if (this.config.logLevel === 'debug') {
            console.error(chalk.red('Stack:'), error.stack);
          }
        } else {
          console.error(chalk.red('Error details:'), error);
        }
      }
    }
  }

  public success(message: string): void {
    console.log(this.formatMessage('info', chalk.green(message)));
  }

  public tool(toolName: string, message: string): void {
    console.log(`${chalk.cyan('[TOOL]')} ${chalk.magenta(toolName)}: ${message}`);
  }
}