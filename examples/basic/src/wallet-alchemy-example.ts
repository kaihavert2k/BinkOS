import {
  Agent,
  Wallet,
  Network,
  settings,
  NetworkType,
  NetworksConfig,
  NetworkName,
  logger,
  OpenAIModel,
} from '@binkai/core';
import { TokenPlugin } from '@binkai/token-plugin';
import { AlchemyProvider } from '@binkai/alchemy-provider';
import { WalletPlugin } from '@binkai/wallet-plugin';
import { BnbProvider } from '@binkai/rpc-provider';
import { BirdeyeProvider } from '@binkai/birdeye-provider';
// Hardcoded RPC URLs for demonstration
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const BNB_RPC = 'https://bsc-dataseed1.binance.org';

async function main() {
  console.log('🚀 Starting BinkOS token info example...\n');

  // Check required environment variables
  if (!settings.has('OPENAI_API_KEY')) {
    console.error('❌ Error: Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  if (!settings.has('ALCHEMY_API_KEY')) {
    console.error('❌ Error: Please set ALCHEMY_API_KEY in your .env file');
    process.exit(1);
  }

  console.log('🔑 API keys found\n');

  //configure enable logger
  logger.enable();

  // Define available networks
  console.log('📡 Configuring networks...');
  const networks: NetworksConfig['networks'] = {
    solana: {
      type: 'solana' as NetworkType,
      config: {
        rpcUrl: SOLANA_RPC,
        name: 'Solana',
        nativeCurrency: {
          name: 'Solana',
          symbol: 'SOL',
          decimals: 9,
        },
      },
    },
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
  };
  console.log('✓ Networks configured:', Object.keys(networks).join(', '), '\n');

  // Initialize network
  console.log('🌐 Initializing network...');
  const network = new Network({ networks });
  console.log('✓ Network initialized\n');

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

  console.log('🤖 Wallet Solana:', await wallet.getAddress(NetworkName.SOLANA));
  console.log('🤖 Wallet BNB:', await wallet.getAddress(NetworkName.BNB));

  const walletPlugin = new WalletPlugin();

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

  // Create and configure the token plugin
  console.log('🔍 Initializing token plugin...');
  const tokenPlugin = new TokenPlugin();

  // Create Alchemy provider with API key
  const alchemy = new AlchemyProvider({
    apiKey: settings.get('ALCHEMY_API_KEY'),
  });

  const bnbProvider = new BnbProvider({
    rpcUrl: BNB_RPC,
  });

  // Create Birdeye provider with API key
  const alchemyProvider = new AlchemyProvider({
    apiKey: settings.get('ALCHEMY_API_KEY'),
  });

  const birdeyeProvider = new BirdeyeProvider({
    apiKey: settings.get('BIRDEYE_API_KEY'),
  });
  // Initialize plugin with provider
  await walletPlugin.initialize({
    defaultChain: 'bnb',
    providers: [bnbProvider, alchemyProvider, birdeyeProvider],
    supportedChains: ['bnb', 'solana', 'ethereum'],
  });

  // Configure the plugin with supported chains
  await tokenPlugin.initialize({
    defaultChain: 'bnb',
    providers: [alchemy],
    supportedChains: ['bnb'],
  });
  console.log('✓ Token plugin initialized\n');

  // Register the plugin with the agent
  // console.log('🔌 Registering token plugin with agent...');
  // await agent.registerPlugin(tokenPlugin);
  // console.log('✓ Plugin registered\n');

  console.log('🔌 Registering wallet plugin with agent...');
  await agent.registerPlugin(walletPlugin);
  console.log('✓ Plugin registered\n');

  // Example 1: Get token info by symbol on BSC
  console.log('💎 Example 1: Get token info by symbol on BSC');
  const bscSymbolResult = await agent.execute({
    input: 'get all my balance and show address of token with balance',
  });
  console.log('✓ Token info (BSC symbol):', bscSymbolResult, '\n');

  // // Example 2: Get token info by address on BSC
  // console.log('💎 Example 2: Get token info by address on BSC');
  // const bscAddressResult = await agent.execute({
  //   // input:
  //   //   'Get wallet balance "0x01245D2204f92587E13d2bC784A28c5458ca3ac7" on BNB chain via Alchemy',
  //   input: `My wallet info on BNB via Alchemy`,
  // });
  // console.log('✓ Token info (BSC address):', bscAddressResult, '\n');
  //usdc: 0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d

  // Example 3: Get token info by symbol on Solana
  // console.log('💎 Example 3: Get token info by symbol on Solana');
  // const solanaSymbolResult = await agent.execute({
  //   input: 'Get information about the BONK token on Solana chain',
  // });
  // console.log('✓ Token info (Solana symbol):', solanaSymbolResult, '\n');

  // Example 4: Search tokens on BSC
  // console.log('🔍 Example 4: Search tokens on BSC');
  // const bscSearchResult = await agent.execute({
  //   input: 'Search for tokens containing "BINK" in their name on BNB chain',
  // });
  // console.log('✓ Search results (BSC):', bscSearchResult, '\n');

  // Get plugin information
  // const registeredPlugin = agent.getPlugin('token') as TokenPlugin;

  // // Check available providers for each chain
  // console.log('📊 Available providers by chain:');
  // const chains = registeredPlugin.getSupportedNetworks();
  // for (const chain of chains) {
  //   const providers = registeredPlugin.getProvidersForNetwork(chain);
  //   console.log(`Chain ${chain}:`, providers.map(p => p.getName()).join(', '));
  // }
  // console.log();
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
