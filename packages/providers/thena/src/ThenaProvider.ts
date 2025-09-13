import {
  SwapQuote,
  SwapParams,
  BaseSwapProvider,
  NetworkProvider,
  parseTokenAmount,
} from '@binkai/swap-plugin';
import { Contract, ethers, Provider } from 'ethers';
import { EVM_NATIVE_TOKEN_ADDRESS, NetworkName, Token, logger } from '@binkai/core';
import { OrbsABI } from './abis/Orbs';
import { WrapTokenABI } from './abis/WrapToken';

// Core system constants
export const CONSTANTS = {
  DEFAULT_GAS_LIMIT: '350000',
  APPROVE_GAS_LIMIT: '50000',
  QUOTE_EXPIRY: 5 * 60 * 1000, // 5 minutes in milliseconds
  BNB_ADDRESS: EVM_NATIVE_TOKEN_ADDRESS,
  THENA_BNB_ADDRESS: '0x0000000000000000000000000000000000000000',
  THENA_API_BASE: 'https://api.odos.xyz/sor/',
  TIME_DELAY: 60,
  EXCHANGE_ADDRESS: '0xc2aBC02acd77Bb2407efA22348dA9afC8B375290', // OpenOceanExchange
  ORBS_ADDRESS: '0x25a0A78f5ad07b2474D3D42F1c1432178465936d',
  WRAP_BNB_ADDRESS: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  USDC_ADDRESS: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  USDT_ADDRESS: '0x55d398326f99059ff775485246999027b3197955',
  BUSD_ADDRESS: '0xe9e7cea3dedca5984780bafc599bd69add087d56',
} as const;

enum ChainId {
  BSC = 56,
  ETH = 1,
}

export class ThenaProvider extends BaseSwapProvider {
  private provider: Provider;
  private chainId: ChainId;
  protected GAS_BUFFER: bigint = ethers.parseEther('0.0003');
  private orbsContract: Contract;

  constructor(provider: Provider, chainId: ChainId = ChainId.BSC) {
    // Create a Map with BNB network and the provider
    const providerMap = new Map<NetworkName, NetworkProvider>();
    providerMap.set(NetworkName.BNB, provider);

    super(providerMap);
    this.provider = provider;
    this.chainId = chainId;
    this.orbsContract = new ethers.Contract(CONSTANTS.ORBS_ADDRESS, OrbsABI, this.provider);
  }

