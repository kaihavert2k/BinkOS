import {
  BaseStakingProvider,
  StakingParams,
  StakingQuote,
  NetworkProvider,
} from '@binkai/staking-plugin';
import { ethers, Contract, Provider } from 'ethers';
import { VenusPoolABI } from './abis/VenusPool';
import { EVM_NATIVE_TOKEN_ADDRESS, NetworkName, Token, logger } from '@binkai/core';
import { isSolanaNetwork } from '@binkai/staking-plugin';
import { isWithinTolerance, parseTokenAmount } from '@binkai/staking-plugin';

// Core system constants
const CONSTANTS = {
  DEFAULT_GAS_LIMIT: '350000',
  APPROVE_GAS_LIMIT: '50000',
  QUOTE_EXPIRY: 5 * 60 * 1000, // 5 minutes in milliseconds
  BNB_ADDRESS: EVM_NATIVE_TOKEN_ADDRESS,
  VENUS_API_BASE: 'https://api.venus.io/',
  VENUS_POOL_ADDRESS: '0xa07c5b74c9b40447a954e1466938b865b6bbea36',
  VBNB_ADDRESS: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
} as const;

enum ChainId {
  BSC = 56,
  ETH = 1,
}

// Add these interfaces before the VenusProvider class

interface VenusPoolsResponse {
  limit: number;
  page: number;
  total: number;
  result: VenusPool[];
}

interface VenusPool {
  address: string;
  chainId: string;
  name: string;
  description: string | null;
  priceOracleAddress: string;
  closeFactorMantissa: string;
  liquidationIncentiveMantissa: string;
  minLiquidatableCollateralMantissa: string;
  markets: VenusMarket[];
}

interface VenusMarket {
  address: string;
  chainId: string;
  symbol: string;
  name: string;
  underlyingAddress: string;
  underlyingName: string;
  underlyingSymbol: string;
  underlyingDecimal: number;

  // Interest rates
  borrowRatePerBlock: string;
  supplyRatePerBlock: string;
  borrowApy: string;
  supplyApy: string;

  // Market state
  exchangeRateMantissa: string;
  underlyingPriceMantissa: string;
  totalBorrowsMantissa: string;
  totalSupplyMantissa: string;
  cashMantissa: string;
  totalReservesMantissa: string;

  // Configuration
  reserveFactorMantissa: string;
  collateralFactorMantissa: string;
  supplyCapsMantissa: string;
  borrowCapsMantissa: string;

  // Market metrics
  borrowerCount: number;
  supplierCount: number;
  liquidityCents: string;
  tokenPriceCents: string;

  // Status
  pausedActionsBitmap: number;
  isListed: boolean;

  // Rewards
  rewardsDistributors: RewardDistributor[];
}

