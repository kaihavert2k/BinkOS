import { ethers } from 'ethers';
import { Agent, Network, NetworkName, NetworksConfig, settings } from '@binkai/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { Wallet } from '@binkai/core';
import { Connection } from '@solana/web3.js';
import { SwapPlugin } from '../src';
import { JupiterProvider } from '../../../providers/jupiter/src/JupiterProvider';
import { KyberProvider } from '../../../providers/kyber/src/KyberProvider';
import { PancakeSwapProvider } from '../../../providers/pancakeswap/src/PancakeSwapProvider';
import { OkuProvider } from '../../../providers/oku/src/OkuProvider';
import { ThenaProvider } from '../../../providers/thena/src/ThenaProvider';

describe('SwapPlugin', () => {
  let swapPlugin: SwapPlugin;
  let wallet: Wallet;
  let jupiterProvider: JupiterProvider;
  let bnbProvider: ethers.JsonRpcProvider;
  let agent: Agent;
  let networks: NetworksConfig['networks'];

  const BNB_RPC = 'https://binance.llamarpc.com';
  const SOL_RPC = 'https://api.mainnet-beta.solana.com';
  const SOL_NATIVE_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111111';
  const WSOL_NATIVE_TOKEN_ADDRESS = 'So11111111111111111111111111111111111111112';
  const USDC_TOKEN_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

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

    const network = new Network({ networks });
    wallet = new Wallet(
      {
        seedPhrase:
          settings.get('WALLET_MNEMONIC') ||
          'test test test test test test test test test test test junk',
        index: 9,
      },
      network,
    );

    console.log('👛 Wallet Solana', await wallet.getAddress(NetworkName.SOLANA));
    console.log('👛 Wallet BNB', await wallet.getAddress(NetworkName.BNB));

    jupiterProvider = new JupiterProvider(new Connection(SOL_RPC));
    bnbProvider = new ethers.JsonRpcProvider(BNB_RPC);
    const kyber = new KyberProvider(bnbProvider, 56);
    const pancakeswap = new PancakeSwapProvider(bnbProvider, 56);
    const oku = new OkuProvider(bnbProvider, 56);
    const thena = new ThenaProvider(bnbProvider, 56);

    swapPlugin = new SwapPlugin();
    await swapPlugin.initialize({
      defaultNetwork: NetworkName.SOLANA,
      providers: [new JupiterProvider(new Connection(SOL_RPC)), kyber, pancakeswap, oku, thena],
      supportedNetworks: [NetworkName.SOLANA, NetworkName.BNB],
    });

    agent = new Agent(
      {
        model: 'gpt-4o-mini',
        temperature: 0,
      },
      wallet,
      networks,
    );

    await agent.registerPlugin(swapPlugin);
  });

  it('Test 1: should execute a swap on Solana network', async () => {
    const params = {
      fromToken: SOL_NATIVE_TOKEN_ADDRESS, // SOL token address
      toToken: USDC_TOKEN_ADDRESS, // USDC token address
      amount: '0.01',
      amountType: 'input',
      network: NetworkName.SOLANA,
      provider: 'jupiter',
      slippage: 0.5,
      limitPrice: 0,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult).toMatchObject({
      status: 'success',
    });
    expect(parsedResult.fromToken.address).toBe(WSOL_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.toToken.address).toBe(USDC_TOKEN_ADDRESS);
    expect(parsedResult.fromAmount).toBe('0.01');
    expect(parsedResult.type).toBe('input');
    expect(parsedResult.network).toBe('solana');
  });

  it('Test 2: should fail with invalid token addresses', async () => {
    const params = {
      fromToken: 'InvalidThisTokenAddress',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.01',
      amountType: 'input',
      network: NetworkName.SOLANA,
      provider: 'jupiter',
      slippage: 0.5,
      limitPrice: 0,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult).toMatchObject({
      status: 'error',
    });
  });

  it('Test 3: should fail with insufficient balance', async () => {
    const params = {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '1000000', // Very large amount
      amountType: 'input',
      network: NetworkName.SOLANA,
      provider: 'jupiter',
      slippage: 0.5,
      limitPrice: 0,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult).toMatchObject({
      status: 'error',
    });
  });

  it('Test 4: should handle output amount type correctly', async () => {
    const params = {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.12322434344',
      amountType: 'output',
      network: NetworkName.SOLANA,
      provider: 'jupiter',
      slippage: 0.5,
      limitPrice: 0,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.fromToken.address).toBe(WSOL_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.toToken.address).toBe(USDC_TOKEN_ADDRESS);
    expect(parsedResult.toAmount).toBe('0.123224');
    expect(parsedResult.type).toBe('output');
    expect(parsedResult.network).toBe('solana');
  });

  it('Test 6: limit order', async () => {
    const params = {
      fromToken: 'So11111111111111111111111111111111111111111',
      toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      amount: '0.00123243435354546565656',
      amountType: 'input',
      network: NetworkName.SOLANA,
      provider: 'jupiter',
      slippage: 0.5,
      limitPrice: 100,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.fromToken.address).toBe(WSOL_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.toToken.address).toBe(USDC_TOKEN_ADDRESS);
    expect(parsedResult.toAmount).toBe('0.001232434');
    expect(parsedResult.type).toBe('output');
    expect(parsedResult.network).toBe('solana');
  });

  // === BNB CHAIN ===
  it('Test 7: swap bink to usdt on the BNB chain via kyber', async () => {
    const params = {
      fromToken: '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1',
      toToken: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
      amount: '1.122234555',
      amountType: 'input',
      network: NetworkName.BNB,
      provider: 'kyber',
      slippage: 0.5,
      limitPrice: 0,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.fromToken.address).toBe('0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1');
    expect(parsedResult.toToken.address).toBe('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82');
    expect(parsedResult.provider).toBe('kyber');
  });

  it('Test 8: swap bink to usdt on the BNB chain via pancakeswap', async () => {
    const params = {
      fromToken: '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1',
      toToken: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
      amount: '1.122234555',
      amountType: 'input',
      network: NetworkName.BNB,
      provider: 'pancakeswap',
      slippage: 0.5,
      limitPrice: 0,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.fromToken.address).toBe('0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1');
    expect(parsedResult.toToken.address).toBe('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82');
    expect(parsedResult.provider).toBe('pancakeswap');
  });

  it('Test 9: swap bink to usdt on the BNB chain via oku', async () => {
    const params = {
      fromToken: '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1',
      toToken: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
      amount: '1.122234555',
      amountType: 'input',
      network: NetworkName.BNB,
      provider: 'oku',
      slippage: 0.5,
      limitPrice: 0,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.fromToken.address).toBe('0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1');
    expect(parsedResult.toToken.address).toBe('0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82');
    expect(parsedResult.fromAmount).toBe('1.122234555');
    expect(parsedResult.provider).toBe('oku');
  });

  it('Test 10: should faild another stable', async () => {
    const params = {
      fromToken: '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1',
      toToken: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
      amount: '1.122234555',
      amountType: 'input',
      network: NetworkName.BNB,
      provider: 'thena',
      slippage: 0.5,
      limitPrice: 1110,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('error');
  });

  it('Test 11: limir oder bink to usdt with thena', async () => {
    const params = {
      fromToken: '0x5fdfafd107fc267bd6d6b1c08fcafb8d31394ba1',
      toToken: '0x55d398326f99059ff775485246999027b3197955',
      amount: '1.1',
      amountType: 'input',
      network: NetworkName.BNB,
      provider: 'thena',
      slippage: 0.5,
      limitPrice: 1.2,
    };

    const result = await agent.invokeTool('swap', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
  }, 90000);
});
