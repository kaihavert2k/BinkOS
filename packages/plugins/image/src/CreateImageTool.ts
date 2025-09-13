import {
  BaseTool,
  CustomDynamicStructuredTool,
  IToolConfig,
  ToolProgress,
  logger,
} from '@binkai/core';
import { z } from 'zod';
import { IImageProvider } from './types';

export class CreateImageTool extends BaseTool {
  private providers: Map<string, IImageProvider> = new Map();

  constructor(config: IToolConfig) {
    super(config);
  }

  getName(): string {
    return 'create-image';
  }

  getDescription(): string {
    const providers = Array.from(this.providers.keys()).join(', ');
    return `Create image from user request and based on image url , description using various providers (${providers}).`;
  }

  registerProvider(provider: IImageProvider): void {
    this.providers.set(provider.getName(), provider);
  }

  mockResponseTool(args: any): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        status: args.status,
      }),
    );
  }

  getSchema(): z.ZodObject<any> {
    const providers = Array.from(this.providers.keys());
    if (providers.length === 0) {
      throw new Error('No image providers registered');
    }

    return z.object({
      prompt: z.string().describe('User request for generate image'),
      image_url: z
        .string()
        .optional()
        .describe('The image url needs to be used to generate the image.'),
      provider: z
        .enum(providers as [string, ...string[]])
        .optional()
        .describe(
          'The provider to use for question. If not specified, the default provider will be used',
        ),
    });
  }

  createTool(): CustomDynamicStructuredTool {
    return {
      name: this.getName(),
      description: this.getDescription(),
      schema: this.getSchema(),
      func: async (
        args: any,
        runManager?: any,
        config?: any,
        onProgress?: (data: ToolProgress) => void,
      ) => {
        try {
          const { prompt, image_url, provider: providerName } = args;
          logger.info('🤖 Create image Args:', args);

          onProgress?.({
            progress: 30,
            message: 'Sending image request to provider',
          });
          let provider: IImageProvider;
          if (providerName) {
            const selectedProvider = this.providers.get(providerName);
            if (!selectedProvider) {
              throw new Error(`Provider ${providerName} not found`);
            }
            provider = selectedProvider;
          } else {
            // Get first provider or throw error if none exists
            const firstProvider = this.providers.values().next().value;
            if (!firstProvider) {
              throw new Error('No provider available');
            }
            provider = firstProvider;
          }

          onProgress?.({
            progress: 50,
            message: `Processing image generation...`,
          });

          const response = await provider.createImage({ prompt, image_url });
          onProgress?.({
            progress: 100,
            message: 'Image generated successfully',
          });
          return JSON.stringify(response);
        } catch (error) {
          return JSON.stringify({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  }
}
