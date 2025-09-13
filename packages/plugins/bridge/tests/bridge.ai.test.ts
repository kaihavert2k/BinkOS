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
  private lastToolName: string = '';
  private lastLogs: string[] = [];

  onToolExecution(data: ToolExecutionData): void {
    const logMsg = `${new Date(data.timestamp).toISOString()} | Tool ${data.toolName} state: ${data.state}`;
    this.lastLogs.push(logMsg);
    console.log(`🔄 Tool Event: ${logMsg}`);

    this.lastToolName = data.toolName;

    if (!this.toolCalls[data.toolName]) {
      this.toolCalls[data.toolName] = [];
    }

    this.toolCalls[data.toolName].push({
      input: data.input,
      timestamp: data.timestamp,
      message: data.message,
      state: data.state,
      error: data.error,
    });

    if (data.toolName === 'ask_user' || data.toolName === 'ask') {
      if (data.state === ToolExecutionState.STARTED && data.input) {
        console.log(
          `❓ Ask question: ${(data.input as any).question || JSON.stringify(data.input)}`,
        );
      } else if (data.state === ToolExecutionState.COMPLETED && data.data) {
        console.log(`✅ Ask completed with response: ${JSON.stringify(data.data)}`);
      } else if (data.state === ToolExecutionState.FAILED && data.error) {
        console.log(`❌ Ask failed with error: ${data.error}`);
      }
    }
  }

  getLastLogs(count: number = 10): string[] {
    return this.lastLogs.slice(-count);
  }

  wasToolCalled(toolName: string): boolean {
    return !!this.toolCalls[toolName] && this.toolCalls[toolName].length > 0;
  }

  reset(): void {
    this.toolCalls = {};
    this.lastToolName = '';
    this.lastLogs = [];
    console.log('🧹 ToolMonitor reset');
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
      console.log(`🗣️ ASK DETECTED: ${data.toolName} was called`);

      if (data.input && typeof data.input === 'object' && 'question' in data.input) {
        const question = data.input.question as string;
        this.questions.push(question);
        console.log(`❓ Question: ${question}`);
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
    console.log('🧹 AskUserCallback reset');
  }
}

// ========== Mock Plugins ==========
class MockBridgePlugin extends BridgePlugin {
  finalArgs: any = null;

