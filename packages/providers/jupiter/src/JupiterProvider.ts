import {
  BaseSwapProvider,
  NetworkProvider,
  parseTokenAmount,
  SwapParams,
  SwapQuote,
} from '@binkai/swap-plugin';
import {
  NetworkName,
  SOL_NATIVE_TOKEN_ADDRESS,
  SOL_NATIVE_TOKEN_ADDRESS2,
  Token,
  logger,
} from '@binkai/core';

import axios, { AxiosInstance, AxiosError } from 'axios';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
  JupiterError,
  JupiterQuoteParams,
  JupiterQuoteResponse,
  JupiterResponse,
  JupiterSwapResponse,
  SwapMode,
} from './utils';
import { Provider, ethers, Contract, Interface } from 'ethers';

const STABLE_TOKENS = {
  USDC_ADDRESS: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT_ADDRESS: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

export class JupiterProvider extends BaseSwapProvider {
  private api: AxiosInstance;
  private static readonly DEFAULT_BASE_URL = 'https://ultra-api.jup.ag/proxy';
  private static readonly BASE_URL_JUPITER = 'https://api.jup.ag';
  private provider: Connection;
  constructor(provider: Connection) {
    const providerMap = new Map<NetworkName, NetworkProvider>();
    providerMap.set(NetworkName.SOLANA, provider);
    super(providerMap);
    this.api = axios.create({
      baseURL: JupiterProvider.DEFAULT_BASE_URL,
      headers: {
        Accept: 'application/json',
      },
    });

    this.provider = this.getSolanaProviderForNetwork(NetworkName.SOLANA);
  }

  getName(): string {
    return 'jupiter';
  }

  getSupportedNetworks(): NetworkName[] {
    return [NetworkName.SOLANA];
  }

  protected isNativeToken(tokenAddress: string): boolean {
    return tokenAddress.toLowerCase() === SOL_NATIVE_TOKEN_ADDRESS.toLowerCase();
  }

  protected async getToken(tokenAddress: string, network: NetworkName): Promise<Token> {
    if (this.isNativeToken(tokenAddress)) {
      return {
        address: 'So11111111111111111111111111111111111111112', // hardcoded solana native token address
        decimals: 9,
        symbol: 'SOL',
      };
    }

    const token = await super.getToken(tokenAddress, network);

    const tokenInfo = {
      chainId: 'solana',
      address: token.address,
      decimals: token.decimals,
      symbol: token.symbol,
    };
    return tokenInfo;
  }

  private handleError(error: unknown): JupiterError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<JupiterError>;
      return {
        error: axiosError.response?.data?.error || axiosError.message,
        message: axiosError.response?.data?.message,
        code: axiosError.response?.status,
      };
    }
    return {
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }

  async getSwapBuyAggregator(params: any, userPublicKey: string): Promise<JupiterSwapResponse> {
    try {
      const response = await this.api.post<JupiterSwapResponse>('/swap?swapType=aggregator', {
        addConsensusAccount: false,
        allowOptimizedWrappedSolTokenAccount: true,
        asLegacyTransaction: false,
        correctLastValidBlockHeight: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            global: false,
            maxLamports: 1400000,
            priorityLevel: 'veryHigh',
          },
        },
        quoteResponse: params,
        userPublicKey: userPublicKey,
        wrapAndUnwrapSol: true,
      });
      const data = response?.data;
      // const latestBlockhash = await this.provider.getLatestBlockhash('confirmed');
      // data.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      return data;
    } catch (error) {
      throw new Error('Failed to get swap buy aggregator');
    }
  }

  async getSwapTransactions(params: any): Promise<JupiterResponse<JupiterSwapResponse>> {
    try {
      const response = await this.api.post<JupiterSwapResponse>('/swap', {
        quoteResponse: params.quoteResponse,
        userPublicKey: params.userPublicKey,
        wrapUnwrapSol: params.wrapUnwrapSol,
        useSharedAccounts: params.useSharedAccounts,
        feeAccount: params.feeAccount,
        trackingAccount: params.trackingAccount,
        computeUnitPriceMicroLamports: params.computeUnitPriceMicroLamports,
        prioritizationFeeLamports: params.prioritizationFeeLamports,
        asLegacyTransaction: params.asLegacyTransaction,
        useTokenLedger: params.useTokenLedger,
        destinationTokenAccount: params.destinationTokenAccount,
        dynamicComputeUnitLimit: params.dynamicComputeUnitLimit,
        skipUserAccountsRpcCalls: params.skipUserAccountsRpcCalls,
        dynamicSlippage: params.dynamicSlippage,
      });

      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  private async cancelOrder(orderId: string | string[], userAddress?: string) {
    const url = `${JupiterProvider.BASE_URL_JUPITER}/trigger/v1/cancelOrders`;

    const headers = {
      accept: 'application/json',
      'content-type': 'application/json', // Important for POST requests with a body
      // Include other headers if necessary (see previous response for guidance)
    };
    const request = {
      maker: userAddress,
      orderIds: [orderId],
    };

    try {
      const response = await fetch(url, {
        method: 'POST', // Note the method is now POST
        headers: headers,
        body: JSON.stringify(request), // Convert the request object to JSON
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const latestBlockhash = await this.provider.getLatestBlockhash('confirmed');
      return {
        tx: data.transactions[0],
        to: userAddress,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      };
    } catch (error) {
      logger.error('Error canceling trigger orders:', error);
      throw error;
    }
  }

  async getCreateLimitOrder(
    params: JupiterQuoteResponse,
    userAddress: string,
    takingAmount: string,
  ) {
    try {
      const createOrderResponse = await (
        await fetch(`${JupiterProvider.BASE_URL_JUPITER}/trigger/v1/createOrder`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            computeUnitPrice: 'auto',
            inputMint: params.inputMint.toString(),
            outputMint: params.outputMint.toString(),
            maker: userAddress,
            payer: userAddress,
            params: {
              makingAmount: params.inAmount,
              takingAmount: takingAmount,
            },
          }),
        })
      ).json();
      if (createOrderResponse.error) {
        throw new Error(createOrderResponse.error);
      }
      // const latestBlockhash = await this.provider.getLatestBlockhash('confirmed');
      // createOrderResponse.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

      return createOrderResponse;
    } catch (error) {
      return this.handleError(error);
    }
  }

  public async getAllOrderIds(userAddress: string) {
    try {
      const page = 1;
      const orderStatus = 'active';
      const includeFailedTx = false;
      const url = `${JupiterProvider.BASE_URL_JUPITER}/trigger/v1/getTriggerOrders?user=${userAddress}&page=${page}&orderStatus=${orderStatus}&includeFailedTx=${includeFailedTx}`;

      const headers = {
        accept: 'application/json',
      };

      const response = await fetch(url, {
        method: 'GET',
        headers: headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      return data?.orders;
    } catch (error) {
      return this.handleError(error);
    }
  }

  async getQuoteJupiter(
    params: JupiterQuoteParams,
    userAddress: string,
  ): Promise<JupiterQuoteResponse> {
    try {
      const queryParams = {
        inputMint: params.inputMint.toString(),
        outputMint: params.outputMint.toString(),
        amount: params.amount,
        ...(params.slippageBps !== undefined && { slippageBps: params.slippageBps }),
        ...(params.swapMode && { swapMode: params.swapMode }),
        ...(params.dexes?.length && { dexes: params.dexes.join(',') }),
        ...(params.excludeDexes?.length && { excludeDexes: params.excludeDexes.join(',') }),
        ...(params.restrictIntermediateTokens !== undefined && {
          restrictIntermediateTokens: params.restrictIntermediateTokens,
        }),
        ...(params.onlyDirectRoutes !== undefined && { onlyDirectRoutes: params.onlyDirectRoutes }),
        ...(params.asLegacyTransaction !== undefined && {
          asLegacyTransaction: params.asLegacyTransaction,
        }),
        ...(params.platformFeeBps !== undefined && { platformFeeBps: params.platformFeeBps }),
        ...(params.maxAccounts !== undefined && { maxAccounts: params.maxAccounts }),
        ...(params.autoSlippage !== undefined && { autoSlippage: params.autoSlippage }),
        ...(params.maxAutoSlippageBps !== undefined && {
          maxAutoSlippageBps: params.maxAutoSlippageBps,
        }),
        ...(params.autoSlippageCollisionUsdValue !== undefined && {
          autoSlippageCollisionUsdValue: params.autoSlippageCollisionUsdValue,
        }),
      };
      logger.info('🚀 ~ JupiterProvider ~ getQuoteJupiter ~ queryParams:', queryParams);

      const response = await this.api.get<JupiterQuoteResponse>('/quote', {
        params: queryParams,
      });

      return response.data;
    } catch (error) {
      throw new Error('Failed to get quote');
    }
  }

  async getTokenPrices(tokenIds: string[]) {
    const baseUrl = 'https://api.jup.ag/price/v2';
    const params = new URLSearchParams({
      ids: tokenIds.join(','),
      showExtraInfo: 'true',
    });
    const url = `${baseUrl}?${params.toString()}`;

    const headers = {
      accept: '*/*',
    };

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json(); // Type assertion for the response

      return data?.data;
    } catch (error) {
      logger.error('Error fetching token prices:', error);
      throw new Error('Jupiter not support this token');
    }
  }

  private checkIsStableToken(tokenAddress: string) {
    if (
      tokenAddress.toLowerCase() === STABLE_TOKENS.USDC_ADDRESS.toLowerCase() ||
      tokenAddress.toLowerCase() === STABLE_TOKENS.USDT_ADDRESS.toLowerCase()
    ) {
      return true;
    } else {
      return false;
    }
  }

  async getQuote(params: SwapParams, userAddress: string): Promise<SwapQuote> {
    try {
      const [sourceToken, destinationToken] = await Promise.all([
        this.getToken(params.fromToken, params.network),
        this.getToken(params.toToken, params.network),
      ]);

      logger.info('🤖 Jupiter quote sourceToken:', sourceToken);
      logger.info('🤖 Jupiter quote destinationToken:', destinationToken);

      let adjustedAmount = params.amount;

      if (params.type === 'input') {
        adjustedAmount = await this.adjustAmount(
          params.fromToken,
          params.amount,
          userAddress,
          params.network,
        );

        if (adjustedAmount !== params.amount) {
          logger.info(
            `🤖 Jupiter adjusted input amount from ${params.amount} to ${adjustedAmount}`,
          );
        }
      }

      const swapMode = params.type === 'input' ? SwapMode.ExactIn : SwapMode.ExactOut;

      let swapData;
      let getSwapBuyAggregator;
      let amountOutLimitOrder;
      if (params?.limitPrice && Number(params?.limitPrice) !== 0) {
        const tokenInStable = this.checkIsStableToken(sourceToken.address);
        const tokenOutStable = this.checkIsStableToken(destinationToken.address);

        if (!tokenInStable && !tokenOutStable) {
          throw new Error('Jupiter only support limit order with USDC, USDT as input token');
        }

        if (!params?.limitPrice || Number(params?.limitPrice) < 0) {
          throw new Error('No amount out from Jupiter');
        }

        swapData = await this.getQuoteJupiter(
          {
            inputMint: new PublicKey(sourceToken.address),
            outputMint: new PublicKey(destinationToken.address),
            amount: Number(parseTokenAmount(adjustedAmount, sourceToken.decimals)),
            swapMode,
          },
          userAddress,
        );

        let amountOut;
        const amount = Number(params?.amount.toString());
        const price = Number(params?.limitPrice.toString());

        amountOut = tokenInStable
          ? amount * (price > 1 ? 1 / price : 1 / price)
          : amount * (price > 1 ? price : 1 / (1 / price));

        amountOutLimitOrder = parseTokenAmount(
          amountOut.toString(),
          destinationToken.decimals,
        ).toString();

        getSwapBuyAggregator = await this.getCreateLimitOrder(
          swapData,
          userAddress,
          amountOutLimitOrder,
        );
      } else {
        swapData = await this.getQuoteJupiter(
          {
            inputMint: new PublicKey(sourceToken.address),
            outputMint: new PublicKey(destinationToken.address),
            amount: Number(
              parseTokenAmount(
                adjustedAmount,
                swapMode === SwapMode.ExactIn ? sourceToken.decimals : destinationToken.decimals,
              ),
            ),
            swapMode,
          },
          userAddress,
        );
        // build transaction
        getSwapBuyAggregator = await this.getSwapBuyAggregator(swapData, userAddress);
      }

      if (!getSwapBuyAggregator) {
        throw new Error('Failed to get swap buy aggregator');
      }

      const quoteId = ethers.hexlify(ethers.randomBytes(32));
      const quote: SwapQuote = {
        quoteId: quoteId,
        fromToken: sourceToken,
        toToken: destinationToken,
        fromAmount: ethers.formatUnits(swapData.inAmount, sourceToken.decimals),
        toAmount: params?.limitPrice
          ? amountOutLimitOrder?.toString() || '0'
          : ethers.formatUnits(swapData.outAmount, destinationToken.decimals),
        priceImpact: 0,
        route: [],
        estimatedGas: '',
        type: params.type,
        slippage: params.slippage,
        network: params.network,
        tx: {
          to: userAddress,
          spender: userAddress,
          data: params?.limitPrice
            ? getSwapBuyAggregator?.transaction
            : getSwapBuyAggregator?.swapTransaction,
          lastValidBlockHeight: getSwapBuyAggregator?.lastValidBlockHeight,
          value: parseTokenAmount(adjustedAmount, sourceToken.decimals).toString(),
          network: params.network,
        },
      };
      this.storeQuote(quote);
      return quote;
    } catch (error: unknown) {
      logger.error('Error getting quote:', error);
      throw new Error(
        `Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
