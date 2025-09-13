import { ethers } from 'ethers';
import {
  Wallet,
  Network,
  NetworkType,
  NetworksConfig,
  NetworkName,
  IToolExecutionCallback,
  ToolExecutionData,
  ToolExecutionState,
  PlanningAgent,
} from '../dist';
import { StakingPlugin } from '../../plugins/staking/dist/StakingPlugin';
import { TokenPlugin } from '../../plugins/token/dist/TokenPlugin';
import { BridgePlugin } from '../../plugins/bridge/dist/BridgePlugin';
import { SwapPlugin } from '../../plugins/swap/dist/SwapPlugin';
import { BnbProvider } from '@binkai/rpc-provider';
import { BirdeyeProvider } from '../../providers/birdeye/dist/BirdeyeProvider';
import { WalletPlugin } from '../../plugins/wallet/dist/WalletPlugin';
import { beforeEach, describe, expect, it } from 'vitest';
import { BinkProvider } from '../../providers/bink/dist/BinkProvider';
import { AlchemyProvider } from '../../providers/alchemy/dist/AlchemyProvider';
import { SolanaProvider } from '../../providers/rpc/dist/SolanaProvider';
import { KnowledgePlugin } from '../../plugins/knowledge/dist/KnowledgePlugin';
import { VenusProvider } from '../../providers/venus/dist/VenusProvider';
import { KernelDaoProvider } from '../../providers/kernel-dao/dist/KernelDaoProvider';
import { ListaProvider } from '../../providers/lista/dist/ListaProvider';
import { PancakeSwapProvider } from '../../providers/pancakeswap/dist/PancakeSwapProvider';
import { JupiterProvider } from '../../providers/jupiter/dist/JupiterProvider';
import { ThenaProvider } from '../../providers/thena/dist/ThenaProvider';
import { deBridgeProvider } from '../../providers/deBridge/dist/deBridgeProvider';
import { FourMemeProvider } from '../../providers/four-meme/dist/FourMemeProvider';
import { KyberProvider } from '../../providers/kyber/dist/KyberProvider';
import { Connection } from '@solana/web3.js';

// ========== Constants ==========
const BSC_RPC_URL = 'https://bsc-dataseed1.binance.org';
const ETHEREUM_RPC_URL = 'https://eth.llamarpc.com';
const RPC_URL = 'https://api.mainnet-beta.solana.com';

// ========== Callback Classes ==========
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

class ToolMonitorCallback implements IToolExecutionCallback {
  private toolCalls: Record<string, any[]> = {};
  private lastLogs: string[] = [];

  onToolExecution(data: ToolExecutionData): void {
    const logMsg = `Tool ${data.toolName} state: ${data.state}`;
    this.lastLogs.push(logMsg);

    if (!this.toolCalls[data.toolName]) {
      this.toolCalls[data.toolName] = [];
    }

    this.toolCalls[data.toolName].push({
      input: data.input,
      timestamp: data.timestamp,
      state: data.state,
      error: data.error,
    });
  }

  wasToolCalled(toolName: string): boolean {
    return !!this.toolCalls[toolName] && this.toolCalls[toolName].length > 0;
  }

  reset(): void {
    this.toolCalls = {};
    this.lastLogs = [];
  }
}

class AskUserCallback implements IToolExecutionCallback {
  private askCalled: boolean = false;
  private questions: string[] = [];

  onToolExecution(data: ToolExecutionData): void {
    if (
      (data.toolName === 'ask_user' || data.toolName === 'ask') &&
      data.state === ToolExecutionState.STARTED
    ) {
      this.askCalled = true;
      if (data.input && typeof data.input === 'object' && 'question' in data.input) {
        const question = data.input.question as string;
        this.questions.push(question);
      }
    }
  }

  wasAskCalled(): boolean {
    return this.askCalled;
  }

  getQuestions(): string[] {
    return this.questions;
  }

  reset(): void {
    this.askCalled = false;
    this.questions = [];
  }
}

// ========== Mock Plugins ==========
class MockStakingPlugin extends StakingPlugin {
  finalArgs: any = null;

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    const stakingToolProperty = Object.entries(this).find(
      ([key, value]) =>
        key === 'stakingTool' ||
        (value && typeof value === 'object' && 'simulateQuoteTool' in value),
    );

    // Monkey patch the staking method to capture arguments
    if (stakingToolProperty) {
      const [toolKey, originalTool] = stakingToolProperty;
      const originalSimulateQuoteTool = originalTool.simulateQuoteTool;
      originalTool.simulateQuoteTool = async (args: any) => {
        console.log(`🔍 Staking simulation with args: ${JSON.stringify(args)}`);
        this.finalArgs = { ...args };
        return originalSimulateQuoteTool.call(originalTool, args);
      };
    }
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
        console.log(`🔍 Bridge simulation with args: ${JSON.stringify(args)}`);
        this.finalArgs = { ...args };
        return originalSimulateQuoteTool.call(originalTool, args);
      };
    }
  }
}

class MockSwapPlugin extends SwapPlugin {
  finalArgs: any = null;

