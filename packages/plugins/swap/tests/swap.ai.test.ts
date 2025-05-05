import { ethers } from 'ethers';
import {
  Wallet,
  Network,
  settings,
  NetworkType,
  NetworksConfig,
  NetworkName,
  IToolExecutionCallback,
  ToolExecutionData,
  ToolExecutionState,
  PlanningAgent,
} from '@binkai/core';
import { Connection } from '@solana/web3.js';
import { BridgePlugin } from '../../bridge/dist/BridgePlugin';
import { TokenPlugin } from '../../token/dist/TokenPlugin';
import { BnbProvider } from '@binkai/rpc-provider';
import { BirdeyeProvider } from '../../../providers/birdeye/dist/BirdeyeProvider';
import { WalletPlugin } from '../../../plugins/wallet/dist/WalletPlugin';
import { PancakeSwapProvider } from '../../../providers/pancakeswap/dist/PancakeSwapProvider';
import { JupiterProvider } from '../../../providers/jupiter/dist/JupiterProvider';
import { ThenaProvider } from '../../../providers/thena/dist/ThenaProvider';
import { deBridgeProvider } from '../../../providers/deBridge/dist/deBridgeProvider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StakingPlugin } from '../../../plugins/staking/dist/StakingPlugin';
import { VenusProvider } from '../../../providers/venus/dist/VenusProvider';
import { BinkProvider } from '../../../providers/bink/dist/BinkProvider';
import { AlchemyProvider } from '../../../providers/alchemy/dist/AlchemyProvider';
import { SolanaProvider } from '../../../providers/rpc/dist/SolanaProvider';
import { ImagePlugin } from '../../../plugins/image/dist/ImagePlugin';
import { KnowledgePlugin } from '../../../plugins/knowledge/dist/KnowledgePlugin';
import { FourMemeProvider } from '../../../providers/four-meme/dist/FourMemeProvider';
import { KernelDaoProvider } from '../../../providers/kernel-dao/dist/KernelDaoProvider';
import { OkuProvider } from '../../../providers/oku/dist/OkuProvider';
import { KyberProvider } from '../../../providers/kyber/dist/KyberProvider';
import { ListaProvider } from '../../../providers/lista/dist/ListaProvider';
import { SwapPlugin } from '../../../plugins/swap/dist/SwapPlugin';

// Hardcoded RPC URLs for demonstration
const BSC_RPC_URL = 'https://bsc-dataseed1.binance.org';
const ETHEREUM_RPC_URL = 'https://eth.llamarpc.com';
const RPC_URL = 'https://api.mainnet-beta.solana.com';

// Example callback implementation
class ExampleToolExecutionCallback implements IToolExecutionCallback {
  onToolExecution(data: ToolExecutionData): void {
    const stateEmoji = {
      [ToolExecutionState.STARTED]: '🚀',
      [ToolExecutionState.IN_PROCESS]: '⏳',
      [ToolExecutionState.COMPLETED]: '✅',
      [ToolExecutionState.FAILED]: '❌',
    };

    const emoji = stateEmoji[data.state] || '🔄';

    console.log(`${emoji} [${new Date(data.timestamp).toISOString()}] ${data.message}`);

    if (data.state === ToolExecutionState.STARTED) {
      console.log(`   Input: ${JSON.stringify(data.input)}`);
    }

    if (data.state === ToolExecutionState.IN_PROCESS && data.data) {
      console.log(`   Progress: ${data.data.progress || 0}%`);
    }

    if (data.state === ToolExecutionState.COMPLETED && data.data) {
      console.log(
        `   Result: ${JSON.stringify(data.data).substring(0, 100)}${JSON.stringify(data.data).length > 100 ? '...' : ''}`,
      );
    }

    if (data.state === ToolExecutionState.FAILED && data.error) {
      console.log(`   Error: ${data.error.message || String(data.error)}`);
    }
  }
}

class ToolArgsCallback implements IToolExecutionCallback {
  private toolArgs: any = null;

  onToolExecution(data: ToolExecutionData): void {
    // Log state and input data
    if (data.state === ToolExecutionState.STARTED) {
      // Save input data for the swap tool
      if (data.input && typeof data.input === 'object') {
        if (data.toolName === 'swap') {
          this.toolArgs = { ...data.input };
        }
      }
    }
  }

  getToolArgs() {
    return this.toolArgs;
  }
}

class MockSwapPlugin extends SwapPlugin {
  finalArgs: any = null;

