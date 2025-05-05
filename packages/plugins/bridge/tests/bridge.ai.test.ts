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
  private toolName: string = '';

  onToolExecution(data: ToolExecutionData): void {
    // Log state and input data
    if (data.state === ToolExecutionState.STARTED) {
      // Save the tool name and input data
      if (data.input && typeof data.input === 'object') {
        this.toolName = data.toolName;
        this.toolArgs = { ...data.input };
      }
    }
  }

  getToolArgs() {
    return this.toolArgs;
  }

  getToolName() {
    return this.toolName;
  }
}

class MockBridgePlugin extends BridgePlugin {
  finalArgs: any = null;

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    const bridgeToolProperty = Object.entries(this).find(
      ([key, value]) =>
        key === 'bridgeTool' ||
        (value && typeof value === 'object' && 'simulateQuoteTool' in value),
    );

    if (bridgeToolProperty) {
      const [toolKey, originalTool] = bridgeToolProperty;
      const originalSimulateQuoteTool = originalTool.simulateQuoteTool;
      originalTool.simulateQuoteTool = async (args: any) => {
        this.finalArgs = { ...args };
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
  let mockBridgePlugin: MockBridgePlugin;

  /**
   * Helper function to execute tool operations and validate arguments
   * @param testNumber - Test case number for logging
   * @param input - User input command
   * @param expectedTool - Expected tool name (swap, bridge, transfer)
   * @param expectedArgs - Expected arguments to validate
   * @param isErrorCase - Whether this test is expected to fail
   */
  async function testOperation(
    testNumber: number,
    input: string,
    expectedTool: string,
    expectedArgs: Record<string, any>,
    isErrorCase = false,
  ) {
    console.log(`\n🧪 TEST ${testNumber}: ${expectedTool.toUpperCase()} - "${input}"`);

    // Reset tool callback before each test
    toolCallback = new ToolArgsCallback();
    agent.registerToolExecutionCallback(toolCallback);

    await agent.execute({
      input: input,
      threadId: `test-${testNumber}-aaaa-bbbb-cccc-${Date.now().toString(16)}`,
    });

    // Get captured arguments
    let args;
    args = mockBridgePlugin.finalArgs || toolCallback.getToolArgs();

    const capturedToolName = toolCallback.getToolName();
    console.log(`📥 Tool used: ${capturedToolName}`);
    console.log(`📤 Tool args: ${JSON.stringify(args, null, 2)}`);

    // For error cases, accept null args
    if (isErrorCase && !args) {
      console.log(`⚠️ Test ${testNumber}: Args not captured - expected for error case`);
      return;
    }

    // For non-error cases, require args
    if (!isErrorCase) {
      expect(args).not.toBeNull();
      // Check if the correct tool was used
      expect(capturedToolName).toBe(expectedTool);
    }

    // If we have args, validate them
    if (args) {
      Object.entries(expectedArgs).forEach(([key, value]) => {
        expect(args[key]).toBe(value);
      });
      console.log(`✅ Test ${testNumber} passed`);
    }
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
    const fourMeme = new FourMemeProvider(bscProvider, bscChainId);
    const venus = new VenusProvider(bscProvider, bscChainId);
    const kernelDao = new KernelDaoProvider(bscProvider, bscChainId);
    const oku = new OkuProvider(bscProvider, bscChainId);
    const kyber = new KyberProvider(bscProvider, bscChainId);
    const jupiter = new JupiterProvider(new Connection(RPC_URL));
    const imagePlugin = new ImagePlugin();

    const tokenPlugin = new TokenPlugin();
    const knowledgePlugin = new KnowledgePlugin();
    const debridge = new deBridgeProvider([bscProvider, new Connection(RPC_URL)], 56, 7565164);
    const walletPlugin = new WalletPlugin();
    const stakingPlugin = new StakingPlugin();
    const thena = new ThenaProvider(bscProvider, bscChainId);
    const lista = new ListaProvider(bscProvider, bscChainId);

    mockBridgePlugin = new MockBridgePlugin();

    // Initialize plugins with providers
    SwapPlugin.initialize({
      defaultSlippage: 0.5,
      defaultChain: 'bnb',
      providers: [pancakeswap, fourMeme, thena, jupiter, oku, kyber],
      supportedChains: ['bnb', 'ethereum', 'solana'],
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
      await mockBridgePlugin.initialize({
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
      await agent.registerPlugin(SwapPlugin as any);
    await agent.registerPlugin(tokenPlugin as any);
    await agent.registerPlugin(knowledgePlugin as any);
    await agent.registerPlugin(mockBridgePlugin as any);
    await agent.registerPlugin(walletPlugin as any);
    await agent.registerPlugin(stakingPlugin as any);
    await agent.registerPlugin(imagePlugin as any);
  }, 30000); // Increase timeout for beforeEach

  // // === BRIDGE ===

  it('Example 1: should handle bridge request between chains', async () => {
    const result = await agent.execute({
      input: 'bridge 0.001 SOL to BNB chain',
      threadId: '123e4567-e89b-12d3-a456-426614174002',
    });
    const capturedArgs = toolCallback.getToolArgs();
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('So11111111111111111111111111111111111111111');
    expect(capturedArgs.toToken).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    expect(capturedArgs.amount).toBe('0.001');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.fromNetwork).toBe('solana');
    expect(capturedArgs.toNetwork).toBe('bnb');
  }, 90000);

  it('Example 2:should handle bridge with specific amount and token', async () => {
    await agent.execute({
      input: 'bridge 0.0002 BNB to SOL using debridge',
      threadId: '123e4567-e89b-12d3-a456-426614174005',
    });
    const capturedArgs = toolCallback.getToolArgs();
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromToken).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    expect(capturedArgs.toToken).toBe('So11111111111111111111111111111111111111112');
    expect(capturedArgs.amount).toBe('0.0002');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.fromNetwork).toBe('bnb');
    expect(capturedArgs.toNetwork).toBe('solana');
  }, 90000);

  it('Example 3:should handle bridge with insufficient liquidity', async () => {
    const result = await agent.execute({
      input: 'bridge 0.0003 SOL to BNB chain',
      threadId: '123e4567-e89b-12d3-a456-426614174006',
    });
    const capturedArgs = toolCallback.getToolArgs();
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.fromNetwork).toBe('solana');
    expect(capturedArgs.toNetwork).toBe('bnb');
    expect(capturedArgs.fromToken).toBe('So11111111111111111111111111111111111111111');
    expect(capturedArgs.toToken).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    expect(capturedArgs.amountType).toBe('input');
    expect(capturedArgs.amount).toBe('0.0003');
  }, 90000);
});