  async initialize(config: any): Promise<void> {
    await super.initialize(config);

    const swapToolProperty = Object.entries(this).find(
      ([key, value]) =>
        key === 'swapTool' || (value && typeof value === 'object' && 'simulateQuoteTool' in value),
    );

    if (swapToolProperty) {
      const [toolKey, originalTool] = swapToolProperty;
      const originalSimulateQuoteTool = originalTool.simulateQuoteTool;
      originalTool.simulateQuoteTool = async (args: any) => {
        console.log(`🔍 Swap simulation with args: ${JSON.stringify(args)}`);
        this.finalArgs = { ...args };
        return originalSimulateQuoteTool.call(originalTool, args);
      };
    }
  }
}

// ========== Test Helpers ==========
/**
 * Helper function to test operations
 */
async function testOperation(
  agent: PlanningAgent,
  toolMonitor: ToolMonitorCallback,
  askMonitor: AskUserCallback,
  mockPlugin: MockStakingPlugin | MockBridgePlugin | MockSwapPlugin,
  testNumber: number,
  input: string,
  expectedArgs: Record<string, any>,
  expectedErrorKeywords?: string[],
): Promise<boolean> {
  console.log(`\n🧪 TEST ${testNumber}: "${input}"`);

  // Redirect console.log for monitoring
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = function (...args) {
    const logString = args.join(' ');
    logs.push(logString);
    originalLog.apply(console, args);
  };

  try {
    toolMonitor.reset();
    askMonitor.reset();

    // Reset finalArgs before each test
    mockPlugin.finalArgs = null;

    await agent.execute({
      input: input,
      threadId: `test-${testNumber}-aaaa-bbbb-cccc-${Date.now().toString(16)}`,
    });

    // Allow more time for execution to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    const args = mockPlugin.finalArgs;
    console.log(`📤 Captured args:`, args ? JSON.stringify(args, null, 2) : 'null');

    const askLogFound = logs.some(
      log =>
        log.includes('Tool ask_user execution started') ||
        log.includes('Tool ask execution started'),
    );

    console.log(`🔍 Ask detected in logs: ${askLogFound}`);

    if (askLogFound) {
      // Check if any expected error keywords were found in the questions
      if (expectedErrorKeywords && expectedErrorKeywords.length > 0) {
        const questions = askMonitor.getQuestions();
        const foundErrorKeyword = expectedErrorKeywords.some(keyword =>
          questions.some(q => q.toLowerCase().includes(keyword.toLowerCase())),
        );

        if (foundErrorKeyword) {
          console.log(`💯 Test ${testNumber} PASSED: Expected error keyword found in ask question`);
          return true;
        }
      }

      console.log(`💯 Test ${testNumber} PASSED via ask_user detection in logs`);
      return true;
    }

    if (!args) {
      console.log(`❌ Test ${testNumber} FAILED: No args captured and no ask detected`);
      // Don't fail test if args is null - it might be a valid case for some tests
      return false;
    }

    if (Object.keys(expectedArgs).length > 0) {
      let allMatched = true;

      for (const [key, expectedValue] of Object.entries(expectedArgs)) {
        if (args[key] !== expectedValue) {
          console.log(`❌ Expected ${key} to be ${expectedValue} but got ${args[key]}`);
          allMatched = false;
        }
      }

      if (!allMatched) {
        console.log(`❌ Test ${testNumber} FAILED: Args did not match expected values`);
        return false;
      }

      console.log(`✅ All expected args matched`);
    }

    console.log(`💯 Test ${testNumber} PASSED via args validation`);
    return true;
  } catch (error) {
    console.error(`❌ Test ${testNumber} ERROR:`, error);
    return false;
  } finally {
    console.log = originalLog;
  }
}

