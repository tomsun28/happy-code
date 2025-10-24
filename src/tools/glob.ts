import * as path from 'path';
import { glob as globSync } from 'glob';
import { ToolInterface, ToolResult, SearchResult } from '../types';
import { ConfigManager } from '../core/config';
import { Logger } from '../core/logger';

export class GlobTool implements ToolInterface {
  public readonly name = 'Glob';
  public readonly description = 'Search for files matching a pattern';

  constructor(private config: ConfigManager, private logger: Logger) {}

  public validate(params: any): boolean {
    return params && typeof params.pattern === 'string';
  }

  public async execute(params: any): Promise<SearchResult> {
    try {
      const { pattern, path: searchPath = '.', type, head_limit } = params;
      const options: any = {
        cwd: path.resolve(searchPath),
        absolute: true,
        nodir: true
      };

      // Add type filter if specified
      if (type) {
        if (type.startsWith('.')) {
          options.ext = type;
        } else {
          options.ext = `.${type}`;
        }
      }

      // Execute glob search
      const files = await globSync(pattern, options);

      // Apply limit if specified
      const limitedFiles = head_limit ? files.slice(0, head_limit) : files;

      // Sort by modification time (newest first)
      const sortedFiles = limitedFiles.sort((a, b) => {
        try {
          const statA = require('fs').statSync(a);
          const statB = require('fs').statSync(b);
          return statB.mtime.getTime() - statA.mtime.getTime();
        } catch {
          return 0;
        }
      });

      // Check result limit
      const maxResults = this.config.getConfig().defaults.searchResultsLimit;
      const finalFiles = sortedFiles.slice(0, maxResults);

      return {
        success: true,
        data: {
          files: finalFiles,
          count: finalFiles.length
        },
        metadata: {
          totalFound: files.length,
          limited: files.length > maxResults,
          searchPath: path.resolve(searchPath),
          pattern: pattern
        }
      };
    } catch (error) {
      this.logger.error('Error in glob search', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error in glob search'
      };
    }
  }
}