  getName(): string {
    return 'thena';
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

  async getQuote(params: SwapParams, userAddress: string): Promise<SwapQuote> {
    try {
      const isInputType = params.type === 'input';
      const fromToken = isInputType ? params.fromToken : params.toToken;
      const toToken = isInputType ? params.toToken : params.fromToken;

      const [sourceToken, destinationToken] = await Promise.all([
        this.getToken(fromToken, params.network),
        this.getToken(toToken, params.network),
      ]);

      let tokenInAddress =
        sourceToken.address === CONSTANTS.BNB_ADDRESS
          ? CONSTANTS.THENA_BNB_ADDRESS
          : sourceToken.address;
      let tokenOutAddress =
        destinationToken.address === CONSTANTS.BNB_ADDRESS
          ? CONSTANTS.THENA_BNB_ADDRESS
          : destinationToken.address;

      let adjustedAmount = params.amount;
      if (isInputType) {
        adjustedAmount = await this.adjustAmount(
          fromToken,
          params.amount,
          userAddress,
          params.network,
        );
        if (adjustedAmount !== params.amount) {
          logger.info(`🤖 Thena adjusted input amount from ${params.amount} to ${adjustedAmount}`);
        }
      }

      let amountIn = ethers.parseUnits(
        adjustedAmount,
        isInputType ? sourceToken.decimals : destinationToken.decimals,
      );

      let routeParams = {
        tokenIn: tokenInAddress,
        tokenOut: tokenOutAddress,
        userAddress,
        slippage: params.slippage,
        amount: amountIn.toString(),
      };

      if (!isInputType) {
        const reverseRoute = await this.fetchOptimalRoute(
          routeParams.tokenIn,
          routeParams.tokenOut,
          routeParams.userAddress,
          routeParams.slippage,
          routeParams.amount,
        );
        amountIn = reverseRoute.outAmounts[0];
        tokenInAddress = reverseRoute.outTokens[0];
        tokenOutAddress = reverseRoute.inTokens[0];
        routeParams = {
          ...routeParams,
          tokenIn: tokenInAddress,
          tokenOut: tokenOutAddress,
          amount: amountIn.toString(),
        };
      }

      let swapTransactionData: any;
      let optimalRoute: any;
      let amountOut: string | undefined;

      const limitPrice = Number(params?.limitPrice || 0);
      if (limitPrice > 0) {
        const tokenInStable = this.checkIsStableToken(tokenInAddress);
        const tokenOutStable = this.checkIsStableToken(tokenOutAddress);

        if (!tokenInStable && !tokenOutStable) {
          throw new Error('Thena only supports limit orders with USDC, USDT, BUSD as input token');
        }

        const multiplier = limitPrice > 1 ? limitPrice : 1 / limitPrice;
        amountOut = (Number(amountIn) * (tokenInStable ? 1 / multiplier : multiplier)).toFixed(0);

        optimalRoute = await this.fetchOptimalRoute(
          tokenInAddress,
          tokenOutAddress,
          userAddress,
          params?.slippage,
          amountIn.toString(),
          params?.limitPrice,
        );

        swapTransactionData = await this.buildLimitOrderRouteTransaction(
          optimalRoute,
          userAddress,
          amountOut,
        );
        if (!swapTransactionData) throw new Error('No limit order routes available from Thena');
      } else {
        optimalRoute = await this.fetchOptimalRoute(
          tokenInAddress,
          tokenOutAddress,
          userAddress,
          params?.slippage,
          amountIn.toString(),
        );
        logger.info('optimalRoute', optimalRoute);

        swapTransactionData = await this.buildSwapRouteTransaction(optimalRoute, userAddress);
        if (!swapTransactionData) throw new Error('No swap routes available from Thena');
      }

      const swapQuote = this.createSwapQuote(
        params,
        isInputType ? sourceToken : destinationToken,
        isInputType ? destinationToken : sourceToken,
        swapTransactionData,
        optimalRoute,
        userAddress,
        amountOut?.toString(),
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

  private checkIsStableToken(tokenAddress: string) {
    if (
      tokenAddress.toLowerCase() === CONSTANTS.USDC_ADDRESS.toLowerCase() ||
      tokenAddress.toLowerCase() === CONSTANTS.USDT_ADDRESS.toLowerCase() ||
      tokenAddress.toLowerCase() === CONSTANTS.BUSD_ADDRESS.toLowerCase()
    ) {
      return true;
    } else {
      return false;
    }
  }

  // Helper methods for better separation of concerns
  private async fetchOptimalRoute(
    sourceToken: string,
    destinationToken: string,
    userAddress: string,
    slippage: number,
    amount?: string,
    limitPrice?: number,
  ) {
    const body = JSON.stringify({
      chainId: this.chainId,
      inputTokens: [
        {
          tokenAddress: sourceToken,
          amount: amount,
        },
      ],
      outputTokens: [
        {
          tokenAddress: destinationToken,
          proportion: 1,
        },
      ],
      userAddr: userAddress,
      slippageLimitPercent: slippage,
      pathVizImageConfig: {
        linkColors: ['#B386FF', '#FBA499', '#F9EC66', '#F199EE'],
        nodeColor: '#422D4C',
        nodeTextColor: '#D9D5DB',
        legendTextColor: '#FCE6FB',
        height: 300,
      },
    });

    const routeResponse = await fetch(`${CONSTANTS.THENA_API_BASE}quote/v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body,
    });

    const routeData = await routeResponse.json();

    if (routeData.errorCode === 2000) {
      throw new Error('No swap routes available from Thena');
    }
    return routeData;
  }

  private async buildSwapRouteTransaction(routeData: any, userAddress: string) {
    const transactionResponse = await fetch(`${CONSTANTS.THENA_API_BASE}assemble`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userAddr: userAddress,
        pathId: routeData.pathId,
        simulate: true,
      }),
      redirect: 'follow',
    });
    return await transactionResponse.json();
  }

  private async buildLimitOrderRouteTransaction(
    routeData: any,
    userAddress: string,
    amountOut: string,
  ) {
    const ask = {
      exchange: CONSTANTS.EXCHANGE_ADDRESS,
      srcToken: routeData.inTokens[0],
      dstToken: routeData.outTokens[0],
      srcAmount: routeData.inAmounts[0],
      srcBidAmount: routeData.inAmounts[0],
      dstMinAmount: amountOut,
      deadline: Math.floor(Date.now() / 1000) + 24 * 3600, // 1 day will expire
      bidDelay: CONSTANTS.TIME_DELAY,
      fillDelay: '0',
      data: '0x',
    };

    try {
      const tx = this.orbsContract.interface.encodeFunctionData(
        'ask((address,address,address,uint256,uint256,uint256,uint32,uint32,uint32,bytes))',
        [ask],
      );

      return tx;
    } catch (error) {
      logger.error('Error creating TWAP order:', error);
      throw error;
    }
  }

  public async getAllOrderIds(userAddress: string) {
    const orderIds = await this.orbsContract.orderIdsByMaker(userAddress);
    return orderIds.map((id: any) => Number(id));
  }

  public async checkValidOrderId(orderId: number) {
    const currentTime = Math.floor(Date.now() / 1000);
    const order = await this.orbsContract.status(orderId);
    return Number(order) >= currentTime ? 1 : 0;
  }

  private cancelOrder(orderId: number, userAddress?: string) {
    const tx = this.orbsContract.interface.encodeFunctionData('cancel(uint64)', [orderId]);
    return { tx, to: CONSTANTS.ORBS_ADDRESS };
  }

  private async getStatusOrderId(orderId: number) {
    const order = await this.orbsContract.order(orderId);
    return order;
  }

  private async getInfoToken(address: string) {
    try {
      const response = await fetch(`https://api.thena.fi/api/v1/topTokens/${ChainId.BSC}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch token info: ${response.statusText}`);
      }
      const data = await response.json();
      const tokenInfo = data.data.find((token: any) => token.address === address);
      return tokenInfo;
    } catch (error) {
      logger.error('Error fetching token info:', error);
      throw new Error('Thena not support this token');
    }
  }

  private createSwapQuote(
    params: SwapParams,
    sourceToken: Token,
    destinationToken: Token,
    swapTransactionData: any,
    routeData: any,
    walletAddress: string,
    amountOutLimitOrder?: string,
  ): SwapQuote {
    const quoteId = ethers.hexlify(ethers.randomBytes(32));
    return {
      quoteId,
      network: params.network,
      fromToken: sourceToken,
      toToken: destinationToken,
      fromAmount: ethers.formatUnits(routeData.inAmounts[0], sourceToken.decimals),
      toAmount:
        params?.limitPrice && amountOutLimitOrder
          ? ethers.formatUnits(amountOutLimitOrder, destinationToken.decimals)
          : ethers.formatUnits(routeData.outAmounts[0], destinationToken.decimals),
      slippage: 100, // 10% default slippage
      type: params.type,
      priceImpact: routeData.priceImpact || 0,
      route: ['thena'],
      estimatedGas: routeData.gasEstimateValue,
      tx: {
        to: params?.limitPrice ? CONSTANTS.ORBS_ADDRESS : swapTransactionData.transaction.to,
        data: params?.limitPrice ? swapTransactionData : swapTransactionData.transaction.data,
        value: params?.limitPrice ? 0 : swapTransactionData.transaction.value,
        gasLimit: ethers.parseUnits(CONSTANTS.DEFAULT_GAS_LIMIT, 'wei'),
        network: params.network,
        spender: params?.limitPrice ? walletAddress : swapTransactionData.transaction.to,
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
