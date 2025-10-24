import { ToolInterface, ToolResult } from '../types';
import { ConfigManager } from './config';
import { Logger } from './logger';
import { ReadTool } from '../tools/read';
import { WriteTool } from '../tools/write';
import { EditTool } from '../tools/edit';
import { GlobTool } from '../tools/glob';
import { GrepTool } from '../tools/grep';
import { BashTool } from '../tools/bash';

export class ToolRegistry {
  private tools: Map<string, ToolInterface> = new Map();
  private config: ConfigManager;
  private logger: Logger;

  constructor(config: ConfigManager, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.initializeTools();
  }

  private initializeTools(): void {
    // Register file operation tools
    this.registerTool(new ReadTool(this.config, this.logger));
    this.registerTool(new WriteTool(this.config, this.logger));
    this.registerTool(new EditTool(this.config, this.logger));

    // Register search tools
    this.registerTool(new GlobTool(this.config, this.logger));
    this.registerTool(new GrepTool(this.config, this.logger));

    // Register shell tool
    this.registerTool(new BashTool(this.config, this.logger));
  }

  public registerTool(tool: ToolInterface): void {
    this.tools.set(tool.name, tool);
    this.logger.debug(`Registered tool: ${tool.name}`);
  }

  public getTool(name: string): ToolInterface {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool '${name}' not found`);
    }
    return tool;
  }

  public listTools(): Array<{ name: string; description: string }> {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description
    }));
  }

  public async executeTool(name: string, params: any): Promise<ToolResult> {
    const tool = this.getTool(name);

    try {
      this.logger.tool(name, `Executing with params: ${JSON.stringify(params)}`);

      if (tool.validate && !tool.validate(params)) {
        return {
          success: false,
          error: `Invalid parameters for tool '${name}'`
        };
      }

      const result = await tool.execute(params);

      if (result.success) {
        this.logger.tool(name, 'Execution successful');
      } else {
        this.logger.tool(name, `Execution failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Tool '${name}' execution error`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}