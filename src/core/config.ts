import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { CLIConfig } from '../types';

export class ConfigManager {
  private config: CLIConfig;
  private configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.happy-code', 'config.yaml');
    this.config = this.loadConfig();
  }

  private loadConfig(): CLIConfig {
    // Load default configuration
    const defaultConfig: CLIConfig = {
      apiKeys: {},
      defaults: {
        encoding: 'utf8',
        maxFileSizeMB: 10,
        searchResultsLimit: 100,
        shellTimeoutMs: 120000,
        enableBackgroundTasks: true,
        aiProvider: 'zhipu',
        aiModel: 'glm-4',
        maxTokens: 4000,
        temperature: 0.7
      },
      environment: (process.env.NODE_ENV as 'development' | 'production') || 'development',
      logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info'
    };

    try {
      // Load environment variables
      if (process.env.OPENAI_API_KEY) {
        defaultConfig.apiKeys.openai = process.env.OPENAI_API_KEY;
      }
      if (process.env.ANTHROPIC_API_KEY) {
        defaultConfig.apiKeys.anthropic = process.env.ANTHROPIC_API_KEY;
      }
      if (process.env.ZHIPU_API_KEY) {
        defaultConfig.apiKeys.zhipu = process.env.ZHIPU_API_KEY;
      }

      // Override with file config if exists
      if (fs.existsSync(this.configPath)) {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        const fileConfig = yaml.parse(fileContent);
        this.mergeConfig(defaultConfig, fileConfig);
      }
    } catch (error) {
      console.warn('Failed to load configuration, using defaults:', error);
    }

    return defaultConfig;
  }

  private mergeConfig(target: CLIConfig, source: any): void {
    if (source.apiKeys) {
      target.apiKeys = { ...target.apiKeys, ...source.apiKeys };
    }
    if (source.defaults) {
      target.defaults = { ...target.defaults, ...source.defaults };
    }
    if (source.environment) {
      target.environment = source.environment;
    }
    if (source.logLevel) {
      target.logLevel = source.logLevel;
    }
  }

  public getConfig(): CLIConfig {
    return this.config;
  }

  public updateConfig(updates: Partial<CLIConfig>): void {
    this.mergeConfig(this.config, updates);
    this.saveConfig();
  }

  private saveConfig(): void {
    try {
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, yaml.stringify(this.config));
    } catch (error) {
      console.error('Failed to save configuration:', error);
    }
  }

  public getApiKey(service: 'openai' | 'anthropic' | 'zhipu'): string | undefined {
    return this.config.apiKeys[service];
  }

  public setApiKey(service: 'openai' | 'anthropic' | 'zhipu', key: string): void {
    this.config.apiKeys[service] = key;
    this.saveConfig();
  }
}