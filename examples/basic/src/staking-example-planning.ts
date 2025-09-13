import { ethers } from 'ethers';
import {
  Wallet,
  Network,
  settings,
  NetworkType,
  NetworksConfig,
  NetworkName,
  IToolExecutionCallback,
  ToolExecutionState,
  ToolExecutionData,
  PlanningAgent,
  Agent,
  OpenAIModel,
} from '@binkai/core';
import { StakingPlugin } from '@binkai/staking-plugin';
import { VenusProvider } from '@binkai/venus-provider';
import { WalletPlugin } from '@binkai/wallet-plugin';
import { BnbProvider } from '@binkai/rpc-provider';
import { BirdeyeProvider } from '@binkai/birdeye-provider';
import { AlchemyProvider } from '@binkai/alchemy-provider';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

// Hardcoded RPC URLs for demonstration
const BNB_RPC = 'https://bsc-dataseed1.binance.org';
const ETH_RPC = 'https://eth.llamarpc.com';

class ExampleToolExecutionCallback implements IToolExecutionCallback {
  onToolExecution(data: ToolExecutionData): void {
    const stateEmoji = {
      [ToolExecutionState.STARTED]: '🚀',
      [ToolExecutionState.IN_PROCESS]: '⏳',
      [ToolExecutionState.COMPLETED]: '✅',
      [ToolExecutionState.FAILED]: '❌',
    };

    const emoji = stateEmoji[data.state] || '🔄';

    // Only show staking-related information
    if (data.message.includes('staking') || data.message.includes('Staking')) {
      console.log(`${emoji} ${data.message}`);

      // Extract and show staking args if available
      try {
        const input = typeof data.input === 'string' ? JSON.parse(data.input) : data.input;
        if (input && input.type === 'supply') {
          console.log('🤖 Staking Args:', {
            tokenA: input.tokenA,
            amountA: input.amountA,
            type: input.type,
            network: input.network,
            provider: input.provider,
          });
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }

    // Show errors if any
    if (data.state === ToolExecutionState.FAILED && data.error) {
      console.error('❌ Error:', data.error.message || String(data.error));
    }
  }
}

async function runTestCase(testCase: {
  description: string;
  input: string;
  threadId: `${string}-${string}-${string}-${string}-${string}`;
}) {
  console.log(`\n📝 Test case: ${testCase.description}`);
  console.log(`Input: ${testCase.input}`);

  // Define available networks
  const networks: NetworksConfig['networks'] = {
    bnb: {
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
    ethereum: {
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
  };

  // Initialize network
  const network = new Network({ networks });

  // Initialize provider
  const provider = new ethers.JsonRpcProvider(BNB_RPC);

  // Initialize a new wallet
  const wallet = new Wallet(
    {
      seedPhrase:
        settings.get('WALLET_MNEMONIC') ||
        'test test test test test test test test test test test junk',
      index: 0,
    },
    network,
  );

  // Create and configure the wallet plugin
  const walletPlugin = new WalletPlugin();
  const bnbProvider = new BnbProvider({ rpcUrl: BNB_RPC });
  const alchemyProvider = new AlchemyProvider({
    apiKey: settings.get('ALCHEMY_API_KEY'),
  });

  await walletPlugin.initialize({
    defaultChain: 'bnb',
    providers: [bnbProvider, alchemyProvider],
    supportedChains: ['bnb'],
  });

  // Create a PlanningAgent
  const llm = new OpenAIModel({
    apiKey: settings.get('OPENAI_API_KEY') || '',
    model: 'gpt-4o-mini',
  });

  const agent = new Agent(
    llm,
    {
      temperature: 0,
      systemPrompt:
        'You are a BINK AI agent. You are able to perform bridge and get token information on multiple chains. If you do not have the token address, you can use the symbol to get the token information before performing a bridge.',
    },
    wallet,
    networks,
  );

  // Register callback
  agent.registerToolExecutionCallback(new ExampleToolExecutionCallback());

  // Create and configure the staking plugin
  const stakingPlugin = new StakingPlugin();
  const venus = new VenusProvider(provider, 56);

  await stakingPlugin.initialize({
    defaultSlippage: 0.5,
    defaultChain: 'bnb',
    providers: [venus],
    supportedChains: ['bnb', 'ethereum'],
  });

  // Register plugins
  await agent.registerPlugin(walletPlugin);
  await agent.registerPlugin(stakingPlugin);

  try {
    const result = await agent.execute({
      input: testCase.input,
      threadId: testCase.threadId,
    });

    console.log('-------------------');
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Error:', String(error));
    }
    console.log('-------------------');
  }
}

async function main() {
  console.log('🚀 Starting BinkOS staking examples with PlanningAgent...\n');

  // Check required environment variables
  if (!settings.has('OPENAI_API_KEY')) {
    console.error('❌ Error: Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  console.log('🔑 OpenAI API key found\n');

  // Define available networks
  console.log('📡 Configuring networks...');
  const networks: NetworksConfig['networks'] = {
    bnb: {
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
    ethereum: {
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
  };
  console.log('✓ Networks configured:', Object.keys(networks).join(', '), '\n');

  // Initialize network
  console.log('🌐 Initializing network...');
  const network = new Network({ networks });
  console.log('✓ Network initialized\n');

  // Initialize provider
  console.log('🔌 Initializing provider...');
  const provider = new ethers.JsonRpcProvider(BNB_RPC);
  console.log('✓ Provider initialized\n');

  // Initialize a new wallet
  console.log('👛 Creating wallet...');
  const wallet = new Wallet(
    {
      seedPhrase:
        settings.get('WALLET_MNEMONIC') ||
        'test test test test test test test test test test test junk',
      index: 0,
    },
    network,
  );

  console.log('✓ Wallet created\n');
  console.log('🤖 Wallet BNB:', await wallet.getAddress(NetworkName.BNB));

  // Create and configure the wallet plugin
  console.log('🔄 Initializing wallet plugin...');
  const walletPlugin = new WalletPlugin();

  // Create provider with API key
  const bnbProvider = new BnbProvider({
    rpcUrl: BNB_RPC,
  });

  // Create Birdeye provider with API key
  const birdeyeProvider = new BirdeyeProvider({
    apiKey: settings.get('BIRDEYE_API_KEY'),
  });

  const alchemyProvider = new AlchemyProvider({
    apiKey: settings.get('ALCHEMY_API_KEY'),
  });

  // Initialize plugin with provider
  await walletPlugin.initialize({
    defaultChain: 'bnb',
    providers: [bnbProvider, alchemyProvider],
    supportedChains: ['bnb'],
  });

  // Create and configure the staking plugin
  console.log('🔄 Initializing staking plugin...');
  const stakingPlugin = new StakingPlugin();

  // Create providers with proper chain IDs
  const venus = new VenusProvider(provider, 56);

  // Configure the plugin with supported chains
  await stakingPlugin.initialize({
    defaultSlippage: 0.5,
    defaultChain: 'bnb',
    providers: [venus],
    supportedChains: ['bnb', 'ethereum'],
  });
  console.log('✓ Staking plugin initialized\n');

  // Create a PlanningAgent with OpenAI
  console.log('🤖 Initializing AI PlanningAgent...');
  const llm = new OpenAIModel({
    apiKey: settings.get('OPENAI_API_KEY') || '',
    model: 'gpt-4o-mini',
  });

  const agent = new Agent(
    llm,
    {
      temperature: 0,
      systemPrompt:
        'You are a BINK AI agent. You are able to perform bridge and get token information on multiple chains. If you do not have the token address, you can use the symbol to get the token information before performing a bridge.',
    },
    wallet,
    networks,
  );
  console.log('✓ PlanningAgent initialized\n');

  // Register the tool execution callback
  console.log('🔔 Registering tool execution callback...');
  agent.registerToolExecutionCallback(new ExampleToolExecutionCallback());
  console.log('✓ Callback registered\n');

  // Register plugins
  console.log('🔌 Registering plugins...');
  await agent.registerPlugin(walletPlugin);
  await agent.registerPlugin(stakingPlugin);
  console.log('✓ Plugins registered\n');

  // Test cases for AI planning
  const testCases = [
    {
      description: 'Stake all BNB',
      input: 'stake all BNB on Venus',
      threadId: '123e4567-e89b-12d3-a456-426614174000' as const,
    },
    {
      description: 'Stake half BNB',
      input: 'stake half BNB on Venus',
      threadId: '123e4567-e89b-12d3-a456-426614174001' as const,
    },
    {
      description: 'Stake 50% BNB',
      input: 'stake 50% BNB on Venus',
      threadId: '123e4567-e89b-12d3-a456-426614174002' as const,
    },
    {
      description: 'Stake small amount',
      input: 'stake 0.00001 BNB on Venus',
      threadId: '123e4567-e89b-12d3-a456-426614174003' as const,
    },
    {
      description: 'Unstake all BNB',
      input: 'unstake all BNB from Venus',
      threadId: '123e4567-e89b-12d3-a456-426614174004' as const,
    },
    {
      description: 'Unstake all BNB',
      input: 'unstake all BNB via KernelDao',
      threadId: '123e4567-e89b-12d3-a456-426614174005' as const,
    },
  ];

  // Run test cases
  console.log('🧪 Running AI planning test cases...\n');

  // Run each test case independently
  for (const testCase of testCases) {
    await runTestCase(testCase);
  }

  console.log('\n✅ AI planning tests completed');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
