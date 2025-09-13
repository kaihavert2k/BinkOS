import {
  SwapQuote,
  SwapParams,
  NetworkProvider,
  BaseSwapProvider,
  parseTokenAmount,
  Transaction,
  isSolanaNetwork,
} from '@binkai/swap-plugin';
import { ethers, Contract, Interface, Provider } from 'ethers';
import { EVM_NATIVE_TOKEN_ADDRESS, NetworkName, Token, logger } from '@binkai/core';
// Enhanced interface with better type safety
interface TokenInfo extends Token {
  // Inherits all Token properties and maintains DRY principle
}

// Core system constants
const CONSTANTS = {
  DEFAULT_GAS_LIMIT: '350000',
  APPROVE_GAS_LIMIT: '50000',
  QUOTE_EXPIRY: 5 * 60 * 1000, // 5 minutes in milliseconds
  BNB_ADDRESS: EVM_NATIVE_TOKEN_ADDRESS,
  OKU_BNB_ADDRESS: '0x0000000000000000000000000000000000000000',
  OKU_API_PATH: (protocol: string) => `https://canoe.v2.icarus.tools/market/${protocol}/swap_quote`,
  OKU_APPROVE_ADDRESS: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5',
} as const;

enum ChainId {
  BSC = 56,
  ETH = 1,
}

export class OkuProvider extends BaseSwapProvider {
  private chainId: ChainId;

  constructor(provider: Provider, chainId: ChainId = ChainId.BSC) {
    const providerMap = new Map<NetworkName, NetworkProvider>();
    providerMap.set(NetworkName.BNB, provider);
    super(providerMap);
    this.chainId = chainId;
  }

  getName(): string {
    return 'oku';
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
      // Validate unsupported features
      if (params?.limitPrice) {
        throw new Error('OKU does not support limit order for native token swaps');
      }

      const isInputType = params.type === 'input';
      const fromToken = isInputType ? params.fromToken : params.toToken;
      const toToken = isInputType ? params.toToken : params.fromToken;

      // Fetch token metadata
      const [tokenIn, tokenOut] = await Promise.all([
        this.getToken(fromToken, params.network),
        this.getToken(toToken, params.network),
      ]);

      let adjustedAmount = params.amount;
      if (isInputType) {
        adjustedAmount = await this.adjustAmount(
          params.fromToken,
          params.amount,
          userAddress,
          params.network,
        );

        if (adjustedAmount !== params.amount) {
          logger.info(`🤖 OKu adjusted input amount from ${params.amount} to ${adjustedAmount}`);
        }
      }

      // Normalize token addresses
      const normalizeTokenAddress = (address: string) =>
        address === CONSTANTS.BNB_ADDRESS ? CONSTANTS.OKU_BNB_ADDRESS : address;

      let tokenInAddress = normalizeTokenAddress(tokenIn.address);
      let tokenOutAddress = normalizeTokenAddress(tokenOut.address);

      const slippageOKU = Number(params.slippage) * 100 || 0.1;

      // Fetch supported routes
      const response_api = await fetch('https://canoe.v2.icarus.tools/market/overview', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const market_route = await response_api.json();
      const routeNames = market_route.status.map((item: any) => item.name);
      const protocol = this.findFirstMatch(routeNames);

      let inputAmount = adjustedAmount;
      let data;

      // Reverse input/output if user provided exact output (simulate)
      if (!isInputType) {
        const simulatedBody = JSON.stringify({
          chain: 'bsc',
          account: userAddress,
          inTokenAddress: tokenInAddress,
          outTokenAddress: tokenOutAddress,
          isExactIn: true,
          slippage: slippageOKU,
          inTokenAmount: adjustedAmount,
        });

        const simulateResp = await fetch(CONSTANTS.OKU_API_PATH(protocol), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: simulatedBody,
        });

        data = await simulateResp.json();

        if (!data || data.length === 0) {
          throw new Error('No data returned from OKU (simulate)');
        }

        inputAmount = data.outAmount;
        tokenInAddress = data.outToken.address;
        tokenOutAddress = data.inToken.address;
      }

      // Final quote fetch
      const quoteBody = JSON.stringify({
        chain: 'bsc',
        account: userAddress,
        inTokenAddress: tokenInAddress,
        outTokenAddress: tokenOutAddress,
        isExactIn: true,
        slippage: slippageOKU,
        inTokenAmount: inputAmount,
      });

      const finalResponse = await fetch(CONSTANTS.OKU_API_PATH(protocol), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: quoteBody,
      });

      data = await finalResponse.json();

      if (!data || data.length === 0) {
        throw new Error('No data returned from OKU');
      }

      const inputFinal = data.inAmount;
      const outputFinal = data.outAmount;
      const estimatedGas = data.fees?.gas || 0;
      const priceImpact = 0; // Placeholder until available
      const tx = data.candidateTrade;

      const spender =
        tokenInAddress === CONSTANTS.OKU_BNB_ADDRESS
          ? tx?.to
          : data?.coupon?.raw?.executionInformation?.approvals?.[0]?.approvee;

      const quoteId = ethers.hexlify(ethers.randomBytes(32));

      const quote: SwapQuote = {
        network: params.network,
        quoteId,
        fromToken: isInputType ? tokenIn : tokenOut,
        toToken: isInputType ? tokenOut : tokenIn,
        slippage: params.slippage,
        fromAmount: inputFinal,
        toAmount: outputFinal,
        priceImpact,
        route: ['oku'],
        estimatedGas,
        type: params.type,
        tx: {
          to: tx?.to || '',
          data: tx?.data || '',
          value: tx?.value || '0',
          gasLimit: BigInt(CONSTANTS.DEFAULT_GAS_LIMIT),
          network: params.network,
          spender,
        },
      };

      logger.info('log', quote);

      this.quotes.set(quoteId, { quote, expiresAt: Date.now() + CONSTANTS.QUOTE_EXPIRY });

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

  private findFirstMatch(inputList: string[]) {
    const priorityList = ['kyberswap', 'okx', 'zeroex', 'odos', 'enso'];

    return priorityList.find(item => inputList.includes(item)) || 'kyberswap';
  }
}
