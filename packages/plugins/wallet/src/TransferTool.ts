import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  BaseTool,
  CustomDynamicStructuredTool,
  IToolConfig,
  NetworkName,
  ToolProgress,
  logger,
} from '@binkai/core';
import { ProviderRegistry } from './ProviderRegistry';
import { IWalletProvider, TransferParams, TransferQuote } from './types';
import { defaultTokens } from '@binkai/token-plugin';
import { ethers } from 'ethers';

export function validateTokenAddress(address: string, chain: string): boolean {
  try {
    if (chain === 'solana') {
      return isValidSolanaAddress(address);
    }
    return ethers.isAddress(address);
  } catch (error) {
    return false;
  }
}

export function isValidSolanaAddress(address: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

export interface TransferToolConfig extends IToolConfig {
  defaultNetwork?: string;
  supportedNetworks?: string[];
}

export class TransferTool extends BaseTool {
  public registry: ProviderRegistry;
  private defaultNetwork: string;
  private supportedNetworks: Set<string>;

  constructor(config: TransferToolConfig) {
    super(config);
    this.registry = new ProviderRegistry();
    this.defaultNetwork = config.defaultNetwork || 'bnb';
    this.supportedNetworks = new Set<string>(config.supportedNetworks || []);
  }

  registerProvider(provider: IWalletProvider): void {
    this.registry.registerProvider(provider);

    // Add provider's supported networks
    provider.getSupportedNetworks().forEach(network => {
      this.supportedNetworks.add(network);
    });
  }

  getName(): string {
    return 'transfer_tokens';
  }

  getDescription(): string {
    const providers = this.registry.getProviderNames().join(', ');
    const networks = Array.from(this.supportedNetworks).join(', ');
    const defaultToken = JSON.stringify(defaultTokens[this.defaultNetwork as NetworkName]);
    const description = `Transfer tokens from your wallet to another address. Supports networks: ${networks}. Available providers: ${providers}. Default token: ${defaultToken}`;
    return description;
  }

  private getSupportedNetworks(): string[] {
    return Array.from(this.supportedNetworks) as NetworkName[];
  }

  getSchema(): z.ZodObject<any> {
    const providers = this.registry.getProviderNames();
    if (providers.length === 0) {
      throw new Error('No wallet providers registered');
    }

    const supportedNetworks = this.getSupportedNetworks();
    if (supportedNetworks.length === 0) {
      throw new Error('No supported networks available');
    }

    return z.object({
      token: z
        .string()
        .describe('The contract address of the token you want to transfer (not the token symbol)'),
      toAddress: z.string().describe('The recipient wallet address'),
      amount: z.string().describe('The amount of tokens to transfer'),
      network: z
        .enum(supportedNetworks as [string, ...string[]])
        .default(this.defaultNetwork)
        .describe('The blockchain network to execute the transfer on'),
      provider: z
        .enum(providers as [string, ...string[]])
        .describe(
          'The provider to use for the transfer. If not specified, the standard provider will be used',
        ),
    });
  }

  async getQuote(
    args: any,
    onProgress?: (data: ToolProgress) => void,
  ): Promise<{ selectedProvider: IWalletProvider; quote: TransferQuote; userAddress: string }> {
    const {
      token,
      toAddress,
      amount,
      network = this.defaultNetwork,
      provider: preferredProvider,
    } = args;
    // Validate token address
    if (!validateTokenAddress(token, network)) {
      throw new Error(`Invalid token address for network ${network}: ${token}`);
    }

    // Get agent's wallet and address
    const wallet = this.agent.getWallet();
    const userAddress = await wallet.getAddress(network);

    // Check if user is sending to themselves
    if (userAddress === toAddress) {
      throw new Error('You cannot send tokens to yourself');
    }

    // Validate network is supported
    const supportedNetworks = this.getSupportedNetworks();
    if (!supportedNetworks.includes(network)) {
      throw new Error(
        `Network ${network} is not supported. Supported networks: ${supportedNetworks.join(', ')}`,
      );
    }
    const transferParams: TransferParams = {
      network: network as NetworkName,
      token,
      toAddress,
      amount,
    };
    // Get the provider
    const selectedProvider = this.registry.getProvider(preferredProvider);
    // Validate provider supports the network
    if (!selectedProvider.getSupportedNetworks().includes(network as NetworkName)) {
      throw new Error(`Provider ${preferredProvider} does not support network ${network}`);
    }

    // Get quote
    const quote = await selectedProvider?.getQuote?.(transferParams, userAddress);
    if (!quote) {
      throw new Error('No quote found');
    }

    // Check balance
    const balanceCheck = await selectedProvider?.checkBalance?.(quote, userAddress);
    if (!balanceCheck?.isValid) {
      throw new Error(`Insufficient balance: ${balanceCheck?.message}`);
    }

    return {
      selectedProvider,
      quote: {
        ...quote,
        provider: selectedProvider.getName(),
      },
      userAddress,
    };
  }

  async simulateQuoteTool(args: any): Promise<TransferQuote> {
    if (this.agent.isMockResponseTool()) {
      const mockResponse = await this.mockResponseTool(args);
      return JSON.parse(mockResponse);
    }
    return (await this.getQuote(args)).quote;
  }

  mockResponseTool(args: any): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        status: args.status,
      }),
    );
  }

  createTool(): CustomDynamicStructuredTool {
    logger.info('✓ Creating tool', this.getName());
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
          const {
            token,
            toAddress,
            amount,
            network = this.defaultNetwork,
            provider: preferredProvider,
          } = args;

          logger.info('🤖 Transfer Args:', args);

          const { selectedProvider, quote, userAddress } = await this.getQuote(args, onProgress);

          // Get agent's wallet and address
          const wallet = this.agent.getWallet();
          let transferTx;

          // Only check allowance for non-solana networks
          if (network !== 'solana') {
            // Build transaction
            transferTx = await selectedProvider?.buildTransferTransaction?.(quote, userAddress);
            if (!transferTx) {
              throw new Error('No transfer transaction found');
            }

            const allowance = await selectedProvider?.checkAllowance?.(
              network as NetworkName,
              token,
              userAddress,
              transferTx?.to,
            );

            const requiredAmount = BigInt(
              Number(quote?.amount || 0) * 10 ** (quote?.token.decimals || 0),
            );

            logger.info('🤖 Allowance: ', allowance, ' Required amount: ', requiredAmount);

            if (allowance && allowance < requiredAmount) {
              const approveTx = await selectedProvider?.buildApproveTransaction?.(
                network as NetworkName,
                token,
                transferTx?.to,
                quote?.amount,
                userAddress,
              );

              logger.info('🤖 Approving...');
              // Sign and send approval transaction
              const approveReceipt = await wallet.signAndSendTransaction(network, {
                to: approveTx?.to || '',
                data: approveTx?.data || '',
                value: BigInt(approveTx?.value || 0),
              });

              logger.info('🤖 ApproveReceipt:', approveReceipt);

              // Wait for approval to be mined
              await approveReceipt.wait();
            }
          } else {
            transferTx = await selectedProvider?.buildTransferTransaction?.(quote, userAddress);

            if (!transferTx) {
              throw new Error('No transfer transaction found');
            }
          }

          logger.info('🤖 Transferring...');

          // Sign and send transfer transaction
          const receipt = await wallet.signAndSendTransaction(network, {
            to: transferTx.to,
            data: transferTx.data,
            value: BigInt(transferTx.value),
            ...(network === 'solana' && { lastValidBlockHeight: transferTx.lastValidBlockHeight }),
          });

          // Wait for transaction to be mined
          const finalReceipt = await receipt.wait();

          // Return result as JSON string
          return JSON.stringify({
            status: 'success',
            provider: selectedProvider.getName(),
            token: quote.token,
            fromAddress: userAddress,
            toAddress: quote.toAddress,
            amount: quote.amount,
            transactionHash: finalReceipt.hash,
            network,
          });
        } catch (error) {
          logger.error('Transfer error:', error);
          return JSON.stringify({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    };
  }
}
