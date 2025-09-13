import { SwapQuote, SwapParams, BaseSwapProvider, NetworkProvider } from '@binkai/swap-plugin';
import { ethers, Provider } from 'ethers';
import { EVM_NATIVE_TOKEN_ADDRESS, NetworkName, Token, logger } from '@binkai/core';

// Core system constants
const CONSTANTS = {
  DEFAULT_GAS_LIMIT: '350000',
  APPROVE_GAS_LIMIT: '50000',
  QUOTE_EXPIRY: 5 * 60 * 1000, // 5 minutes in milliseconds
  KYBER_BNB_ADDRESS: EVM_NATIVE_TOKEN_ADDRESS,
  KYBER_API_BASE: 'https://aggregator-api.kyberswap.com/bsc/',
} as const;

enum ChainId {
  BSC = 56,
  ETH = 1,
}

export class KyberProvider extends BaseSwapProvider {
  private provider: Provider;
  private chainId: ChainId;
  protected GAS_BUFFER: bigint = ethers.parseEther('0.0003');

  constructor(provider: Provider, chainId: ChainId = ChainId.BSC) {
    // Create a Map with BNB network and the provider
    const providerMap = new Map<NetworkName, NetworkProvider>();
    providerMap.set(NetworkName.BNB, provider);

    super(providerMap);
    this.provider = provider;
    this.chainId = chainId;
  }

  getName(): string {
    return 'kyber';
  }

  getSupportedChains(): string[] {
    return ['bnb', 'ethereum'];
  }

  getSupportedNetworks(): NetworkName[] {
    return [NetworkName.BNB];
  }

  protected isNativeToken(tokenAddress: string): boolean {
    return tokenAddress.toLowerCase() === EVM_NATIVE_TOKEN_ADDRESS.toLowerCase();
  }

  protected async getToken(tokenAddress: string, network: NetworkName): Promise<Token> {
    if (this.isNativeToken(tokenAddress)) {
      return {
        address: tokenAddress as `0x${string}`,
        decimals: 18,
        symbol: 'BNB',
      };
    }

    const token = await super.getToken(tokenAddress, network);

    const tokenInfo = {
      chainId: this.chainId,
      address: token.address.toLowerCase() as `0x${string}`,
      decimals: token.decimals,
      symbol: token.symbol,
    };
    return tokenInfo;
  }

  private async callKyberApi(
    amount: string,
    fromToken: Token,
    toToken: Token,
    userAddress: string,
  ) {
    const routePath = `api/v1/routes?tokenIn=${fromToken.address}&tokenOut=${toToken.address}&amountIn=${amount}&gasInclude=true`;
    logger.info('🤖 Kyber Path', routePath);
    const routeResponse = await fetch(`${CONSTANTS.KYBER_API_BASE}${routePath}`);
    const routeData = await routeResponse.json();

    if (!routeData.data || routeData.data.length === 0) {
      throw new Error('No swap routes available from Kyber');
    }

    const transactionResponse = await fetch(`${CONSTANTS.KYBER_API_BASE}api/v1/route/build`, {
      method: 'POST',
      body: JSON.stringify({
        routeSummary: routeData.data.routeSummary,
        sender: userAddress,
        recipient: userAddress,
        skipSimulateTx: false,
        slippageTolerance: 200,
      }),
    });

    return {
      routeData: routeData.data,
      transactionData: (await transactionResponse.json()).data,
    };
  }

  private async getReverseQuote(
    amount: string,
    fromToken: Token,
    toToken: Token,
    userAddress: string,
  ): Promise<string> {
    // Swap fromToken and toToken to get reverse quote
    const result = await this.callKyberApi(amount, toToken, fromToken, userAddress);
    logger.info('🚀 ~ KyberProvider ~ result:', result);
    const outputAmount = result.transactionData.amountOut;
    return ethers.formatUnits(outputAmount, toToken.decimals);
  }

  async getQuote(params: SwapParams, userAddress: string): Promise<SwapQuote> {
    try {
      // check is valid limit order
      if (params?.limitPrice) {
        throw new Error('Kyber does not support limit order for native token swaps');
      }

      // Fetch input and output token information
      const [sourceToken, destinationToken] = await Promise.all([
        this.getToken(params.fromToken, params.network),
        this.getToken(params.toToken, params.network),
      ]);

      let adjustedAmount = params.amount;
      if (params.type === 'input') {
        // Use the adjustAmount method for all tokens (both native and ERC20)
        adjustedAmount = await this.adjustAmount(
          params.fromToken,
          params.amount,
          userAddress,
          params.network,
        );

        if (adjustedAmount !== params.amount) {
          logger.info(`🤖 Kyber adjusted input amount from ${params.amount} to ${adjustedAmount}`);
        }
      }

      // Calculate amountIn based on swap type
      let amountIn: string;
      if (params.type === 'input') {
        amountIn = ethers.parseUnits(adjustedAmount, sourceToken.decimals).toString();
      } else {
        // For output type, get reverse quote to calculate input amount
        const amountReverse = ethers.parseUnits('1', destinationToken.decimals).toString();

        const reverseAdjustedAmount = await this.getReverseQuote(
          amountReverse,
          sourceToken,
          destinationToken,
          userAddress,
        );

        const realAmount = Number(reverseAdjustedAmount) * Number(adjustedAmount);

        amountIn = ethers.parseUnits(realAmount.toString(), sourceToken.decimals).toString();
      }
      // Get swap route and transaction data
      const { routeData, transactionData } = await this.callKyberApi(
        amountIn,
        sourceToken,
        destinationToken,
        userAddress,
      );

      // Create and store quote
      const swapQuote = this.createSwapQuote(
        params,
        sourceToken,
        destinationToken,
        transactionData,
        routeData,
      );
      this.storeQuoteWithExpiry(swapQuote);
      return swapQuote;
    } catch (error: unknown) {
      logger.error('Error getting quote:', error);
      throw new Error(
        `Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // Helper methods for better separation of concerns
  private createSwapQuote(
    params: SwapParams,
    sourceToken: Token,
    destinationToken: Token,
    swapTransactionData: any,
    routeData: any,
  ): SwapQuote {
    const quoteId = ethers.hexlify(ethers.randomBytes(32));

    return {
      quoteId,
      network: params.network,
      fromToken: sourceToken,
      toToken: destinationToken,
      fromAmount: ethers.formatUnits(swapTransactionData.amountIn, sourceToken.decimals),
      toAmount: ethers.formatUnits(swapTransactionData.amountOut, destinationToken.decimals),
      slippage: 100, // 10% default slippage
      type: params.type,
      priceImpact: routeData.priceImpact || 0,
      route: ['kyber'],
      estimatedGas: CONSTANTS.DEFAULT_GAS_LIMIT,
      tx: {
        to: swapTransactionData.routerAddress,
        data: swapTransactionData.data,
        value: swapTransactionData.transactionValue || '0',
        gasLimit: ethers.parseUnits(CONSTANTS.DEFAULT_GAS_LIMIT, 'wei'),
        network: params.network,
        spender: swapTransactionData.routerAddress,
      },
    };
  }

  private storeQuoteWithExpiry(quote: SwapQuote) {
    this.quotes.set(quote.quoteId, { quote, expiresAt: Date.now() + CONSTANTS.QUOTE_EXPIRY });

    // Delete quote after expiry
    setTimeout(() => {
      this.quotes.delete(quote.quoteId);
    }, CONSTANTS.QUOTE_EXPIRY);
  }
}
