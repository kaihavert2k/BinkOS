import { ISwapProvider, SwapQuote, SwapParams } from '@binkai/swap-plugin';
import { BaseSwapProvider, NetworkProvider } from '@binkai/swap-plugin';
import {
  ChainId,
  Token as PancakeToken,
  CurrencyAmount,
  TradeType,
  Percent,
  Currency,
  Native,
} from '@pancakeswap/sdk';
import { EVM_NATIVE_TOKEN_ADDRESS, NetworkName, Token, logger } from '@binkai/core';
import { ethers, Contract, Interface, Provider } from 'ethers';
import { createPublicClient, http, PublicClient } from 'viem';
import { bsc } from 'viem/chains';
import { SMART_ROUTER_ADDRESSES, SwapRouter, V4Router } from '@pancakeswap/smart-router';
import { parseTokenAmount } from '@binkai/swap-plugin';

export class PancakeSwapProvider extends BaseSwapProvider {
  private viemClient: PublicClient;
  private chainId: ChainId;
  protected GAS_BUFFER: bigint = ethers.parseEther('0.0003');

  constructor(provider: Provider, chainId: ChainId = ChainId.BSC) {
    // Create a Map with BNB network and the provider
    const providerMap = new Map<NetworkName, NetworkProvider>();
    providerMap.set(NetworkName.BNB, provider);

    super(providerMap);
    this.chainId = chainId;

    // Initialize viem client
    this.viemClient = createPublicClient({
      chain: bsc,
      transport: http('https://bsc-dataseed1.binance.org'),
      batch: {
        multicall: {
          batchSize: 1024 * 200,
        },
      },
    });
  }

  getName(): string {
    return 'pancakeswap';
  }

  getSupportedNetworks(): NetworkName[] {
    return [NetworkName.BNB];
  }

  // Keep this for backward compatibility
  getSupportedChains(): string[] {
    return ['bnb'];
  }

  protected isNativeToken(tokenAddress: string): boolean {
    return tokenAddress.toLowerCase() === EVM_NATIVE_TOKEN_ADDRESS.toLowerCase();
  }

  protected async getToken(tokenAddress: string, network: NetworkName): Promise<PancakeToken> {
    const token = await super.getToken(tokenAddress, network);
    return new PancakeToken(
      this.chainId,
      tokenAddress as `0x${string}`,
      token.decimals,
      token.symbol,
    );
  }

  private async getCandidatePools(tokenIn: Currency, tokenOut: Currency) {
    try {
      const v3Pools = await V4Router.getV3CandidatePools({
        clientProvider: () => this.viemClient,
        currencyA: tokenIn,
        currencyB: tokenOut,
      });
      return v3Pools;
    } catch (error) {
      logger.warn('Failed to fetch V3 pools:', error);
      throw new Error('No liquidity pools found for the token pair');
    }
  }

  async getQuote(params: SwapParams, userAddress: string): Promise<SwapQuote> {
    try {
      // check is valid limit order
      if (params?.limitPrice) {
        throw new Error('PancakeSwap does not support limit order for native token swaps');
      }

      if (params.fromToken === Native.onChain(this.chainId).wrapped.address) {
        params.fromToken = EVM_NATIVE_TOKEN_ADDRESS;
      }

      if (params.toToken === Native.onChain(this.chainId).wrapped.address) {
        params.toToken = EVM_NATIVE_TOKEN_ADDRESS;
      }

      const [tokenIn, tokenOut] = await Promise.all([
        params.fromToken.toLowerCase() === EVM_NATIVE_TOKEN_ADDRESS.toLowerCase()
          ? Native.onChain(this.chainId)
          : this.getToken(params.fromToken, params.network),
        params.toToken.toLowerCase() === EVM_NATIVE_TOKEN_ADDRESS.toLowerCase()
          ? Native.onChain(this.chainId)
          : this.getToken(params.toToken, params.network),
      ]);

      // If input token is native token and it's an exact input swap
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
          logger.info(
            `🤖 PancakeSwap adjusted input amount from ${params.amount} to ${adjustedAmount}`,
          );
        }
      }

