import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolInterface, ToolResult, FileOperationResult } from '../types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';

export class EditTool implements ToolInterface {
  public readonly name = 'Edit';
  public readonly description = 'Edit file content by performing exact string replacements';

  constructor(private config: ConfigManager, private logger: Logger) {}

  public validate(params: any): boolean {
    return params &&
           typeof params.file_path === 'string' &&
           typeof params.old_string === 'string' &&
           typeof params.new_string === 'string';
  }

  public async execute(params: any): Promise<FileOperationResult> {
    try {
      const { file_path, old_string, new_string, replace_all = false } = params;
      const maxSize = this.config.getConfig().defaults.maxFileSizeMB * 1024 * 1024;

      // Read current file content
      const absolutePath = path.resolve(file_path);
      const stats = await fs.stat(absolutePath);

      if (stats.size > maxSize) {
        return {
          success: false,
          error: `File too large: ${stats.size} bytes (max: ${maxSize} bytes)`
        };
      }

      const currentContent = await fs.readFile(absolutePath, 'utf8');

      // Check if old string exists
      if (!currentContent.includes(old_string)) {
        return {
          success: false,
          error: `String not found in file: "${old_string.substring(0, 50)}${old_string.length > 50 ? '...' : ''}"`
        };
      }

      // Perform replacement
      let newContent: string;
      if (replace_all) {
        newContent = currentContent.split(old_string).join(new_string);
      } else {
        // Replace only first occurrence
        newContent = currentContent.replace(old_string, new_string);
      }

      // Write back to file
      await fs.writeFile(absolutePath, newContent, 'utf8');

      // Get updated stats
      const newStats = await fs.stat(absolutePath);

      return {
        success: true,
        data: {
          content: newContent,
          path: absolutePath,
          size: newStats.size
        },
        metadata: {
          modified: newStats.mtime,
          previousSize: stats.size,
          newSize: newStats.size,
          replacements: replace_all ?
            (currentContent.match(new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length :
            1
        }
      };
    } catch (error) {
      this.logger.error('Error editing file', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error editing file'
      };
    }
  }
}