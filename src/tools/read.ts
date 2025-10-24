import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolInterface, ToolResult, FileOperationResult } from '../types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';

export class ReadTool implements ToolInterface {
  public readonly name = 'Read';
  public readonly description = 'Read file contents with optional line range';

  constructor(private config: ConfigManager, private logger: Logger) {}

  public validate(params: any): boolean {
    return params && typeof params.file_path === 'string';
  }

  public async execute(params: any): Promise<FileOperationResult> {
    try {
      const { file_path, offset = 0, limit } = params;
      const maxSize = this.config.getConfig().defaults.maxFileSizeMB * 1024 * 1024;

      // Check file size first
      const stats = await fs.stat(file_path);
      if (stats.size > maxSize) {
        return {
          success: false,
          error: `File too large: ${stats.size} bytes (max: ${maxSize} bytes)`
        };
      }

      // Resolve relative paths
      const absolutePath = path.resolve(file_path);

      // Read file content
      const content = await fs.readFile(absolutePath, 'utf8');
      const lines = content.split('\n');

      // Handle line range
      let resultLines: string[];
      if (limit && limit > 0) {
        const start = Math.max(0, offset);
        const end = Math.min(lines.length, start + limit);
        resultLines = lines.slice(start, end);
      } else {
        resultLines = lines;
      }

      const resultContent = resultLines.join('\n');

      return {
        success: true,
        data: {
          content: resultContent,
          lines: resultLines,
          path: absolutePath,
          size: stats.size
        }
      };
    } catch (error) {
      this.logger.error('Error reading file', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error reading file'
      };
    }
  }
}