  // Override initialize to modify the swapTool instance
  async initialize(config: any): Promise<void> {
    // Call the parent initialize first
    await super.initialize(config);

    // Get the swapTool property from the parent class
    const bridgeToolProperty = Object.entries(this).find(
      ([key, value]) =>
        key === 'bridgeTool' ||
        (value && typeof value === 'object' && 'simulateQuoteTool' in value),
    );

    if (bridgeToolProperty) {
      const [toolKey, originalTool] = bridgeToolProperty;

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

// ========== Test Helpers ==========
/**
 * Helper function to test bridge operations
 */
async function testBridgeOperation(
  agent: PlanningAgent,
  toolMonitor: ToolMonitorCallback,
  askMonitor: AskUserCallback,
  mockBridgePlugin: MockBridgePlugin,
  testNumber: number,
  input: string,
  expectedArgs: Record<string, any>,
  expectedErrorKeywords?: string[],
): Promise<boolean> {
  console.log(`\n🧪 TEST ${testNumber}: BRIDGE - "${input}"`);

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

    await agent.execute({
      input: input,
      threadId: `test-bridge-aaaa-bbbb-${Date.now().toString(16)}`,
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    const args = mockBridgePlugin.finalArgs;
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
      expect(args).not.toBeNull();
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
        expect(allMatched).toBe(true);
        return false;
      }

      console.log(`✅ All expected args matched`);
    }

    console.log(`💯 Test ${testNumber} PASSED via args validation`);
    return true;
  } finally {
    console.log = originalLog;
  }
}

// ========== Main Test Suite ==========
describe('Planning Agent', () => {
  let agent: PlanningAgent;
  let wallet: Wallet;
  let network: Network;
  let networks: NetworksConfig['networks'];
  let mockBridgePlugin: MockBridgePlugin;
  let toolMonitor: ToolMonitorCallback;
  let askMonitor: AskUserCallback;

  // Helper test function
  async function testSwapOperation(
    testNumber: number,
    input: string,
    expectedArgs: Record<string, any>,
    expectedErrorKeywords?: string[],
  ) {
    console.log(`\n🧪 TEST ${testNumber}: SWAP - "${input}"`);

    // Redirect console.log for monitoring
    const originalLog = console.log;
    const logs: string[] = [];

    console.log = function (...args) {
      const logString = args.join(' ');
      logs.push(logString);
      originalLog.apply(console, args);
    };

    try {
      // Reset toolMonitor
      toolMonitor.reset();

      // Call and wait for results
      await agent.execute({
        input: input,
        threadId: `test-${testNumber}-aaaa-bbbb-cccc-${Date.now().toString(16)}`,
      });

      // Wait a bit to ensure all logs have been recorded
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get parameters from simulateQuoteTool
      const args = mockBridgePlugin.finalArgs;

      console.log(`📤 Captured args:`, args ? JSON.stringify(args, null, 2) : 'null');

      // Check logs for ask_user
      const askLogFound = logs.some(
        log =>
          log.includes('Tool ask_user execution started') ||
          log.includes('Tool ask execution started'),
      );

      console.log(`🔍 Ask detected in logs: ${askLogFound}`);

      if (askLogFound) {
        // Find ask question in logs
        const askLogIndex = logs.findIndex(
          log =>
            log.includes('Tool ask_user execution started') ||
            log.includes('Tool ask execution started'),
        );

        if (
          askLogIndex >= 0 &&
          askLogIndex + 1 < logs.length &&
          logs[askLogIndex + 1].includes('question')
        ) {
          const questionMatch = logs[askLogIndex + 1].match(/"question":\s*"([^"]+)"/);
          if (questionMatch && questionMatch[1]) {
            console.log(`🔔 Ask question found: ${questionMatch[1]}`);
          }
        }

        console.log(`💯 Test ${testNumber} PASSED via ask_user detection in logs`);
        return true;
      }

      // If no args and no ask, test fails
      if (!args) {
        console.log(`❌ Test ${testNumber} FAILED: No args captured and no ask detected`);
        expect(args).not.toBeNull();
        return false;
      }

      // Check captured parameters
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
          expect(allMatched).toBe(true);
          return false;
        }

        console.log(`✅ All expected args matched`);
      }

      console.log(`💯 Test ${testNumber} PASSED via args validation`);
      return true;
    } finally {
      // Restore console.log
      console.log = originalLog;
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

    // Initialize callbacks
    toolMonitor = new ToolMonitorCallback();
    askMonitor = new AskUserCallback();

    // Register callbacks
    agent.registerToolExecutionCallback(toolMonitor);
    agent.registerToolExecutionCallback(askMonitor);
    agent.registerToolExecutionCallback(new ExampleToolExecutionCallback());

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
    const swapPlugin = new SwapPlugin();
    const debridge = new deBridgeProvider([bscProvider, new Connection(RPC_URL)], 56, 7565164);
    const thena = new ThenaProvider(bscProvider, bscChainId);
    const lista = new ListaProvider(bscProvider, bscChainId);
    const stakingPlugin = new StakingPlugin();
    mockBridgePlugin = new MockBridgePlugin();

    // Create plugins
    const tokenPlugin = new TokenPlugin();
    const knowledgePlugin = new KnowledgePlugin();
    const walletPlugin = new WalletPlugin();

    // Initialize plugins with appropriate providers
    await stakingPlugin.initialize({
      defaultChain: 'bnb',
      providers: [venus, kernelDao, lista],
      supportedChains: ['bnb', 'ethereum'],
    });

    await swapPlugin.initialize({
      defaultChain: 'bnb',
      providers: [pancakeswap, fourMeme, thena, jupiter, oku, kyber],
      supportedChains: ['bnb', 'ethereum', 'solana'], // These will be intersected with agent's networks
    }),
      await tokenPlugin.initialize({
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
      // Register all plugins - only registering essential plugins for staking tests
      await agent.registerPlugin(stakingPlugin as any);
    await agent.registerPlugin(tokenPlugin as any);
    await agent.registerPlugin(knowledgePlugin as any);
    await agent.registerPlugin(walletPlugin as any);
    await agent.registerPlugin(swapPlugin as any);
    await agent.registerPlugin(mockBridgePlugin as any);
  }, 30000);

  describe('Basic Bridge Operations', () => {
    // Test Case 1: Basic bridge operation - BNB to SOL
    it('Test 1: Bridge BNB to SOL', async () => {
      await testBridgeOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockBridgePlugin,
        1,
        'bridge 0.001 BNB to SOL',
        {
          fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          toToken: 'So11111111111111111111111111111111111111111',
          amount: '0.001',
          fromNetwork: 'bnb',
          toNetwork: 'solana',
        },
      );
    }, 90000);

    // Test Case 2: Bridge with natural language input
    it('Test 2: Bridge with natural language input', async () => {
      await testBridgeOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockBridgePlugin,
        2,
        'I want to move 0.01 BNB from BNB Chain to SOL network',
        {
          fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          toToken: 'So11111111111111111111111111111111111111111',
          amount: '0.01',
          fromNetwork: 'bnb',
          toNetwork: 'solana',
        },
      );
    }, 90000);

    // Test Case 3: Bridge with specific tokens
    it('Test 3: Bridge USDT from BNB to SOL', async () => {
      await testBridgeOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockBridgePlugin,
        3,
        'bridge 10 USDT from BNB Chain to SOL',
        {
          fromToken: '0x55d398326f99059ff775485246999027b3197955',
          toToken: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          amount: '10',
          fromNetwork: 'bnb',
          toNetwork: 'solana',
        },
      );
    }, 90000);

    // Test Case 4: Bridge with very small amount (may trigger ask)
    it('Test 4: Bridge with very small amount', async () => {
      await testBridgeOperation(
        agent,
        toolMonitor,
        askMonitor,
        mockBridgePlugin,
        4,
        'bridge 0.0000001 BNB to SOL',
        {
          fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          toToken: 'So11111111111111111111111111111111111111111',
          amount: '0.0000001',
          fromNetwork: 'bnb',
          toNetwork: 'solana',
        },
        ['amount too small', 'minimum amount', 'too small'],
      );
    }, 90000);
  });
});
