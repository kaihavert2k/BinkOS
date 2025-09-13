// multi-models-example.ts
import { ethers } from 'ethers';
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
  GroqModel,
} from '@binkai/core';
import { SwapPlugin } from '@binkai/swap-plugin';
import { OkxProvider } from '@binkai/okx-provider';
import { ThenaProvider } from '@binkai/thena-provider';
import { JupiterProvider } from '@binkai/jupiter-provider';
import { Connection } from '@solana/web3.js';
import { TokenPlugin } from '@binkai/token-plugin';
import { BirdeyeProvider } from '@binkai/birdeye-provider';
import { BridgePlugin } from '@binkai/bridge-plugin';
import { deBridgeProvider } from '@binkai/debridge-provider';
import { WalletPlugin } from '@binkai/wallet-plugin';
import { BnbProvider } from '@binkai/rpc-provider';

const RPC_URLS = {
  BNB: 'https://bsc-dataseed1.binance.org',
  ETH: 'https://eth.llamarpc.com',
  SOL: 'https://api.mainnet-beta.solana.com',
};

const SYSTEM_PROMPT =
  'You are a BINK AI agent. You are able to perform bridge and get token information on multiple chains. If you do not have the token address, you can use the symbol to get the token information before performing a bridge.';

async function main() {
  console.log('🚀 Starting BINK AI initialization example...\n');

  // ======= STEP 1: Check Required Environment Variables =======

  console.log('⚙️ STEP 1: Checking environment variables...');
  if (!settings.has('OPENAI_API_KEY')) {
    console.error('❌ Error: Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }

  if (!settings.has('GROQ_API_KEY')) {
    console.error('❌ Error: Please set GROQ_API_KEY in your .env file');
    process.exit(1);
  }
  console.log('✅ API keys found\n');

  // Enable logging
  logger.enable();

  // ======= STEP 2: Set Up Networks =======

  console.log('⚙️ STEP 2: Setting up networks...');
  const networks: NetworksConfig['networks'] = {
    [NetworkName.SOLANA]: {
      type: 'solana' as NetworkType,
      config: {
        rpcUrl: RPC_URLS.SOL,
        name: 'Solana',
        nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
      },
    },
    bnb: {
      type: 'evm' as NetworkType,
      config: {
        chainId: 56,
        rpcUrl: RPC_URLS.BNB,
        name: 'BNB Chain',
        nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
      },
    },
    ethereum: {
      type: 'evm' as NetworkType,
      config: {
        chainId: 1,
        rpcUrl: RPC_URLS.ETH,
        name: 'Ethereum',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      },
    },
  };

  // Initialize network manager
  const network = new Network({ networks });
  console.log('✅ Networks initialized:', Object.keys(networks).join(', '), '\n');

  // ======= STEP 3: Initialize Providers =======

  console.log('⚙️ STEP 3: Initializing providers...');
  const providers: Record<string, any> = {
    // Basic providers
    bnb_provider: new ethers.JsonRpcProvider(RPC_URLS.BNB),
    sol_provider: new Connection(RPC_URLS.SOL),
    eth_provider: new ethers.JsonRpcProvider(RPC_URLS.ETH),

    // Data providers
    birdeye: new BirdeyeProvider({
      apiKey: settings.get('BIRDEYE_API_KEY'),
    }),

    // Chain providers
    bnbProvider: new BnbProvider({
      rpcUrl: RPC_URLS.BNB,
    }),
  };

  // Add specialized providers
  providers.okx = new OkxProvider(providers.bnb_provider, 56);
  providers.jupiter = new JupiterProvider(providers.sol_provider);
  providers.thena = new ThenaProvider(providers.eth_provider, 1);
  providers.debridge = new deBridgeProvider(
    [providers.bnb_provider, providers.sol_provider],
    56,
    7565164,
  );
  console.log('✅ Providers initialized\n');

  // ======= STEP 4: Set Up Wallet =======

  console.log('⚙️ STEP 4: Setting up wallet...');
  const wallet = new Wallet(
    {
      seedPhrase:
        settings.get('WALLET_MNEMONIC') ||
        'test test test test test test test test test test test junk',
      index: 0,
    },
    network,
  );

  console.log('✅ Wallet created');
  console.log('   BNB Address:', await wallet.getAddress(NetworkName.BNB));
  console.log('   ETH Address:', await wallet.getAddress(NetworkName.ETHEREUM));
  console.log('   SOL Address:', await wallet.getAddress(NetworkName.SOLANA), '\n');

  // ======= STEP 5: Initialize LLM Models =======

  console.log('⚙️ STEP 5: Initializing LLM models...');
  const models = {
    groq: new GroqModel({
      apiKey: settings.get('GROQ_API_KEY') || '',
      model: 'llama-3.3-70b-versatile',
    }),
    openai: new OpenAIModel({
      apiKey: settings.get('OPENAI_API_KEY') || '',
      model: 'gpt-4o-mini',
    }),
  };
  console.log('✅ LLM models initialized\n');

  // ======= STEP 6: Initialize Plugins =======

  console.log('⚙️ STEP 6: Initializing plugins...');

  // Token plugin initialization
  console.log('   - Setting up Token plugin...');
  const tokenPlugin = new TokenPlugin();
  await tokenPlugin.initialize({
    providers: [providers.birdeye],
    supportedChains: ['solana', 'bnb', 'ethereum'],
  });

  // Wallet plugin initialization
  console.log('   - Setting up Wallet plugin...');
  const walletPlugin = new WalletPlugin();
  await walletPlugin.initialize({
    providers: [providers.bnbProvider, providers.birdeye],
    supportedChains: ['bnb', 'solana'],
  });

  // Swap plugin initialization
  console.log('   - Setting up Swap plugin...');
  const swapPlugin = new SwapPlugin();
  await swapPlugin.initialize({
    defaultSlippage: 0.5,
    providers: [providers.okx, providers.thena, providers.jupiter],
    supportedChains: ['bnb', 'ethereum', 'solana'],
  });

  // Bridge plugin initialization
  console.log('   - Setting up Bridge plugin...');
  const bridgePlugin = new BridgePlugin();
  await bridgePlugin.initialize({
    providers: [providers.debridge],
    supportedChains: ['bnb', 'solana'],
  });

  const plugins = {
    tokenPlugin,
    walletPlugin,
    swapPlugin,
    bridgePlugin,
  };
  console.log('✅ All plugins initialized\n');

  // ======= STEP 7: Create AI Agents =======

  console.log('⚙️ STEP 7: Creating AI agents...');
  const agents: Record<string, Agent> = {
    openai: new Agent(
      models.openai,
      {
        temperature: 0,
        systemPrompt: SYSTEM_PROMPT,
      },
      wallet,
      networks,
    ),

    groq: new Agent(
      models.groq,
      {
        temperature: 0,
        systemPrompt: SYSTEM_PROMPT,
      },
      wallet,
      networks,
    ),
  };
  console.log('✅ AI agents created\n');

  // ======= STEP 8: Register Plugins with Agents =======

  console.log('⚙️ STEP 8: Registering plugins with agents...');
  for (const [name, agent] of Object.entries(agents)) {
    console.log(`   - Registering plugins with ${name} agent...`);
    await agent.registerPlugin(plugins.walletPlugin);
    await agent.registerListPlugins([
      plugins.swapPlugin,
      plugins.tokenPlugin,
      plugins.bridgePlugin,
    ]);
  }
  console.log('✅ Plugins registered with all agents\n');

  // ======= STEP 9: Execute Tasks with Agents =======

  console.log('⚙️ STEP 9: Executing tasks with agents...');

  // Example 1: Using OpenAI model to swap tokens
  console.log('\n📝 EXAMPLE 1: Swap tokens using OpenAI model');
  console.time('⏱️ Execution Time');
  try {
    const result1 = await agents.openai.execute({
      input: `swap 0.01 SOL to USDC on solana.`,
    });
    console.log('✅ Result:', result1);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
  console.timeEnd('⏱️ Execution Time');

  // Example 2: Using Groq model to check balances
  console.log('\n📝 EXAMPLE 2: Check wallet balance using Groq model');
  console.time('⏱️ Execution Time');
  try {
    const result2 = await agents.groq.execute({
      input: `What is my wallet balance on all networks?`,
    });
    console.log('✅ Result:', result2);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
  console.timeEnd('⏱️ Execution Time');

  // ======= STEP 10: Display Available Providers =======

  console.log('\n⚙️ STEP 10: Displaying available providers by chain');
  const chains = plugins.swapPlugin.getSupportedNetworks();
  for (const chain of chains) {
    const chainProviders = plugins.swapPlugin.getProvidersForNetwork(chain);
    console.log(`   - Chain ${chain}:`, chainProviders.map(p => p.getName()).join(', '));
  }

  console.log('\n🎉 BINK AI initialization example completed successfully!');
}

// Run the main function
main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