// ========== Main Test Suite ==========
describe('AI Plugin Tests', () => {
  let agent: PlanningAgent;
  let wallet: Wallet;
  let network: Network;
  let networks: NetworksConfig['networks'];
  let toolMonitor: ToolMonitorCallback;
  let askMonitor: AskUserCallback;
  let mockStakingPlugin: MockStakingPlugin;
  let mockBridgePlugin: MockBridgePlugin;
  let mockSwapPlugin: MockSwapPlugin;

  beforeEach(async () => {
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
        seedPhrase: 'test test test test test test test test test test test junk',
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

    // Initialize callbacks
    toolMonitor = new ToolMonitorCallback();
    askMonitor = new AskUserCallback();

    // Register callbacks
    agent.registerToolExecutionCallback(toolMonitor);
    agent.registerToolExecutionCallback(askMonitor);
    agent.registerToolExecutionCallback(new ExampleToolExecutionCallback());

    // Initialize providers
    const birdeyeApi = new BirdeyeProvider({
      apiKey: 'mock-key',
    });
    const alchemyApi = new AlchemyProvider({
      apiKey: 'mock-key',
    });
    const binkProvider = new BinkProvider({
      apiKey: 'this-is-test-key',
      baseUrl: 'https://api.test-bink.com',
      imageApiUrl: 'https://image.test-bink.com',
    });
    const bnbProvider = new BnbProvider({
      rpcUrl: BSC_RPC_URL,
    });
    const solanaProvider = new SolanaProvider({
      rpcUrl: RPC_URL,
    });
    const bscProvider = new ethers.JsonRpcProvider(BSC_RPC_URL);

    // Initialize staking providers
    const bscChainId = 56;
    const venus = new VenusProvider(bscProvider, bscChainId);
    const kernelDao = new KernelDaoProvider(bscProvider, bscChainId);
    const lista = new ListaProvider(bscProvider, bscChainId);
    const pancakeswap = new PancakeSwapProvider(bscProvider, bscChainId);
    const fourMeme = new FourMemeProvider(bscProvider, bscChainId);
    const kyber = new KyberProvider(bscProvider, bscChainId);
    const jupiter = new JupiterProvider(new Connection(RPC_URL));
    const thena = new ThenaProvider(bscProvider, bscChainId);
    const debridge = new deBridgeProvider([bscProvider, new Connection(RPC_URL)], 56, 7565164);

    // Create mock plugins
    mockStakingPlugin = new MockStakingPlugin();
    mockBridgePlugin = new MockBridgePlugin();
    mockSwapPlugin = new MockSwapPlugin();

    const tokenPlugin = new TokenPlugin();
    const knowledgePlugin = new KnowledgePlugin();
    const walletPlugin = new WalletPlugin();

    // Initialize plugins with appropriate providers
    await mockStakingPlugin.initialize({
      defaultSlippage: 0.5,
      defaultChain: 'bnb',
      providers: [venus, kernelDao, lista],
      supportedChains: ['bnb', 'ethereum'],
    });

    await mockBridgePlugin.initialize({
      defaultChain: 'bnb',
      providers: [debridge],
      supportedChains: ['bnb', 'solana'],
    });

    await mockSwapPlugin.initialize({
      defaultSlippage: 0.5,
      defaultChain: 'bnb',
      providers: [pancakeswap, fourMeme, thena, jupiter, kyber],
      supportedChains: ['bnb', 'ethereum', 'solana'],
    });

    await tokenPlugin.initialize({
      defaultChain: 'bnb',
      providers: [birdeyeApi],
      supportedChains: ['bnb', 'ethereum', 'solana'],
    });

    await knowledgePlugin.initialize({
      providers: [binkProvider],
    });

    await walletPlugin.initialize({
      defaultChain: 'bnb',
      providers: [birdeyeApi, alchemyApi, bnbProvider, solanaProvider],
      supportedChains: ['bnb', 'ethereum', 'solana'],
    });

    // Register all plugins
    await agent.registerPlugin(mockStakingPlugin);
    await agent.registerPlugin(mockBridgePlugin);
    await agent.registerPlugin(mockSwapPlugin);
    await agent.registerPlugin(tokenPlugin);
    await agent.registerPlugin(knowledgePlugin);
    await agent.registerPlugin(walletPlugin);
  }, 30000);

  describe('Staking Operations', () => {
    it('Test 1: Stake BNB on Venus', async () => {
      await testOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockStakingPlugin,
        1,
        'stake 0.1 BNB on Venus',
        {
          token: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          amount: '0.1',
          platform: 'venus',
          action: 'stake',
        },
      );
    }, 30000);

    it('Test 2: Unstake USDT from KernelDAO', async () => {
      await testOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockStakingPlugin,
        2,
        'unstake 10 USDT from KernelDAO',
        {
          token: '0x55d398326f99059ff775485246999027b3197955',
          amount: '10',
          platform: 'kerneldao',
          action: 'unstake',
        },
      );
    }, 30000);
  });

  describe('Bridge Operations', () => {
    it('Test 3: Bridge BNB to SOL', async () => {
      await testOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockBridgePlugin,
        3,
        'bridge 0.001 BNB to SOL',
        {
          fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          toToken: 'So11111111111111111111111111111111111111111',
          amount: '0.001',
          fromNetwork: 'bnb',
          toNetwork: 'solana',
        },
      );
    }, 30000);

    it('Test 4: Bridge USDT from BNB to SOL', async () => {
      await testOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockBridgePlugin,
        4,
        'bridge 10 USDT from BNB Chain to SOL',
        {
          fromToken: '0x55d398326f99059ff775485246999027b3197955',
          toToken: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          amount: '10',
          fromNetwork: 'bnb',
          toNetwork: 'solana',
        },
      );
    }, 30000);
  });

  describe('Swap Operations', () => {
    it('Test 5: Swap BNB to USDT', async () => {
      await testOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockSwapPlugin,
        5,
        'swap 0.01 BNB to USDT',
        {
          fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          toToken: '0x55d398326f99059ff775485246999027b3197955',
          amount: '0.01',
          amountType: 'input',
          network: 'bnb',
        },
      );
    }, 30000);

    it('Test 6: Swap with slippage specified', async () => {
      await testOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockSwapPlugin,
        6,
        'swap 0.001 SOL to USDC with 1% slippage',
        {
          fromToken: 'So11111111111111111111111111111111111111111',
          toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '0.001',
          amountType: 'input',
          network: 'solana',
          slippage: 1,
        },
      );
    }, 30000);
  });
});
