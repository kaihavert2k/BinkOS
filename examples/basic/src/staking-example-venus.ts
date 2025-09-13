import { ethers } from 'ethers';
import {
  Agent,
  Wallet,
  Network,
  settings,
  NetworkType,
  NetworksConfig,
  NetworkName,
  IToolExecutionCallback,
  ToolExecutionState,
  ToolExecutionData,
  logger,
  OpenAIModel,
} from '@binkai/core';
import { StakingPlugin } from '@binkai/staking-plugin';
import { VenusProvider } from '@binkai/venus-provider';
import { WalletPlugin } from '@binkai/wallet-plugin';
import { BnbProvider } from '@binkai/rpc-provider';
import { BirdeyeProvider } from '@binkai/birdeye-provider';
import { AlchemyProvider } from '@binkai/alchemy-provider';
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

    console.log(`${emoji} [${new Date(data.timestamp).toISOString()}] ${data.message}`);

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

async function main() {
  console.log('🚀 Starting BinkOS staking examples (Easy to Super Hard)...\n');

  // Check required environment variables
  if (!settings.has('OPENAI_API_KEY')) {
    console.error('❌ Error: Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  console.log('🔑 OpenAI API key found\n');

  //configure enable logger
  logger.enable();

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
  // Create an agent with OpenAI
  console.log('🤖 Initializing AI agent...');
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
  console.log('✓ Agent initialized\n');

  // Register the tool execution callback
  console.log('🔔 Registering tool execution callback...');
  agent.registerToolExecutionCallback(new ExampleToolExecutionCallback());
  console.log('✓ Callback registered\n');

  // Register with agent
  console.log('🔌 Registering wallet plugin with agent...');
  await agent.registerPlugin(walletPlugin);
  console.log('✓ Plugin registered\n');

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
    supportedChains: ['bnb', 'ethereum'], // These will be intersected with agent's networks
  });
  console.log('✓ Staking plugin initialized\n');

  // // Register the plugin with the agent
  console.log('🔌 Registering staking plugin with agent...');
  await agent.registerPlugin(stakingPlugin);
  console.log('✓ Plugin registered\n');

  // EASY EXAMPLES

  // Example 1: Very basic staking (explicit everything)
  console.log('💱 Example 1 [EASY]: Basic staking with explicit parameters');
  const basicStakeResult = await agent.execute({
    input: `Stake 0.01 BNB on Venus protocol on BNB Chain`,
  });
  console.log('✓ Basic staking result:', basicStakeResult, '\n');

  // // Example 2: Basic unstaking (explicit everything)
  // console.log('💱 Example 2 [EASY]: Basic unstaking with explicit parameters');
  // const basicUnstakeResult = await agent.execute({
  //   input: `Unstake 0.01 BNB from Venus protocol on BNB Chain`,
  // });
  // console.log('✓ Basic unstaking result:', basicUnstakeResult, '\n');

  // // Example 3: Stake with percentage
  // console.log('💱 Example 3 [EASY]: Stake with percentage');
  // const percentageStakeResult = await agent.execute({
  //   input: `Stake 5% of my BNB balance on Venus protocol`,
  // });
  // console.log('✓ Percentage stake result:', percentageStakeResult, '\n');

  // // MEDIUM EXAMPLES

  // // Example 4: Stake with USD value
  // console.log('💱 Example 4 [MEDIUM]: Stake with USD value');
  // const usdValueStakeResult = await agent.execute({
  //   input: `Stake $10 worth of BNB on Venus`,
  // });
  // console.log('✓ USD value stake result:', usdValueStakeResult, '\n');

  // Example 5: Stake with token address
  console.log('💱 Example 5 [MEDIUM]: Stake with token address');
  const tokenAddressStakeResult = await agent.execute({
    input: `Stake 0.5 of token  on Venus`,
  });
  console.log('✓ Token address stake result:', tokenAddressStakeResult, '\n');

  // Example 6: Unstake with vToken
  console.log('💱 Example 6 [MEDIUM]: Unstake with vToken');
  const vTokenUnstakeResult = await agent.execute({
    input: `Redeem all vBNB tokens from Venus to get back my BNB`,
  });
  console.log('✓ vToken unstake result:', vTokenUnstakeResult, '\n');

  // // Example 7: Multi-token staking
  // console.log('💱 Example 7 [MEDIUM]: Multi-token staking');
  // const multiTokenResult = await agent.execute({
  //   input: `Stake 0.01 BNB and 0.0222 BUSD on Venus in a single transaction if possible`,
  // });
  // console.log('✓ Multi-token stake result:', multiTokenResult, '\n');

  // // HARD EXAMPLES

  // // Example 8: Stake with custom slippage and deadline
  // console.log('💱 Example 8 [HARD]: Stake with custom slippage and deadline');
  // const customParamsResult = await agent.execute({
  //   input: `Stake 0.1 BNB on Venus with 2% slippage tolerance and make sure it executes within 3 minutes`,
  // });
  // console.log('✓ Custom parameters result:', customParamsResult, '\n');

  // // Example 9: Unstake with minimum received amount
  // console.log('💱 Example 9 [HARD]: Unstake with minimum received amount');
  // const minReceivedResult = await agent.execute({
  //   input: `Unstake 0.1 BNB from Venus but only if I'll receive at least 0.099 BNB after fees`,
  // });
  // console.log('✓ Minimum received result:', minReceivedResult, '\n');

  // Example 10: Stake with APY requirement
  // console.log('💱 Example 10 [HARD]: Stake with APY requirement');
  // const apyRequirementResult = await agent.execute({
  //   input: `Stake 0.05 BNB on Venus but only if the current APY is above 3%`,
  // });
  // console.log('✓ APY requirement result:', apyRequirementResult, '\n');

  // // Example 11: Complex unstaking with reinvestment
  // console.log('💱 Example 11 [HARD]: Complex unstaking with reinvestment');
  // const complexResult = await agent.execute({
  //   input: `Unstake half of my BNB from Venus and immediately stake the proceeds on the highest APY pool available`,
  // });
  // console.log('✓ Complex unstaking result:', complexResult, '\n');

  // // SUPER HARD EXAMPLES

  // Example 12: Ambiguous staking request (minimal info)
  console.log('💱 Example 12 [SUPER HARD]: Ambiguous staking request');
  const ambiguousStakeResult = await agent.execute({
    input: `Stake some BNB`,
  });
  console.log('✓ Ambiguous stake result:', ambiguousStakeResult, '\n');

  // Example 13: Unstake with very minimal information
  console.log('💱 Example 13 [SUPER HARD]: Unstake with minimal information');
  const minimalUnstakeResult = await agent.execute({
    input: `Get my staked tokens back`,
  });
  console.log('✓ Minimal unstake result:', minimalUnstakeResult, '\n');

  // Get plugin information
  const registeredPlugin = agent.getPlugin('staking') as StakingPlugin;

  // Check available providers for each chain
  console.log('📊 Available providers by chain:');
  const chains = registeredPlugin.getSupportedNetworks();
  for (const chain of chains) {
    const providers = registeredPlugin.getProvidersForNetwork(chain);
    console.log(`Chain ${chain}:`, providers.map(p => p.getName()).join(', '));
  }
  console.log();
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
