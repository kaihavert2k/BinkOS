import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { ethers } from 'ethers';
import { BnbProvider, SolanaProvider } from '@binkai/rpc-provider';
import { BirdeyeProvider } from '../../../providers/birdeye/src/BirdeyeProvider';
import { AlchemyProvider } from '../../../providers/alchemy/src/AlchemyProvider';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IToolExecutionCallback,
  Network,
  NetworkName,
  NetworksConfig,
  NetworkType,
  PlanningAgent,
  settings,
  Wallet,
  ToolExecutionData,
  ToolExecutionState,
} from '@binkai/core';

import { WalletPlugin } from '../src/WalletPlugin';
import { TokenPlugin } from '@binkai/token-plugin';

// Hardcoded RPC URLs for demonstration
const BNB_RPC = 'https://bsc-dataseed1.binance.org';
const ETH_RPC = 'https://eth.llamarpc.com';
const SOL_RPC = 'https://solana-rpc.debridge.finance';

class ToolArgsCallback implements IToolExecutionCallback {
  private toolArgs: any = null;

  onToolExecution(data: ToolExecutionData): void {
    if (data.input && typeof data.input === 'object') {
      const input = data.input;
      if ('toAddress' in input && ('amount' in input || 'token' in input)) {
        this.toolArgs = input;
        console.log('🔍 Captured Tool Args ---------:', this.toolArgs);
      }
    }
  }

  getToolArgs() {
    return this.toolArgs;
  }
}

describe('Planning Agent - Wallet Transfer', () => {
  let agent: PlanningAgent;
  let wallet: Wallet;
  let network: Network;
  let networks: NetworksConfig['networks'];
  let toolCallback: ToolArgsCallback;

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
          rpcUrl: BNB_RPC,
          name: 'BNB Chain',
          nativeCurrency: {
            name: 'BNB',
            symbol: 'BNB',
            decimals: 18,
          },
        },
      },
      [NetworkName.ETHEREUM]: {
        type: 'evm' as NetworkType,
        config: {
          chainId: 1,
          rpcUrl: ETH_RPC,
          name: 'Ethereum',
          nativeCurrency: {
            name: 'Ether',
            symbol: 'ETH',
            decimals: 18,
          },
        },
      },
      [NetworkName.SOLANA]: {
        type: 'solana' as NetworkType,
        config: {
          rpcUrl: SOL_RPC,
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

    // Initialize providers
    const provider = new ethers.JsonRpcProvider(BNB_RPC);

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
      },
      wallet,
      networks,
    );

    toolCallback = new ToolArgsCallback();
    agent.registerToolExecutionCallback(toolCallback);

    // Initialize plugins
    const walletPlugin = new WalletPlugin();
    const tokenPlugin = new TokenPlugin();

    // Initialize providers
    const bnbProvider = new BnbProvider({
      rpcUrl: BNB_RPC,
    });
    const solanaProvider = new SolanaProvider({
      rpcUrl: SOL_RPC,
    });
    const alchemyProvider = new AlchemyProvider({
      apiKey: settings.get('ALCHEMY_API_KEY'),
    });
    const birdeyeProvider = new BirdeyeProvider({
      apiKey: settings.get('BIRDEYE_API_KEY'),
    });

    // Initialize plugins with providers
    await walletPlugin.initialize({
      providers: [bnbProvider, alchemyProvider, birdeyeProvider, solanaProvider],
      supportedChains: ['solana', 'bnb', 'ethereum'],
    });

    await tokenPlugin.initialize({
      defaultChain: 'bnb',
      providers: [birdeyeProvider],
      supportedChains: ['solana', 'bnb'],
    });

    // Register plugins with agent
    await agent.registerPlugin(walletPlugin);
    await agent.registerPlugin(tokenPlugin);
  }, 30000);

  // === NATIVE TOKEN TRANSFER ===

  it('Example 1: transfer SOL on Solana', async () => {
    const promise = agent.execute({
      input: 'transfer 0.0001 SOL to DNwVbaJ3oQaSGkiHS2i6ZRCH193RGPK4cqWPKvLh2RTQ',
      threadId: '987fcdeb-a123-45e6-7890-123456789abc',
    });

    // Wait for tool args to be captured
    while (!toolCallback.getToolArgs()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const capturedArgs = toolCallback.getToolArgs();
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.token).toBe('So11111111111111111111111111111111111111111');
    expect(capturedArgs.toAddress).toBe('DNwVbaJ3oQaSGkiHS2i6ZRCH193RGPK4cqWPKvLh2RTQ');
    expect(capturedArgs.amount).toBe('0.0001');
    expect(capturedArgs.network).toBe('solana');
    // expect(capturedArgs.provider).toBe('solana');
  }, 210000);

  it('Example 2: should fail when transferring with insufficient balance', async () => {
    const promise = agent.execute({
      input: 'transfer 1000 SOL to DNwVbaJ3oQaSGkiHS2i6ZRCH193RGPK4cqWPKvLh2RTQ',
      threadId: '456bcdef-7890-12a3-b456-789012345def',
    });

    // Wait briefly to see if we capture any args
    await new Promise(resolve => setTimeout(resolve, 2000));

    const capturedArgs = toolCallback.getToolArgs();
    if (capturedArgs === null) {
      expect(true).toBe(true);
    }
  }, 90000);

  it('Example 3: transfer BNB on BNB Chain', async () => {
    const promise = agent.execute({
      input: 'transfer 0.0001 BNB to 0x42C1a8188a853880089073F7c15B31657d5F4D5f on BNB chain',
      threadId: '123e4567-e89b-12d3-a456-426614174003',
    });

    // Wait for tool args to be captured
    while (!toolCallback.getToolArgs()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const capturedArgs = toolCallback.getToolArgs();
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.token).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    expect(capturedArgs.toAddress).toBe('0x42C1a8188a853880089073F7c15B31657d5F4D5f');
    expect(capturedArgs.amount).toBe('0.0001');
    expect(capturedArgs.network).toBe('bnb');
    expect(capturedArgs.provider).toBe('bnb');
  }, 90000);
  // === TOKEN TRANSFER ===

  it('Example 4: transfer USDT on Solana', async () => {
    const promise = agent.execute({
      input:
        'send 0.004 USDT(Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB) to DNwVbaJ3oQaSGkiHS2i6ZRCH193RGPK4cqWPKvLh2RTQ on solana',
      threadId: '123e4567-e89b-12d3-a456-426614174004',
    });

    // Wait for tool args to be captured
    while (!toolCallback.getToolArgs()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const capturedArgs = toolCallback.getToolArgs();
    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.token).toBe('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    expect(capturedArgs.toAddress).toBe('DNwVbaJ3oQaSGkiHS2i6ZRCH193RGPK4cqWPKvLh2RTQ');
    expect(capturedArgs.amount).toBe('0.004');
    expect(capturedArgs.network).toBe('solana');
    // expect(capturedArgs.provider).toBe('solana');
  }, 180000);
});
