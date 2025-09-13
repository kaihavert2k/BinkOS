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
import { ImagePlugin } from '@binkai/image-plugin';
import { ethers } from 'ethers';
import { FourMemeProvider } from '@binkai/four-meme-provider';
import { BinkProvider } from '@binkai/bink-provider';

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

  if (!settings.has('BIRDEYE_API_KEY')) {
    console.error('❌ Error: Please set BIRDEYE_API_KEY in your .env file');
    process.exit(1);
  }

  console.log('🔑 API keys found\n');

  //configure enable logger
  logger.enable();

  // //configure disable logger
  // logger.disable();

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

  // Create and configure the image plugin
  console.log('🔍 Initializing token plugin...');
  const imagePlugin = new ImagePlugin();

  const provider = new ethers.JsonRpcProvider(BNB_RPC);

  const binkProvider = new BinkProvider({
    apiKey: settings.get('BINK_API_KEY') || '',
    baseUrl: settings.get('BINK_API_URL') || '',
    imageApiUrl: settings.get('BINK_IMAGE_API_URL') || '',
  });
  await imagePlugin.initialize({
    defaultChain: 'bnb',
    providers: [binkProvider],
    supportedChains: ['bnb'],
  });
  console.log('✓ Token plugin initialized\n');

  // Register the plugin with the agent
  console.log('🔌 Registering token plugin with agent...');
  await agent.registerPlugin(imagePlugin);
  console.log('✓ Plugin registered\n');

  // Example 1: Create a image
  console.log('💎 Example 1: Create a token on BSC');
  const result = await agent.execute({
    input:
      'Create a image based on image https://cdn.shopify.com/s/files/1/0583/4820/8201/files/Picture4_480x480.png?v=1723119015, style cartoon and funny',
  });
  console.log('✓ Image created:', result, '\n');

  console.log('📊 Available providers by chain:');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
