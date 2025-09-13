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

// Tool execution callback to monitor all tools and ask_user
class ToolMonitorCallback implements IToolExecutionCallback {
  private toolCalls: Record<string, any[]> = {}; // Store all tool calls
  private lastToolName: string = '';
  private lastLogs: string[] = []; // Store recent logs

  onToolExecution(data: ToolExecutionData): void {
    // Log every tool execution for debugging
    const logMsg = `${new Date(data.timestamp).toISOString()} | Tool ${data.toolName} state: ${data.state}`;
    this.lastLogs.push(logMsg);
    console.log(`🔄 Tool Event: ${logMsg}`);

    // Record all types of tools (not just STARTED state)
    this.lastToolName = data.toolName;

    // Initialize array for the tool if it doesn't exist
    if (!this.toolCalls[data.toolName]) {
      this.toolCalls[data.toolName] = [];
    }

    // Store input data
    this.toolCalls[data.toolName].push({
      input: data.input,
      timestamp: data.timestamp,
      message: data.message,
      state: data.state,
      error: data.error,
    });

    // Log detailed information for ask tool
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

  // Get all logs for debugging
  getLastLogs(count: number = 10): string[] {
    return this.lastLogs.slice(-count);
  }

  // Get call history for a specific tool
  getToolCalls(toolName?: string): any {
    if (toolName) {
      return this.toolCalls[toolName] || [];
    }
    return this.toolCalls;
  }

  // Check if a tool was called (any state)
  wasToolCalled(toolName: string): boolean {
    return !!this.toolCalls[toolName] && this.toolCalls[toolName].length > 0;
  }

  // Get the most recent call of a tool
  getLastToolCall(toolName: string): any | null {
    const calls = this.toolCalls[toolName];
    if (calls && calls.length > 0) {
      return calls[calls.length - 1];
    }
    return null;
  }

  // Check if ask_user was called with specific keywords
  wasAskCalledWithKeywords(keywords: string[]): boolean {
    const askCalls = [...(this.toolCalls['ask_user'] || []), ...(this.toolCalls['ask'] || [])];

    if (askCalls.length === 0) return false;

    // Check for keywords in each ask call
    return askCalls.some(call => {
      if (call.input && typeof call.input === 'object' && 'question' in call.input) {
        const question = (call.input.question as string).toLowerCase();
        return keywords.some(keyword => question.includes(keyword.toLowerCase()));
      }
      return false;
    });
  }

  // Get all question content from ask_user
  getAllAskQuestions(): string[] {
    const askCalls = [...(this.toolCalls['ask_user'] || []), ...(this.toolCalls['ask'] || [])];

    return askCalls
      .filter(call => call.input && typeof call.input === 'object' && 'question' in call.input)
      .map(call => call.input.question as string);
  }

  // Reset history
  reset(): void {
    this.toolCalls = {};
    this.lastToolName = '';
    this.lastLogs = [];
    console.log('🧹 ToolMonitor reset');
  }
}

// Callback specifically for catching ask_user
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
  let mockSwapPlugin: MockSwapPlugin;
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
      const args = mockSwapPlugin.finalArgs;

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

  // === SWAP TESTS ===

  // Test Case 1: Basic swap (input amount) - Should succeed
  it('Test 1: Basic swap with input amount', async () => {
    await testSwapOperation(1, 'swap 0.01 SOL to USDC on solana', {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.01',
      amountType: 'input',
      network: 'solana',
    });
  }, 90000);

  // Test Case 2: Reverse swap (output amount) - Should succeed
  it('Test 2: Reverse swap with output amount', async () => {
    await testSwapOperation(2, 'buy 0.01 USDC using SOL on solana', {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.01',
      amountType: 'output',
      network: 'solana',
    });
  }, 90000);

  // Test Case 3: Swap with explicitly specified provider - Should succeed
  it('Test 3: Swap with specific provider', async () => {
    await testSwapOperation(3, 'swap 0.01 SOL to USDC using jupiter', {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.01',
      amountType: 'input',
      network: 'solana',
      provider: 'jupiter',
    });
  }, 90000);

  // Test Case 4: Swap with explicitly specified network - Should succeed
  it('Test 4: Swap with specific network', async () => {
    await testSwapOperation(4, 'swap 0.01 SOL to USDC on solana', {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.01',
      amountType: 'input',
      network: 'solana',
    });
  }, 90000);

  // Test Case 5: Swap with BNB token - Should succeed
  it('Test 5: Swap BNB to Bink', async () => {
    await testSwapOperation(5, 'swap 0.001 BNB to BINK', {
      fromToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      toToken: '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1',
      amount: '0.001',
      amountType: 'input',
      network: 'bnb',
    });
  }, 90000);

  // Test Case 6: Reverse swap with BNB - Should succeed
  it('Test 6: Reverse swap to buy BNB', async () => {
    await testSwapOperation(6, 'buy 0.001 BNB with BINK', {
      fromToken: '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1',
      toToken: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      amount: '0.001',
      amountType: 'output',
      network: 'bnb',
    });
  }, 90000);

  // Test Case 7: Swap with slippage specified - Should succeed
  it('Test 7: Swap with slippage specified', async () => {
    await testSwapOperation(7, 'swap 0.001 SOL to USDC with 1% slippage', {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.001',
      amountType: 'input',
      network: 'solana',
      slippage: 1,
    });
  }, 90000);

  // Test Case 8: Invalid token symbol - Pass if asks with appropriate keywords
  it('Test 8: Swap with invalid token symbol', async () => {
    await testSwapOperation(
      8,
      'swap 0.001 INVALID_TOKEN to USDC',
      {
        // Correct parameters will depend on how the AI model responds
        // No need to fill in all parameters here
      },
      ['invalid token', 'token not found', 'unknown token'], // Expected error keywords
    );
  }, 90000);

  // Test Case 9: Invalid amount (too large) - Pass if asks with appropriate keywords
  it('Test 9: Swap with unreasonably large amount', async () => {
    await testSwapOperation(
      9,
      'swap 999999 SOL to USDC',
      {
        fromToken: 'So11111111111111111111111111111111111111111',
        toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '999999',
        amountType: 'input',
        network: 'solana',
      },
      ['insufficient balance', 'not enough', 'balance too low', 'not sufficient'], // Expected error keywords
    );
  }, 90000);

  // Test Case 10: Complex natural language query - Should succeed
  it('Test 10: Swap with complex natural language', async () => {
    await testSwapOperation(10, 'I would like to exchange 0.001 SOL for some USDC tokens please', {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.001',
      amountType: 'input',
      network: 'solana',
    });
  }, 90000);

  // Test Case 11: Small amount - Pass if asks with appropriate keywords
  it('Test 11: Swap with amount too small', async () => {
    await testSwapOperation(
      11,
      'swap 0.0000001 SOL to USDC',
      {
        fromToken: 'So11111111111111111111111111111111111111111',
        toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: '0.0000001',
        amountType: 'input',
        network: 'solana',
      },
      ['amount too small', 'minimum amount', 'too small'], // Expected error keywords
    );
  }, 90000);
});
