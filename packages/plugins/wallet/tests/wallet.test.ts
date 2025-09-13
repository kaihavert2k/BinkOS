import { ethers } from 'ethers';
import { Agent, Network, NetworkName, NetworksConfig, settings } from '@binkai/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Wallet } from '@binkai/core';
import { Connection } from '@solana/web3.js';
import { WalletPlugin } from '../src';
import { BnbProvider } from '../../../providers/rpc/src/BnbProvider';
import { SolanaProvider } from '../../../providers/rpc/src/SolanaProvider';
import { AlchemyProvider } from '../../../providers/alchemy/src/AlchemyProvider';
import { BirdeyeProvider } from '../../../providers/birdeye/src/BirdeyeProvider';
import { TokenPlugin } from '@binkai/token-plugin/src/TokenPlugin';

describe('WalletPlugin', () => {
  let walletPlugin;
  let wallet: Wallet;
  let network: Network;
  let mockProvider: any; // Mock provider
  let agent: Agent;
  let networks: NetworksConfig['networks'];

  const BNB_RPC = 'https://binance.llamarpc.com';
  const SOL_RPC = 'https://api.mainnet-beta.solana.com';
  const BNB_NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const USDT_TOKEN_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'; // USDT on BSC
  const BINK_TOKEN_ADDRESS = '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1';
  const SAMPLE_RECIPIENT_ADDRESS = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
  const SAMPLE_RECIPIENT_ADDRESS_SOLANA = '7yNa8J1KTgGFWVuKHuEKLCcZCkZq5xoSPiAjjviDNc7z';
  const USDC_SOLANA_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const SOLANA_NATIVE_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111111';
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

    const userAddress = await wallet.getAddress(NetworkName.BNB);
    console.log('👛 Wallet BNB', userAddress);
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

    const bnbProvider = new BnbProvider({
      rpcUrl: BNB_RPC,
    });
    const solanaProvider = new SolanaProvider({
      rpcUrl: SOL_RPC,
    });

    const alchemyProvider = new AlchemyProvider({
      apiKey: settings.get('ALCHEMY_API_KEY'),
    });
    // Create Birdeye provider with API key
    const birdeyeProvider = new BirdeyeProvider({
      apiKey: settings.get('BIRDEYE_API_KEY'),
    });

    walletPlugin = new WalletPlugin();
    await walletPlugin.initialize({
      providers: [alchemyProvider, birdeyeProvider, solanaProvider, bnbProvider],
      supportedNetworks: [NetworkName.BNB, NetworkName.SOLANA],
    });

    const tokenPlugin = new TokenPlugin();
    await tokenPlugin.initialize({
      defaultChain: 'bnb',
      providers: [birdeyeProvider],
      supportedChains: ['bnb', 'solana'],
    });

    await agent.registerPlugin(walletPlugin);
    await agent.registerPlugin(tokenPlugin);
  });

  it('Example 1: should transfer native tokens', async () => {
    const params = {
      token: BNB_NATIVE_TOKEN_ADDRESS,
      toAddress: SAMPLE_RECIPIENT_ADDRESS,
      amount: '0.001',
      network: NetworkName.BNB,
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.provider).toBe('bnb');
    expect(parsedResult.token.symbol).toBe('BNB');
    expect(parsedResult.toAddress).toBe(SAMPLE_RECIPIENT_ADDRESS);
    expect(parsedResult.amount).toBe(params.amount);
    expect(parsedResult.transactionHash).toBeDefined();
    expect(parsedResult.network).toBe(NetworkName.BNB);
  });

  it('Example 2: should transfer ERC20 tokens', async () => {
    const params = {
      token: BINK_TOKEN_ADDRESS,
      toAddress: SAMPLE_RECIPIENT_ADDRESS,
      amount: '0.1',
      network: NetworkName.BNB,
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.provider).toBe('bnb');
    expect(parsedResult.token.symbol).toBe('BINK');
    expect(parsedResult.token.address).toBe(BINK_TOKEN_ADDRESS);
    expect(parsedResult.toAddress).toBe(SAMPLE_RECIPIENT_ADDRESS);
    expect(parsedResult.amount).toBe(params.amount);
    expect(parsedResult.transactionHash).toBeDefined();
    expect(parsedResult.network).toBe(NetworkName.BNB);
  });

  it('Example 3: should fail with insufficient balance', async () => {
    const params = {
      token: BNB_NATIVE_TOKEN_ADDRESS,
      toAddress: SAMPLE_RECIPIENT_ADDRESS,
      amount: '1000000', // Very large amount
      network: NetworkName.BNB,
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('error');
    expect(parsedResult.message).toContain('Insufficient balance');
  });

  it('Example 4: should fail with invalid token address', async () => {
    const params = {
      token: 'InvalidTokenAddress',
      toAddress: SAMPLE_RECIPIENT_ADDRESS,
      amount: '0.1',
      network: NetworkName.BNB,
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('error');
    expect(parsedResult.message).toContain('Invalid token address');
  });

  it('Example 5: should fail with invalid recipient address', async () => {
    const params = {
      token: BNB_NATIVE_TOKEN_ADDRESS,
      toAddress: 'InvalidRecipientAddress',
      amount: '0.1',
      network: NetworkName.BNB,
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('error');
    expect(parsedResult.message).toContain('Invalid recipient address');
  });

  it('Example 6: should transfer SOL tokens successfully', async () => {
    const params = {
      token: SOLANA_NATIVE_TOKEN_ADDRESS, // Native SOL token address
      toAddress: SAMPLE_RECIPIENT_ADDRESS_SOLANA,
      amount: '0.001',
      network: NetworkName.SOLANA,
      provider: 'solana',
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.network).toBe(NetworkName.SOLANA);
    expect(parsedResult.transactionHash).toBeDefined();
    expect(parsedResult.token.symbol).toBe('SOL');
    expect(parsedResult.toAddress).toBe(SAMPLE_RECIPIENT_ADDRESS_SOLANA);
    expect(parsedResult.amount).toBe(params.amount);
  });

  it('Example 7: should transfer USDC on Solana successfully', async () => {
    const params = {
      token: USDC_SOLANA_ADDRESS,
      toAddress: SAMPLE_RECIPIENT_ADDRESS_SOLANA,
      amount: '0.1',
      network: NetworkName.SOLANA,
      provider: 'solana',
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.token.address).toBe(USDC_SOLANA_ADDRESS);
    expect(parsedResult.network).toBe(NetworkName.SOLANA);
    expect(parsedResult.transactionHash).toBeDefined();
    expect(parsedResult.token.symbol).toBe('USDC');
    expect(parsedResult.toAddress).toBe(SAMPLE_RECIPIENT_ADDRESS_SOLANA);
    expect(parsedResult.amount).toBe(params.amount);
  }, 10000);

  it('Example 8: should fail with invalid Solana address', async () => {
    const params = {
      token: USDC_SOLANA_ADDRESS,
      toAddress: 'InvalidSolanaAddress',
      amount: '0.1',
      network: NetworkName.SOLANA,
      provider: 'solana',
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('error');
  });

  it('Example 9: should fail with insufficient SOL balance', async () => {
    const params = {
      token: SOLANA_NATIVE_TOKEN_ADDRESS,
      toAddress: SAMPLE_RECIPIENT_ADDRESS_SOLANA,
      amount: '100000', // Very large amount
      network: NetworkName.SOLANA,
      provider: 'solana',
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('error');
    expect(parsedResult.message).toContain('Insufficient balance');
  });
  it('Example 10: check balance float large amount solana', async () => {
    const params = {
      token: USDC_SOLANA_ADDRESS,
      toAddress: SAMPLE_RECIPIENT_ADDRESS_SOLANA,
      amount: '0.112323232323',
      network: NetworkName.SOLANA,
      provider: 'solana',
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.network).toBe(NetworkName.SOLANA);
    expect(parsedResult.transactionHash).toBeDefined();
    expect(parsedResult.token.symbol).toBe('USDC');
    expect(parsedResult.toAddress).toBe(SAMPLE_RECIPIENT_ADDRESS_SOLANA);
    expect(parsedResult.amount).toBe(params.amount);
  });

  it('Example 11: check balance float large amount BNB', async () => {
    const params = {
      token: BNB_NATIVE_TOKEN_ADDRESS,
      toAddress: SAMPLE_RECIPIENT_ADDRESS,
      amount: '0.001123232323',
      network: NetworkName.BNB,
      provider: 'bnb',
    };

    const result = await agent.invokeTool('transfer_tokens', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.network).toBe(NetworkName.BNB);
    expect(parsedResult.transactionHash).toBeDefined();
    expect(parsedResult.token.symbol).toBe('BNB');
    expect(parsedResult.toAddress).toBe(SAMPLE_RECIPIENT_ADDRESS);
    expect(parsedResult.amount).toBe(params.amount);
  });
});
