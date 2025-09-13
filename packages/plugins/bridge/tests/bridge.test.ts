import { ethers } from 'ethers';
import { Agent, Network, NetworkName, NetworksConfig, settings } from '@binkai/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Wallet } from '@binkai/core';
import { Connection } from '@solana/web3.js';
import { BridgePlugin } from '../src';
import { deBridgeProvider } from '../../../providers/deBridge/src';
import { TokenPlugin } from '../../token/src';
import { BirdeyeProvider } from '../../../providers/birdeye/src/BirdeyeProvider';
import { WalletPlugin } from '../../wallet/src/WalletPlugin';
import { BnbProvider } from '../../../providers/rpc/src';

describe('BridgePlugin', () => {
  let bridgePlugin: BridgePlugin;
  let wallet: Wallet;
  let network: Network;
  let mockProvider: any; // Mock provider
  let agent: Agent;
  let networks: NetworksConfig['networks'];

  const BNB_RPC = 'https://binance.llamarpc.com';
  const ETH_RPC = 'https://eth.llamarpc.com';
  const SOL_RPC = 'https://api.mainnet-beta.solana.com';
  const BNB_NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const BINK_ADDRESS = '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1';
  const SOL_NATIVE_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111111';
  const WSOL_NATIVE_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111112';

  beforeEach(async () => {
    // Setup test environment
    networks = {
      bnb: {
        type: 'evm',
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

      [NetworkName.SOLANA]: {
        type: 'solana',
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

    network = new Network({ networks });
    wallet = new Wallet(
      {
        seedPhrase:
          settings.get('WALLET_MNEMONIC') ||
          'test test test test test test test test test test test junk',
        index: 9,
      },
      network,
    );

    console.log('👛 Wallet BNB', await wallet.getAddress(NetworkName.BNB));
    console.log('👛 Wallet Solana', await wallet.getAddress(NetworkName.SOLANA));

    // Mock agent invokeTool to avoid real execution and return test responses
    agent = new Agent(
      {
        model: 'gpt-4o',
        temperature: 0,
      },
      wallet,
      networks,
    );

    // Create mock provider
    mockProvider = {
      getName: () => 'deBridge',
      getSupportedNetworks: () => [NetworkName.BNB, NetworkName.SOLANA, NetworkName.ETHEREUM],
    };

    const provider = new ethers.JsonRpcProvider(BNB_RPC);
    const providerSolana = new Connection(SOL_RPC);
    const deBridge = new deBridgeProvider([provider, providerSolana]);
    bridgePlugin = new BridgePlugin();
    const tokenPlugin = new TokenPlugin();
    const birdeye = new BirdeyeProvider({
      apiKey: settings.get('BIRDEYE_API_KEY'),
    });
    const bnbProvider = new BnbProvider({
      rpcUrl: BNB_RPC,
    });
    const walletPlugin = new WalletPlugin();
    await walletPlugin.initialize({
      defaultChain: 'bnb',
      providers: [bnbProvider, birdeye],
      supportedChains: ['bnb', 'solana'],
    });

    await tokenPlugin.initialize({
      defaultChain: 'bnb',
      providers: [birdeye],
      supportedChains: ['solana', 'bnb'],
    });
    await bridgePlugin.initialize({
      defaultNetwork: NetworkName.BNB,
      providers: [deBridge],
      supportedNetworks: [NetworkName.BNB, NetworkName.SOLANA],
    });

    await agent.registerPlugin(bridgePlugin);
    await agent.registerPlugin(tokenPlugin);
    await agent.registerPlugin(walletPlugin);
  });

  it('Example 1: should execute a bridge from SOL to BNB', async () => {
    const params = {
      fromToken: SOL_NATIVE_TOKEN_ADDRESS, // BNB token address
      toToken: BNB_NATIVE_TOKEN_ADDRESS, // SOL token address
      amount: '0.05',
      amountType: 'input', // Using amountType as per schema
      fromNetwork: NetworkName.SOLANA,
      toNetwork: NetworkName.BNB,
      provider: 'deBridge',
      slippage: 0.5,
    };

    const result = await agent.invokeTool('bridge', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.provider).toBe('deBridge');
    expect(parsedResult.fromToken.address).toBe(SOL_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.toToken.address).toBe(BNB_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.fromAmount).toBe(params.amount);
    expect(parsedResult.toAmount).toBeDefined();
    expect(parsedResult.fromNetwork).toBe(NetworkName.SOLANA);
    expect(parsedResult.toNetwork).toBe(NetworkName.BNB);
    expect(parsedResult.type).toBe('input');
    expect(parsedResult.transactionHash).toBe('0x123FAKE');
    expect(parsedResult.priceImpact).toBeDefined();
  });

  it('Example 2: should fail with invalid token addresses', async () => {
    const params = {
      fromToken: 'InvalidTokenAddress',
      toToken: SOL_NATIVE_TOKEN_ADDRESS,
      amount: '0.05',
      amountType: 'input',
      fromNetwork: NetworkName.BNB,
      toNetwork: NetworkName.SOLANA,
      provider: 'deBridge',
      slippage: 0.5,
    };

    const result = await agent.invokeTool('bridge', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('error');
  });

  // =====Note: maybe throw error before recepit result
  it('Example 3: should fail with insufficient balance', async () => {
    const params = {
      fromToken: BNB_NATIVE_TOKEN_ADDRESS,
      toToken: SOL_NATIVE_TOKEN_ADDRESS,
      amount: '1000000', // Very large amount
      amountType: 'input',
      fromNetwork: NetworkName.BNB,
      toNetwork: NetworkName.SOLANA,
      provider: 'deBridge',
      slippage: 0.5,
    };

    const result = await agent.invokeTool('bridge', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('error');
  });

  it('Example 5: should bridge sol and BNB with large amount', async () => {
    const params = {
      fromToken: SOL_NATIVE_TOKEN_ADDRESS, // BNB token address
      toToken: BNB_NATIVE_TOKEN_ADDRESS, // ETH token address
      amount: '0.05112231112222',
      amountType: 'input',
      fromNetwork: NetworkName.SOLANA,
      toNetwork: NetworkName.BNB,
      provider: 'deBridge',
      slippage: 0.5,
    };

    const result = await agent.invokeTool('bridge', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.provider).toBe('deBridge');
    expect(parsedResult.fromToken.address).toBe(SOL_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.toToken.address).toBe(BNB_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.fromNetwork).toBe(NetworkName.SOLANA);
    expect(parsedResult.toNetwork).toBe(NetworkName.BNB);
    expect(parsedResult.fromAmount).toBe('0.05112231112222');
  });
});