      // Create currency amounts
      const amountIn =
        params.type === 'input'
          ? CurrencyAmount.fromRawAmount(
              tokenIn,
              parseTokenAmount(adjustedAmount, tokenIn.decimals).toString(),
            )
          : undefined;
      const amountOut =
        params.type === 'output'
          ? CurrencyAmount.fromRawAmount(
              tokenOut,
              parseTokenAmount(params.amount, tokenOut.decimals).toString(),
            )
          : undefined;

      // Get candidate pools
      const pools = await this.getCandidatePools(tokenIn, tokenOut);

      logger.info('🤖 Pools:', pools.length);

      // Get the best trade using V4Router
      const trade =
        params.type === 'input' && amountIn
          ? await V4Router.getBestTrade(amountIn, tokenOut, TradeType.EXACT_INPUT, {
              gasPriceWei: () => this.viemClient.getGasPrice(),
              candidatePools: pools,
            })
          : amountOut
            ? await V4Router.getBestTrade(amountOut, tokenIn, TradeType.EXACT_OUTPUT, {
                gasPriceWei: () => this.viemClient.getGasPrice(),
                candidatePools: pools,
              })
            : null;

      if (!trade) {
        throw new Error('No route found');
      }

      // Calculate output amounts based on trade type
      const { inputAmount, outputAmount } = trade;

      // Generate a unique quote ID
      const quoteId = ethers.hexlify(ethers.randomBytes(32));

      const { value, calldata } = SwapRouter.swapCallParameters(trade as any, {
        recipient: userAddress as `0x${string}`,
        slippageTolerance: new Percent(Math.floor(params.slippage * 100), 10000),
      });

      // Create token objects that match the expected Token type
      const fromTokenObj: Token = {
        address: params.fromToken as `0x${string}`,
        decimals: tokenIn.decimals,
        symbol: tokenIn.symbol,
      };

      if (params.fromToken === EVM_NATIVE_TOKEN_ADDRESS) {
        fromTokenObj.address = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        fromTokenObj.symbol = 'BNB';
      }

      const toTokenObj: Token = {
        address: params.toToken as `0x${string}`,
        decimals: tokenOut.decimals,
        symbol: tokenOut.symbol,
      };

      if (params.toToken === EVM_NATIVE_TOKEN_ADDRESS) {
        toTokenObj.address = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        toTokenObj.symbol = 'BNB';
      }

      const quote: SwapQuote = {
        quoteId,
        fromToken: fromTokenObj,
        toToken: toTokenObj,
        fromAmount:
          params.type === 'input'
            ? adjustedAmount
            : ethers.formatUnits(inputAmount.quotient.toString(), tokenIn.decimals),
        toAmount:
          params.type === 'output'
            ? params.amount
            : ethers.formatUnits(outputAmount.quotient.toString(), tokenOut.decimals),
        priceImpact: Number((trade as any).priceImpact?.toSignificant(2) || 0),
        route: trade.routes.map(route => (route as any).path[0].address),
        estimatedGas: '350000', // TODO: get gas limit from trade
        type: params.type,
        slippage: params.slippage,
        network: params.network,
        tx: {
          to: SMART_ROUTER_ADDRESSES[this.chainId as keyof typeof SMART_ROUTER_ADDRESSES],
          spender: SMART_ROUTER_ADDRESSES[this.chainId as keyof typeof SMART_ROUTER_ADDRESSES],
          data: calldata,
          value: value.toString(),
          network: params.network,
        },
      };

      // Store the quote and trade for later use
      this.storeQuote(quote, { trade });

      return quote;
    } catch (error: unknown) {
      logger.error('Error getting quote:', error);
      throw new Error(
        `Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
