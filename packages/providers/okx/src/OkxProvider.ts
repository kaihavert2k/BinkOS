import { SwapQuote, SwapParams, NetworkProvider, BaseSwapProvider } from '@binkai/swap-plugin';
import { ethers, Provider } from 'ethers';
import CryptoJS from 'crypto-js';
import { EVM_NATIVE_TOKEN_ADDRESS, NetworkName, Token, logger } from '@binkai/core';

// Constants for better maintainability
const CONSTANTS = {
  DEFAULT_GAS_LIMIT: '350000',
  APPROVE_GAS_LIMIT: '50000',
  QUOTE_EXPIRY: 5 * 60 * 1000, // 5 minutes in milliseconds
  OKX_BNB_ADDRESS: EVM_NATIVE_TOKEN_ADDRESS,
  OKX_APPROVE_ADDRESS: '0x2c34A2Fb1d0b4f55de51E1d0bDEfaDDce6b7cDD6',
} as const;

enum ChainId {
  BSC = 56,
  ETH = 1,
}

export class OkxProvider extends BaseSwapProvider {
  private chainId: ChainId;
  private readonly apiKey: string;
  private readonly secretKey: string;
  private readonly passphrase: string;
  private readonly projectId: string;
  protected GAS_BUFFER: bigint = ethers.parseEther('0.0003');

  constructor(provider: Provider, chainId: ChainId = ChainId.BSC) {
    // Create a Map with BNB network and the provider
    const providerMap = new Map<NetworkName, NetworkProvider>();
    providerMap.set(NetworkName.BNB, provider);

    super(providerMap);
    this.chainId = chainId;
    this.apiKey = process.env.OKX_API_KEY || '';
    this.secretKey = process.env.OKX_SECRET_KEY || '';
    this.passphrase = process.env.OKX_PASSPHRASE || '';
    this.projectId = process.env.OKX_PROJECT || '';
  }

