import axios from 'axios';
import {
  IKnowledgeProvider,
  KnowledgeQueryParams,
  KnowledgeResponse,
} from '@binkai/knowledge-plugin';

import { IImageProvider, CreateImageParams, CreateImageResponse } from '@binkai/image-plugin';
import { logger } from '@binkai/core';
export interface BinkProviderConfig {
  apiKey: string;
  baseUrl: string;
  imageApiUrl: string;
}

export class BinkProvider implements IKnowledgeProvider, IImageProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly imageApiUrl: string;

  constructor(config: BinkProviderConfig) {
    if (!config.baseUrl) {
      throw new Error('BINK_API_URL is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.imageApiUrl = config.imageApiUrl || '';
  }

  getName(): string {
    return 'bink';
  }

  async query(params: KnowledgeQueryParams): Promise<KnowledgeResponse> {
    try {
      const response = await axios.post(`${this.baseUrl}`, params, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      return { sources: [{ content: response?.data?.data }] };
    } catch (error: any) {
      logger.error('error', error);
      if (axios.isAxiosError(error)) {
        throw new Error(`Bink API error: ${error.response?.data?.message || error.message}`);
      }
      throw error;
    }
  }

  async createImage(params: CreateImageParams): Promise<CreateImageResponse> {
    const requestId = `req-${Math.random().toString(36).substring(2, 15)}`;
    try {
      await axios.post(`${this.imageApiUrl}/image/generate`, {
        prompt: params.prompt,
        url: params.image_url || '',
        requestId,
      });

      let imageData = null;
      let attempts = 0;
      const maxAttempts = 150;
      const pollingInterval = 2000;

      while (attempts < maxAttempts) {
        const response = await axios.get(`${this.imageApiUrl}/image/status/${requestId}`);
        const status = response.data;

        if (status.data.status === 'success') {
          imageData = status.data.data;
          break;
        } else if (status.data.status === 'error') {
          throw new Error(`Image generation failed: ${status.data.message || 'Unknown error'}`);
        }

        await new Promise(resolve => setTimeout(resolve, pollingInterval));
        attempts++;
      }

      if (!imageData) {
        throw new Error('Image generation timed out after 5 minutes');
      }

      return {
        status: 'success',
        fileName: imageData?.fileName,
        imageUrl: imageData?.downloadUrl,
      };
    } catch (error) {
      throw error;
    }
  }
}