interface RewardDistributor {
  id: string;
  marketAddress: string;
  rewardTokenAddress: string;
  chainId: string;
  supplySpeed: string;
  borrowSpeed: string;
  priceMantissa: string;
  rewardType: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export class VenusProvider extends BaseStakingProvider {
  private chainId: ChainId;
  private factory: any;
  protected GAS_BUFFER: bigint = ethers.parseEther('0.0003');

  constructor(provider: Provider, chainId: ChainId = ChainId.BSC) {
    // Create a Map with BNB network and the provider
    const providerMap = new Map<NetworkName, NetworkProvider>();
    providerMap.set(NetworkName.BNB, provider);
    super(providerMap);

    this.chainId = chainId;
    this.factory = new Contract(CONSTANTS.VENUS_POOL_ADDRESS, VenusPoolABI, provider);
  }

  getName(): string {
    return 'venus';
  }

  getSupportedNetworks(): NetworkName[] {
    return [NetworkName.BNB];
  }

  getPrompt(): string {
    return `
      Venus Protocol Information:
      - For unstaking from Venus, use the token with "v" prefix (e.g., vBNB for BNB, vBUSD for BUSD).
      - When a user asks to "unstake all BNB on Venus", you should use vBNB as tokenA.
      - The "v" prefix indicates a Venus-supplied token that represents the staked position.
    `;
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
    logger.info('🤖 Venus token info:', tokenInfo);
    return tokenInfo;
  }

  async getQuote(params: StakingParams, userAddress: string): Promise<StakingQuote> {
    try {
      // Check if tokenA is BNB
      if (
        (params.type === 'supply' || params.type === 'stake') &&
        params.tokenA.toLowerCase() !== CONSTANTS.BNB_ADDRESS.toLowerCase()
      ) {
        throw new Error(`Venus does not support supplying BNB tokens`);
      }

      if (params.tokenB) {
        throw new Error(`Venus does not support supplying other tokens without BNB`);
      }

      // Fetch input and output token information
      const [tokenA, tokenB] = await Promise.all([
        this.getToken(params.tokenA, params.network),
        params.tokenB
          ? this.getToken(params.tokenB, params.network)
          : this.getToken(params.tokenA, params.network),
      ]);

      // If input token is native token and it's an exact input swap
      let adjustedAmount = params.amountA;
      if (params.type === 'supply' || params.type === 'stake') {
        // Use the adjustAmount method for all tokens (both native and ERC20)
        adjustedAmount = await this.adjustAmount(
          params.tokenA,
          params.amountA,
          userAddress,
          params.network,
        );

        if (adjustedAmount !== params.amountA) {
          logger.info(`🤖 Venus adjusted input amount from ${params.amountA} to ${adjustedAmount}`);
        }
      }

      // Calculate input amount based on decimals
      const swapAmountA = BigInt(Math.floor(Number(adjustedAmount) * 10 ** tokenA.decimals));
      const swapAmountB = params.amountB
        ? BigInt(Math.floor(Number(params.amountB) * 10 ** tokenB.decimals))
        : swapAmountA;

      // Fetch optimal swap route
      const optimalRoute: VenusMarket = await this.fetchOptimalRoute(CONSTANTS.VENUS_POOL_ADDRESS);

      // Build swap transaction
      const buildTransactionData = await this.buildStakingRouteTransaction(
        optimalRoute,
        swapAmountA,
        swapAmountB,
        params.type,
      );

      // Create and store quote
      const quote = this.createQuote(params, tokenA, tokenB, optimalRoute, buildTransactionData);

      this.storeQuoteWithExpiry(quote);

      return quote;
    } catch (error: unknown) {
      logger.error('Error getting quote:', error);
      throw new Error(
        `Failed to get quote: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // Helper methods for better separation of concerns
  private async fetchOptimalRoute(poolAddress: string): Promise<VenusMarket> {
    const routePath = `pools?chainId=56`;
    const routeResponse = await fetch(`${CONSTANTS.VENUS_API_BASE}${routePath}`);
    const routeData = (await routeResponse.json()) as VenusPoolsResponse;

    if (!routeData.result || routeData.result.length === 0) {
      throw new Error('No pools available from Venus');
    }

    // First find the Core Pool
    const corePool = routeData.result.find((pool: VenusPool) => pool.name === 'Core Pool');

    if (!corePool) {
      throw new Error('Core Pool not found');
    }

    // Then find the specific market within the Core Pool's markets
    const targetMarket = corePool.markets.find(
      (market: VenusMarket) => market.address.toLowerCase() === poolAddress.toLowerCase(),
    );

    if (!targetMarket) {
      throw new Error(`Market with address ${poolAddress} not found in Venus`);
    }

    return targetMarket;
  }

  private async buildStakingRouteTransaction(
    routeData: VenusMarket,
    amountA: bigint,
    amountB: bigint,
    type: 'stake' | 'unstake' | 'supply' | 'withdraw' | 'deposit' = 'stake',
  ) {
    try {
      let txData: string;

      // Handle staking/supply
      if (type === 'stake' || type === 'supply') {
        txData = this.factory.interface.encodeFunctionData('mint', []);

        return {
          to: routeData.address,
          data: txData,
          value: amountA.toString(), // For BNB, the value field is used
          gasLimit: CONSTANTS.DEFAULT_GAS_LIMIT,
        };
      }
      // Handle unstaking/withdraw
      else {
        txData = this.factory.interface.encodeFunctionData('redeem', [amountA]);

        return {
          to: routeData.address,
          data: txData,
          value: '0', // No value needed for redeem
          gasLimit: CONSTANTS.DEFAULT_GAS_LIMIT,
        };
      }
    } catch (error) {
      logger.error('Error building staking transaction:', error);
      throw new Error(
        `Failed to build staking transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private createQuote(
    params: StakingParams,
    tokenA: Token,
    tokenB: Token,
    swapTransactionData: any,
    buildTransactionData: any,
  ): StakingQuote {
    const quoteId = ethers.hexlify(ethers.randomBytes(32));

    return {
      network: params.network,
      quoteId,
      tokenA: tokenA,
      tokenB: tokenB || null,
      amountA: params.amountA,
      amountB: params.amountB || '0',
      type: params.type,
      currentAPY: Number(swapTransactionData.supplyApy),
      averageAPY: Number(swapTransactionData.supplyApy),
      maxSupply: Number(swapTransactionData.supplyCapsMantissa),
      currentSupply: Number(swapTransactionData.totalSupplyMantissa),
      liquidity: Number(swapTransactionData.liquidityCents),
      estimatedGas: CONSTANTS.DEFAULT_GAS_LIMIT,
      tx: {
        to: buildTransactionData.to,
        data: buildTransactionData.data,
        value: buildTransactionData.value,
        gasLimit: buildTransactionData.gasLimit,
        network: params.network,
        spender: buildTransactionData.to,
      },
    };
  }

  private storeQuoteWithExpiry(quote: StakingQuote) {
    this.quotes.set(quote.quoteId, { quote, expiresAt: Date.now() + CONSTANTS.QUOTE_EXPIRY });

    // Delete quote after expiry
    setTimeout(() => {
      this.quotes.delete(quote.quoteId);
    }, CONSTANTS.QUOTE_EXPIRY);
  }

  async checkBalance(
    quote: StakingQuote,
    walletAddress: string,
  ): Promise<{ isValid: boolean; message?: string }> {
    try {
      // Handle edge cases
      if (!quote || !walletAddress) {
        return { isValid: false, message: 'Invalid quote or wallet address' };
      }
      if (!quote.amountA || quote.amountA === '0') {
        return { isValid: true }; // Zero amount is always valid
      }

      this.validateNetwork(quote.network);
      if (isSolanaNetwork(quote.network)) {
        // TODO: Implement Solana
      }

      const tokenToCheck = quote.tokenA;
      const requiredAmount = parseTokenAmount(quote.amountA, quote.tokenA.decimals);
      const gasBuffer = this.getGasBuffer(quote.network);

      // Check if the token is native token
      const isNativeToken = this.isNativeToken(tokenToCheck.address);

      if (isNativeToken) {
        // Get native token balance using the cache
        const { balance } = await this.getTokenBalance(
          EVM_NATIVE_TOKEN_ADDRESS,
          walletAddress,
          quote.network,
        );
        const totalRequired = requiredAmount + gasBuffer;

        // Check if balance is sufficient with tolerance
        if (!isWithinTolerance(totalRequired, balance, this.TOLERANCE_PERCENTAGE)) {
          const formattedBalance = ethers.formatEther(balance);
          const formattedRequired = ethers.formatEther(requiredAmount);
          const formattedTotal = ethers.formatEther(totalRequired);
          return {
            isValid: false,
            message: `Insufficient native token balance. Required: ${formattedRequired} (+ ~${ethers.formatEther(gasBuffer)} for gas = ${formattedTotal}), Available: ${formattedBalance}`,
          };
        }
      } else {
        // For other tokens, check ERC20 balance using the cache
        const { balance, formattedBalance } = await this.getTokenBalance(
          tokenToCheck.address,
          walletAddress,
          quote.network,
        );

        // Check if balance is sufficient with tolerance
        if (!isWithinTolerance(requiredAmount, balance, this.TOLERANCE_PERCENTAGE)) {
          const formattedRequired = ethers.formatUnits(requiredAmount, quote.tokenA.decimals);
          return {
            isValid: false,
            message: `Insufficient ${quote.tokenA.symbol} balance. Required: ${formattedRequired} ${quote.tokenA.symbol}, Available: ${formattedBalance} ${quote.tokenA.symbol}`,
          };
        }

        // Check if user has enough native token for gas using the cache
        const { balance: nativeBalance } = await this.getTokenBalance(
          EVM_NATIVE_TOKEN_ADDRESS,
          walletAddress,
          quote.network,
        );
        if (nativeBalance < gasBuffer) {
          const formattedBalance = ethers.formatEther(nativeBalance);
          return {
            isValid: false,
            message: `Insufficient native token for gas fees. Required: ~${ethers.formatEther(gasBuffer)}, Available: ${formattedBalance}`,
          };
        }
      }

      return { isValid: true };
    } catch (error) {
      logger.error('Error checking balance:', error);
      return {
        isValid: false,
        message: `Failed to check balance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  async getAllStakingBalances(walletAddress: string) {
    try {
      // Get vBNB balance
      const vBNBBalance = await this.getTokenBalance(
        CONSTANTS.VBNB_ADDRESS,
        walletAddress,
        NetworkName.BNB,
      );

      const vBNBInfo = {
        tokenAddress: CONSTANTS.VBNB_ADDRESS,
        symbol: 'vBNB',
        name: 'Venus BNB',
        decimals: 8,
        balance: vBNBBalance.formattedBalance,
        provider: this.getName(),
      };

      return {
        address: walletAddress,
        tokens: [vBNBInfo],
      };
    } catch (error) {
      logger.error('Error getting vBNB staking balance:', error);
      throw new Error(
        `Failed to get vBNB staking balance: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