  getName(): string {
    return 'okx';
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

  /**
   * Generates OKX API signature and headers
   * @param path API endpoint path
   * @param timestamp ISO timestamp
   * @returns Headers for OKX API request
   */
  private generateApiHeaders(path: string, timestamp: string): HeadersInit {
    const signature = CryptoJS.enc.Base64.stringify(
      CryptoJS.HmacSHA256(timestamp + 'GET' + path, this.secretKey),
    );

    return {
      'OK-ACCESS-KEY': this.apiKey,
      'OK-ACCESS-SIGN': signature,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': this.passphrase,
      'OK-ACCESS-PROJECT': this.projectId,
    };
  }

  /**
   * Calls OKX API to get swap quote
   * @param amount Amount to swap
   * @param fromToken Token to swap from
   * @param toToken Token to swap to
   * @param userAddress User's wallet address
   * @param slippage Slippage percentage
   * @returns OKX API response
   */
  private async callOkxApi(
    amount: string,
    fromToken: Token,
    toToken: Token,
    userAddress: string,
    slippage: number,
  ) {
    const now = new Date();
    const isoString = now.toISOString();
    const slippageOKX = Number(slippage) / 100 || 0.1;

    const path = `/api/v5/dex/aggregator/swap?amount=${amount}&chainId=${this.chainId}&fromTokenAddress=${fromToken.address}&toTokenAddress=${toToken.address}&slippage=${slippageOKX}&userWalletAddress=${userAddress}`;

    logger.info('🤖 OKX Path', path);

    const headers = this.generateApiHeaders(path, isoString);

    const response = await fetch(`https://www.okx.com${path}`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    logger.info('🚀 ~ OkxProvider ~ data:', data);
    if (!data.data || data.data.length === 0) {
      throw new Error('No data returned from OKX');
    }

    return data.data[0];
  }

  /**
   * Gets reverse quote from OKX API
   * @param amount Amount to swap
   * @param fromToken Token to swap from
   * @param toToken Token to swap to
   * @param userAddress User's wallet address
   * @param slippage Slippage percentage
   * @returns Adjusted amount in fromToken decimals
   */
  private async getReverseQuote(
    amount: string,
    fromToken: Token,
    toToken: Token,
    userAddress: string,
    slippage: number,
  ): Promise<string> {
    // Swap fromToken and toToken to get reverse quote
    const result = await this.callOkxApi(amount, toToken, fromToken, userAddress, slippage);
    const outputAmount = result.routerResult.toTokenAmount;
    return ethers.formatUnits(outputAmount, fromToken.decimals);
  }

  async getQuote(params: SwapParams, userAddress: string): Promise<SwapQuote> {
    try {
      // check is valid limit order
      if (params?.limitPrice) {
        throw new Error('OKX does not support limit order for native token swaps');
      }

      if (params.type === 'output') {
        throw new Error('OKX does not support output swaps');
      }

      const [tokenIn, tokenOut] = await Promise.all([
        this.getToken(params.fromToken, params.network),
        this.getToken(params.toToken, params.network),
      ]);

      let adjustedAmount = params.amount;
      if (params.type === 'input') {
        adjustedAmount = await this.adjustAmount(
          params.fromToken,
          params.amount,
          userAddress,
          params.network,
        );

        if (adjustedAmount !== params.amount) {
          logger.info(`🤖 Okx adjusted input amount from ${params.amount} to ${adjustedAmount}`);
        }
      }

      // Calculate amountIn based on swap type
      let amountIn: string;
      if (params.type === 'input') {
        amountIn = ethers.parseUnits(adjustedAmount, tokenIn.decimals).toString();
      } else {
        // For output type, get reverse quote to calculate input amount
        const amountReverse = ethers.parseUnits('1', tokenOut.decimals).toString();

        const reverseAdjustedAmount = await this.getReverseQuote(
          amountReverse,
          tokenIn,
          tokenOut,
          userAddress,
          params.slippage,
        );

        const realAmount = Number(reverseAdjustedAmount) * Number(adjustedAmount);

        amountIn = ethers.parseUnits(realAmount.toString(), tokenIn.decimals).toString();
      }

      const result = await this.callOkxApi(
        amountIn,
        tokenIn,
        tokenOut,
        userAddress,
        params.slippage,
      );
      logger.info('🚀 ~ OkxProvider ~ getQuote ~ result:', result);

      const inputAmount = result.routerResult.fromTokenAmount;
      const outputAmount = result.routerResult.toTokenAmount;
      const estimatedGas = result.routerResult.estimatedGas;
      const priceImpact = Number(result.routerResult.priceImpactPercentage);
      const tx = result.tx;

      // Generate a unique quote ID
      const quoteId = ethers.hexlify(ethers.randomBytes(32));

      const quote: SwapQuote = {
        network: params.network,
        quoteId,
        fromToken: tokenIn,
        toToken: tokenOut,
        slippage: params.slippage,
        fromAmount: ethers.formatUnits(inputAmount.toString(), tokenIn.decimals),
        toAmount: ethers.formatUnits(outputAmount.toString(), tokenOut.decimals),
        priceImpact,
        route: ['okx'],
        estimatedGas: estimatedGas,
        type: params.type,
        tx: {
          to: tx?.to || '',
          data: tx?.data || '',
          value: tx?.value || '0',
          gasLimit:
            ethers.parseUnits((tx.gas * 1.5).toString(), 'wei') ||
            ethers.parseUnits('350000', 'wei'),
          network: params.network,
          spender: CONSTANTS.OKX_APPROVE_ADDRESS,
        },
      };
      // Store the quote and trade for later use
      this.quotes.set(quoteId, { quote, expiresAt: Date.now() + CONSTANTS.QUOTE_EXPIRY });

      // Delete quote after 5 minutes
      setTimeout(() => {
        this.quotes.delete(quoteId);
      }, CONSTANTS.QUOTE_EXPIRY);

      return quote;
    } catch (error: unknown) {
      logger.error('Error getting quote:', error);
      throw new Error(
        `Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
