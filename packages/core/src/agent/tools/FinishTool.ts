import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { IToolConfig } from './types';
import { BaseTool } from './BaseTool';
import { createNetworkSchema } from './schemas';
import { CustomDynamicStructuredTool } from './types';
export class FinishTool extends BaseTool {
  getName(): string {
    return 'terminate';
  }

  getDescription(): string {
    return `Use this tool if it is completed or failed many times or you need ask user for more information.`;
  }

  getSchema(): z.ZodObject<any> {
    return z.object({});
  }

  mockResponseTool(args: any): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        status: args.status,
      }),
    );
  }

  createTool(): CustomDynamicStructuredTool {
    return new DynamicStructuredTool({
      name: this.getName(),
      description: this.getDescription(),
      schema: this.getSchema(),
      func: async () => {
        return `finished`;
      },
    });
  }
}
