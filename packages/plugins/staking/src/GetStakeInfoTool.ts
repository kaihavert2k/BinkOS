import { z } from 'zod';
import {
  BaseTool,
  CustomDynamicStructuredTool,
  IToolConfig,
  ToolProgress,
  logger,
} from '@binkai/core';
import { ProviderRegistry } from './ProviderRegistry';
import { IStakingProvider, StakingBalance, StakingQuote, StakingParams } from './types';

export interface GetStakeInfoToolConfig extends IToolConfig {
  defaultNetwork?: string;
  supportedNetworks?: string[];
}

export class GetStakeInfoTool extends BaseTool {
  public registry: ProviderRegistry;
  private supportedNetworks: Set<string>;

  constructor(config: GetStakeInfoToolConfig) {
    super(config);
    this.registry = new ProviderRegistry();
    this.supportedNetworks = new Set<string>(config.supportedNetworks || []);
  }

  registerProvider(provider: IStakingProvider): void {
    this.registry.registerProvider(provider);
    logger.info('🔌 Provider registered:', provider.getName());
    provider.getSupportedNetworks().forEach(network => {
      this.supportedNetworks.add(network);
    });
  }

  getName(): string {
    return 'get_stake_info';
  }

  getDescription(): string {
    const providers = this.registry.getProviderNames().join(', ');
    const networks = Array.from(this.supportedNetworks).join(', ');
    return `Get Information about the staking like currentAPY for a token across all supported networks. Supports networks: ${networks}. Available providers: ${providers}.`;
  }

  private getSupportedNetworks(): string[] {
    const agentNetworks = Object.keys(this.agent.getNetworks());
    const providerNetworks = Array.from(this.supportedNetworks);
    return agentNetworks.filter(network => providerNetworks.includes(network));
  }

  mockResponseTool(args: any): Promise<string> {
    let allStakingBalances: { address: string; tokens: StakingBalance[] }[] = [];
    const combinedTokens: StakingBalance[] = [];
    allStakingBalances.forEach(balanceData => {
      if (balanceData.tokens && balanceData.tokens.length > 0) {
        combinedTokens.push(...balanceData.tokens);
      }
    });

    return Promise.resolve(
      JSON.stringify({
        status: 'success',
        data: {
          address: args.address,
          token: combinedTokens,
        },
        network: args.network,
        address: args.address,
      }),
    );
  }

  getSchema(): z.ZodObject<any> {
    const supportedNetworks = this.getSupportedNetworks();
    if (supportedNetworks.length === 0) {
      throw new Error('No supported networks available');
    }

    return z.object({
      address: z
        .string()
        .optional()
        .describe(
          'The wallet address to query staking info (optional - uses agent wallet if not provided)',
        ),
      network: z
        .enum(['bnb', 'solana', 'ethereum'])
        .default('bnb')
        .describe('The blockchain to query the staking balances on.'),
    });
  }

  private async findAllProviders(
    params: StakingParams & { network: string },
    userAddress: string,
  ): Promise<{ provider: IStakingProvider; quote: StakingQuote }[]> {
    // Validate network is supported
    const providers = this.registry.getProvidersByNetwork(params.network);
    if (providers.length === 0) {
      throw new Error(`No providers available for network ${params.network}`);
    }

    const quotes = await Promise.all(
      providers.map(async (provider: IStakingProvider) => {
        try {
          logger.info('🤖 Getting quote from', provider.getName());
          const quote = await provider.getQuote(params, userAddress);
          logger.info('🤖 Quote:', quote);
          return { provider, quote };
        } catch (error) {
          logger.warn(`Failed to get quote from ${provider.getName()}:`, error);
          return null;
        }
      }),
    );
    return quotes.filter(
      (q): q is { provider: IStakingProvider; quote: StakingQuote } => q !== null,
    );
  }

  createTool(): CustomDynamicStructuredTool {
    logger.info('🛠️ Creating staking balance tool');
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
          if (this.agent.isMockResponseTool()) {
            return this.mockResponseTool(args);
          }

          let address = args.address;
          logger.info(
            `🔍 Getting staking balances for ${address || 'agent wallet'} on ${args.network}`,
          );

          const stakingParams: StakingParams = {
            network: args.network,
            tokenA: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            amountA: '0.1',
            type: 'stake',
          };
          // let selectedProvider: IStakingProvider;
          // let quote: StakingQuote;

          // STEP 1: Validate network
          // Validate network is supported
          const supportedNetworks = this.getSupportedNetworks();
          if (!supportedNetworks.includes(args.network)) {
            throw new Error(
              `Network ${args.network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`,
            );
          }
          // STEP 2: Get wallet address
          try {
            // If no address provided, get it from the agent's wallet
            if (!address) {
              logger.info('🔑 No address provided, using agent wallet');
              address = await this.agent.getWallet().getAddress(args.network);
              logger.info(`🔑 Using agent wallet address: ${address}`);
            }
          } catch (error) {
            logger.error(`❌ Failed to get wallet address for network ${args.network}`);
            throw error;
          }

          onProgress?.({
            progress: 50,
            message: `Searching for the information stake for ${address} on ${args.network}.`,
          });

          const bestQuote = await this.findAllProviders(
            {
              ...stakingParams,
              network: args.network,
            },
            address,
          );

          const simplifiedQuotes = bestQuote.map(({ provider, quote }) => ({
            provider: provider.getName(),
            currentAPY: String(quote.currentAPY),
            averageAPY: String(quote.averageAPY),
            maxSupply: String(quote.maxSupply),
            currentSupply: String(quote.currentSupply),
            liquidity: String(quote.liquidity),
            type: quote.type,
            network: quote.network,
            unstakingPeriod: provider.getName().toLowerCase() === 'lista' ? '7 days' : undefined,
          }));

          return JSON.stringify({
            status: 'success',
            data: { bestQuotes: simplifiedQuotes },
            network: args.network,
            address: address,
          });
        } catch (error) {
          logger.error(
            '❌ Error in staking balance tool:',
            error instanceof Error ? error.message : error,
          );
          return this.handleError(error, args);
        }
      },
    };
  }
}
