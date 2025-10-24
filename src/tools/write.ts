import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolInterface, ToolResult, FileOperationResult } from '../types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';

export class WriteTool implements ToolInterface {
  public readonly name = 'Write';
  public readonly description = 'Write content to a file, overwriting if it exists';

  constructor(private config: ConfigManager, private logger: Logger) {}

  public validate(params: any): boolean {
    return params &&
           typeof params.file_path === 'string' &&
           typeof params.content === 'string';
  }

  public async execute(params: any): Promise<FileOperationResult> {
    try {
      const { file_path, content } = params;
      const maxSize = this.config.getConfig().defaults.maxFileSizeMB * 1024 * 1024;

      // Check content size
      if (content.length > maxSize) {
        return {
          success: false,
          error: `Content too large: ${content.length} bytes (max: ${maxSize} bytes)`
        };
      }

      // Resolve path and ensure directory exists
      const absolutePath = path.resolve(file_path);
      const dir = path.dirname(absolutePath);

      await fs.mkdir(dir, { recursive: true });

      // Process content to handle escaped newlines
      const processedContent = content.replace(/\\n/g, '\n');

      // Write file
      await fs.writeFile(absolutePath, processedContent, 'utf8');

      // Get file stats after writing
      const stats = await fs.stat(absolutePath);

      return {
        success: true,
        data: {
          content: processedContent,
          path: absolutePath,
          size: stats.size
        },
        metadata: {
          created: !stats.birthtime.getTime() || stats.birthtime.getTime() === stats.mtime.getTime(),
          modified: stats.mtime
        }
      };
    } catch (error) {
      this.logger.error('Error writing file', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error writing file'
      };
    }
  }
}