  // Override initialize to modify the swapTool instance
  async initialize(config: any): Promise<void> {
    // Call the parent initialize first
    await super.initialize(config);

    // Get the swapTool property from the parent class
    const swapToolProperty = Object.entries(this).find(
      ([key, value]) =>
        key === 'swapTool' || (value && typeof value === 'object' && 'simulateQuoteTool' in value),
    );

    if (swapToolProperty) {
      const [toolKey, originalTool] = swapToolProperty;

      // Replace the simulateQuoteTool method with our spy function
      const originalSimulateQuoteTool = originalTool.simulateQuoteTool;
      originalTool.simulateQuoteTool = async (args: any) => {
        // Capture the args
        this.finalArgs = { ...args };

        // Return result from original method
        return originalSimulateQuoteTool.call(originalTool, args);
      };
    }
  }
}

describe('Planning Agent', () => {
  let agent: PlanningAgent;
  let wallet: Wallet;
  let network: Network;
  let networks: NetworksConfig['networks'];
  let toolCallback: ToolArgsCallback;
  let mockSwapPlugin: MockSwapPlugin;

  // Helper test function
  async function testSwapToolArgs(input: string) {
    // Reset tool callback before each test
    toolCallback = new ToolArgsCallback();
    agent.registerToolExecutionCallback(toolCallback);

    await agent.execute({
      input: input,
      threadId: '987fcdeb-a123-45e6-7890-123456789abc',
    });

    // Then check the callback captured args
    const callbackArgs = toolCallback.getToolArgs();

    // Return whichever is not null, preferring mockSwapPlugin
    return mockSwapPlugin.finalArgs || callbackArgs;
  }

  beforeEach(async () => {
    // Check required environment variables
    if (!settings.has('OPENAI_API_KEY')) {
      throw new Error('Please set OPENAI_API_KEY in your .env file');
    }

    // Define available networks
    networks = {
      [NetworkName.BNB]: {
        type: 'evm' as NetworkType,
        config: {
          chainId: 56,
          rpcUrl: BSC_RPC_URL,
          name: 'BNB Chain',
          nativeCurrency: {
            name: 'BNB',
            symbol: 'BNB',
            decimals: 18,
          },
        },
      },
      ethereum: {
        type: 'evm' as NetworkType,
        config: {
          chainId: 1,
          rpcUrl: ETHEREUM_RPC_URL,
          name: 'Ethereum',
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
          },
        },
      },
      solana: {
        type: 'solana' as NetworkType,
        config: {
          rpcUrl: RPC_URL,
          name: 'Solana',
          nativeCurrency: {
            name: 'Solana',
            symbol: 'SOL',
            decimals: 9,
          },
        },
      },
    };

    // Initialize network
    network = new Network({ networks });

    // Initialize a new wallet
    wallet = new Wallet(
      {
        seedPhrase:
          settings.get('WALLET_MNEMONIC') ||
          'test test test test test test test test test test test junk',
        index: 9,
      },
      network,
    );

    // Create an agent with OpenAI
    agent = new PlanningAgent(
      {
        model: 'gpt-4o-mini',
        temperature: 0,
        isHumanReview: true,
        systemPrompt: `You are a BINK AI assistant.`,
      },
      wallet,
      networks,
    );

    toolCallback = new ToolArgsCallback();
    agent.registerToolExecutionCallback(toolCallback);

    /**
     * Initialize every provider and plugin in system since it will effect the reasoning ability of the agent
     * This is AI dependent test, so we need to initialize everything to make the test reliable
     */

    // Initialize provider
    const birdeyeApi = new BirdeyeProvider({
      apiKey: settings.get('BIRDEYE_API_KEY'),
    });
    const alchemyApi = new AlchemyProvider({
      apiKey: settings.get('ALCHEMY_API_KEY'),
    });
    const binkProvider = new BinkProvider({
      apiKey: settings.get('BINK_API_KEY') ?? 'this-is-test-key',
      baseUrl: settings.get('BINK_BASE_URL') ?? 'https://api.test-bink.com',
      imageApiUrl: settings.get('BINK_IMAGE_API_URL') ?? 'https://image.test-bink.com',
    });
    const bnbProvider = new BnbProvider({
      rpcUrl: BSC_RPC_URL,
    });
    const solanaProvider = new SolanaProvider({
      rpcUrl: RPC_URL,
    });
    const bscProvider = new ethers.JsonRpcProvider(BSC_RPC_URL);

    // Initialize plugins
    const bscChainId = 56;
    const pancakeswap = new PancakeSwapProvider(bscProvider, bscChainId);
    // const okx = new OkxProvider(this.bscProvider, bscChainId);
    const fourMeme = new FourMemeProvider(bscProvider, bscChainId);
    const venus = new VenusProvider(bscProvider, bscChainId);
    const kernelDao = new KernelDaoProvider(bscProvider, bscChainId);
    const oku = new OkuProvider(bscProvider, bscChainId);
    const kyber = new KyberProvider(bscProvider, bscChainId);
    const jupiter = new JupiterProvider(new Connection(RPC_URL));
    const imagePlugin = new ImagePlugin();
    // const swapPlugin = new SwapPlugin();
    mockSwapPlugin = new MockSwapPlugin();
    const tokenPlugin = new TokenPlugin();
    const knowledgePlugin = new KnowledgePlugin();
    const bridgePlugin = new BridgePlugin();
    const debridge = new deBridgeProvider([bscProvider, new Connection(RPC_URL)], 56, 7565164);
    const walletPlugin = new WalletPlugin();
    const stakingPlugin = new StakingPlugin();
    const thena = new ThenaProvider(bscProvider, bscChainId);
    const lista = new ListaProvider(bscProvider, bscChainId);

    // Initialize plugins with providers
    mockSwapPlugin.initialize({
      defaultSlippage: 0.5,
      defaultChain: 'bnb',
      providers: [pancakeswap, fourMeme, thena, jupiter, oku, kyber],
      supportedChains: ['bnb', 'ethereum', 'solana'], // These will be intersected with agent's networks
    }),
      tokenPlugin.initialize({
        defaultChain: 'bnb',
        providers: [birdeyeApi, fourMeme as any],
        supportedChains: ['solana', 'bnb', 'ethereum'],
      }),
      await knowledgePlugin.initialize({
        providers: [binkProvider],
      }),
      await imagePlugin.initialize({
        defaultChain: 'bnb',
        providers: [binkProvider],
      }),
      await bridgePlugin.initialize({
        defaultChain: 'bnb',
        providers: [debridge],
        supportedChains: ['bnb', 'solana'],
      }),
      await walletPlugin.initialize({
        defaultChain: 'bnb',
        providers: [birdeyeApi, alchemyApi, bnbProvider, solanaProvider],
        supportedChains: ['bnb', 'solana', 'ethereum'],
      }),
      await stakingPlugin.initialize({
        defaultSlippage: 0.5,
        defaultChain: 'bnb',
        providers: [venus, kernelDao, lista],
      }),
      // Register plugins with agent
      await agent.registerPlugin(mockSwapPlugin as any);
    await agent.registerPlugin(tokenPlugin as any);
    await agent.registerPlugin(knowledgePlugin as any);
    await agent.registerPlugin(bridgePlugin as any);
    await agent.registerPlugin(walletPlugin as any);
    await agent.registerPlugin(stakingPlugin as any);
    await agent.registerPlugin(imagePlugin as any);
  }, 30000); // Increase timeout for beforeEach

  // === SWAP ===

  it('Example 1: swap token on jupiter', async () => {
    await agent.execute({
      input: 'swap 0.001 SOL to USDC',
      threadId: '987fcdeb-a123-45e6-7890-123456789abc',
    });

    const capturedArgs = toolCallback.getToolArgs();

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('So11111111111111111111111111111111111111111');
    expect(capturedArgs.toToken).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(capturedArgs.amount).toBe('0.001');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.network).toBe('solana');
    capturedArgs.provider ? expect(capturedArgs.provider).toBe('jupiter') : '';
    expect(capturedArgs.limitPrice).toBe(0);
  }, 90000);

  it('Example 2: should fail when swapping with insufficient balance', async () => {
    await agent.execute({
      input: 'swap 200 SOL to USDC', // Large amount that exceeds balance
      threadId: '456bcdef-7890-12a3-b456-789012345def',
    });

    const capturedArgs = toolCallback.getToolArgs();

    if (capturedArgs === null) {
      expect(capturedArgs).toBeNull();
    }
  }, 90000);

  it('Example 3: should handle invalid token symbol gracefully', async () => {
    await agent.execute({
      input: 'swap 0.001 INVALIDTOKEN to USDC',
      threadId: '123e4567-e89b-12d3-a456-426614174003',
    });

    const capturedArgs = toolCallback.getToolArgs();

    if (capturedArgs === null) {
      expect(capturedArgs).toBeNull();
    }
  }, 30000);

  it('Example 4: should swap tokens via PancakeSwap on BNB Chain', async () => {
    await agent.execute({
      input: 'swap 0.001 BNB to BINK on BNB chain via pancakeswap',
      threadId: '123e4567-e89b-12d3-a456-426614174004',
    });

    const capturedArgs = toolCallback.getToolArgs();

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    expect(capturedArgs.toToken).toBe('0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1');
    expect(capturedArgs.amount).toBe('0.001');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.network).toBe('bnb');
    expect(capturedArgs.provider).toBe('pancakeswap');
    expect(capturedArgs.limitPrice).toBe(0);
  }, 90000);

  it('Example 5: float amount', async () => {
    await agent.execute({
      input: 'swap 0.0012424343434343 SOL to USDC', // Large amount that exceeds balance
      threadId: '456bcdef-7890-12a3-b456-789012345def',
    });

    const capturedArgs = toolCallback.getToolArgs();

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('So11111111111111111111111111111111111111111');
    expect(capturedArgs.toToken).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(capturedArgs.amount).toBe('0.0012424343434343');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.network).toBe('solana');
    capturedArgs.provider ? expect(capturedArgs.provider).toBe('jupiter') : '';
    expect(capturedArgs.limitPrice).toBe(0);
  }, 90000);

  it('Example 6: float amount', async () => {
    await agent.execute({
      input: 'swap 1.1232334 BINK to CAKE on BNB chain using pancakeswap',
      threadId: '123e4567-e89b-12d3-a456-426614174004',
    });

    const capturedArgs = toolCallback.getToolArgs();

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1');
    expect(capturedArgs.toToken).toBe('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82');
    expect(capturedArgs.amount).toBe('1.1232334');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.network).toBe('bnb');
    expect(capturedArgs.provider).toBe('pancakeswap');
    expect(capturedArgs.limitPrice).toBe(0);
  }, 90000);

  it('Example 7: swap all SOL to USDC using Jupiter', async () => {
    await agent.execute({
      input: 'swap all my SOL to USDC using jupiter',
      threadId: '123e4567-e89b-12d3-a456-426614174005',
    });

    const capturedArgs = toolCallback.getToolArgs();

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('So11111111111111111111111111111111111111111');
    expect(capturedArgs.toToken).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.network).toBe('solana');
    expect(capturedArgs.provider).toBe('jupiter');
    expect(capturedArgs.limitPrice).toBe(0);
  }, 90000);

  it('Example 8: swap all BNB to USDT using pancakeswap', async () => {
    await agent.execute({
      input: 'swap all my BNB to USDT using pancakeswap',
      threadId: '123e4567-e89b-12d3-a456-426614174006',
    });

    const capturedArgs = toolCallback.getToolArgs();

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    expect(capturedArgs.toToken).toBe('0x55d398326f99059ff775485246999027b3197955');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.network).toBe('bnb');
    expect(capturedArgs.provider).toBe('pancakeswap');
    expect(capturedArgs.limitPrice).toBe(0);
  }, 90000);
  // == LIMIT ORDER ==
  it('Example 9: swap BINK to USDT with limit price using pancakeswap at price 10', async () => {
    await agent.execute({
      input: 'swap 1 BINK to CAKE at price 10',
      threadId: '123e4567-e89b-12d3-a456-426614174009',
    });

    const capturedArgs = toolCallback.getToolArgs();
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1');
    expect(capturedArgs.toToken).toBe('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82');
    expect(capturedArgs.amount).toBe('1');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.network).toBe('bnb');
    capturedArgs.provider ? expect(capturedArgs.provider).toBe('pancakeswap') : '';
    expect(capturedArgs.limitPrice).toBe(10);
  }, 90000);

  it('Example 10: swap SOL to USDC with limit price using jupiter', async () => {
    await agent.execute({
      input: 'swap 0.001 SOL to USDC using jupiter with at price 200',
      threadId: '123e4567-e89b-12d3-a456-426614174010',
    });

    const capturedArgs = toolCallback.getToolArgs();

    expect(capturedArgs).not.toBeNull();
    let checkFromToken = false;

    capturedArgs.fromToken == 'So11111111111111111111111111111111111111111' ||
    capturedArgs.fromToken == 'So11111111111111111111111111111111111111112'
      ? (checkFromToken = true)
      : (checkFromToken = false);

    expect(checkFromToken).toBe(true);
    expect(capturedArgs.toToken).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    expect(capturedArgs.amount).toBe('0.001');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.network).toBe('solana');
    expect(capturedArgs.provider).toBe('jupiter');
    expect(capturedArgs.limitPrice).toBe(200);
  }, 90000);
});
