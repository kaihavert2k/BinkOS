import { ethers } from 'ethers';
import { Agent, Network, NetworkName, NetworksConfig, settings } from '@binkai/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Wallet } from '@binkai/core';
import { Connection } from '@solana/web3.js';
import { StakingPlugin } from '../src';
import { VenusProvider } from '../../../providers/venus/src';
import { WalletPlugin } from '../../wallet/src/WalletPlugin';
import { BnbProvider } from '../../../providers/rpc/src';
import { AlchemyProvider } from '../../../providers/alchemy/src/AlchemyProvider';
import { ListaProvider } from '../../../providers/lista/src';
import { KernelDaoProvider } from '../../../providers/kernel-dao/src';

describe('StakingPlugin', () => {
  let stakingPlugin: StakingPlugin;
  let wallet: Wallet;
  let network: Network;
  let mockProvider: any; // Mock provider
  let agent: Agent;
  let networks: NetworksConfig['networks'];

  const BNB_RPC = 'https://binance.llamarpc.com';
  const ETH_RPC = 'https://eth.llamarpc.com';
  const SOL_RPC = 'https://api.mainnet-beta.solana.com';
  const BNB_NATIVE_TOKEN_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const USDT_TOKEN_ADDRESS = '0x55d398326f99059fF775485246999027B3197955'; // USDT on BSC
  const VUSDT_TOKEN_ADDRESS = '0xfD5840Cd36d94D7229439859C0112a4185BC0255'; // Venus USDT on BSC

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
    const provider = new ethers.JsonRpcProvider(BNB_RPC);
    const walletPlugin = new WalletPlugin();
    // Create provider with API key
    const bnbProvider = new BnbProvider({
      rpcUrl: BNB_RPC,
    });
    const alchemyProvider = new AlchemyProvider({
      apiKey: settings.get('ALCHEMY_API_KEY'),
    });
    await walletPlugin.initialize({
      defaultChain: 'bnb',
      providers: [bnbProvider, alchemyProvider],
      supportedChains: ['bnb'],
    });
    await agent.registerPlugin(walletPlugin);
    const stakingPlugin = new StakingPlugin();
    const venus = new VenusProvider(provider, 56);
    const kernelDao = new KernelDaoProvider(provider, 56);
    const venusStaking = new VenusProvider(provider, 56);
    const listaStaking = new ListaProvider(provider, 56);

    await stakingPlugin.initialize({
      defaultNetwork: NetworkName.BNB,
      providers: [venus, kernelDao, venusStaking, listaStaking],
      supportedNetworks: [NetworkName.BNB],
    });

    await agent.registerPlugin(stakingPlugin);
  });

  it('Example 1: should supply tokens to a staking platform', async () => {
    const params = {
      tokenA: BNB_NATIVE_TOKEN_ADDRESS,
      amountA: '0.001122234344',
      type: 'supply',
      network: NetworkName.BNB,
      provider: 'kernelDao', // venus, kernelDao, , lista
    };

    const result = await agent.invokeTool('staking', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    let checkProvider = false;
    if (
      parsedResult.provider &&
      (parsedResult.provider === 'venus' ||
        parsedResult.provider === 'kernelDao' ||
        parsedResult.provider === 'lista')
    ) {
      checkProvider = true;
    }
    expect(checkProvider).toBe(true);
    expect(parsedResult.tokenA.address).toBe(BNB_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.amountA).toBe(params.amountA);
    expect(parsedResult.type).toBe('supply');
    expect(parsedResult.network).toBe(NetworkName.BNB);
    expect(parsedResult.transactionHash).toBeDefined();
  });

  it('Example 2: should withdraw tokens from a staking platform', async () => {
    const params = {
      tokenA: BNB_NATIVE_TOKEN_ADDRESS,
      amountA: '0.001',
      type: 'withdraw',
      network: NetworkName.BNB,
      provider: 'kernelDao', // venus, kernelDao, , lista
    };

    const result = await agent.invokeTool('staking', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    let checkProvider = false;
    if (
      parsedResult.provider &&
      (parsedResult.provider === 'venus' ||
        parsedResult.provider === 'kernelDao' ||
        parsedResult.provider === 'lista')
    ) {
      checkProvider = true;
    }
    expect(parsedResult.tokenA.address).toBe(BNB_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.amountA).toBe(params.amountA);
    expect(parsedResult.type).toBe('withdraw');
    expect(parsedResult.network).toBe(NetworkName.BNB);
    expect(parsedResult.transactionHash).toBeDefined();
  });

  it('Example 3: should stake native tokens', async () => {
    const params = {
      tokenA: BNB_NATIVE_TOKEN_ADDRESS,
      amountA: '0.001',
      type: 'stake',
      network: NetworkName.BNB,
      provider: 'kernelDao', // venus, kernelDao, , lista
    };

    const result = await agent.invokeTool('staking', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    let checkProvider = false;
    if (
      parsedResult.provider &&
      (parsedResult.provider === 'venus' ||
        parsedResult.provider === 'kernelDao' ||
        parsedResult.provider === 'lista')
    ) {
      checkProvider = true;
    }
    expect(parsedResult.tokenA.address).toBe(BNB_NATIVE_TOKEN_ADDRESS);
    expect(parsedResult.amountA).toBe(params.amountA);
    expect(parsedResult.type).toBe('stake');
    expect(parsedResult.network).toBe(NetworkName.BNB);
    expect(parsedResult.transactionHash).toBeDefined();
    expect(parsedResult.transactionHash).not.toBeNull();
  });

  it('Example 4: should unstake tokens', async () => {
    const params = {
      tokenA: BNB_NATIVE_TOKEN_ADDRESS, // vBNB token
      amountA: '0.001',
      type: 'unstake',
      network: NetworkName.BNB,
      provider: 'kernelDao', // venus, kernelDao, , lista
    };

    const result = await agent.invokeTool('staking', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    let checkProvider = false;
    if (
      parsedResult.provider &&
      (parsedResult.provider === 'venus' ||
        parsedResult.provider === 'kernelDao' ||
        parsedResult.provider === 'lista')
    ) {
      checkProvider = true;
    }
    expect(parsedResult.tokenB.symbol).toBe('BNB');
    expect(parsedResult.amountA).toBe(params.amountA);
    expect(parsedResult.amountB).toBe('0');
    expect(parsedResult.type).toBe('unstake');
    expect(parsedResult.network).toBe(NetworkName.BNB);
    expect(parsedResult.transactionHash).toBeDefined();
  });

  it('Example 5: should fail with insufficient balance', async () => {
    const params = {
      tokenA: BNB_NATIVE_TOKEN_ADDRESS,
      amountA: '1000000', // Very large amount
      type: 'supply',
      network: NetworkName.BNB,
      provider: 'kernelDao', // venus, kernelDao, , lista
    };

    const result = await agent.invokeTool('staking', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
    expect(result).toBeDefined();
    expect(parsedResult.status).toBe('error');
  }, 90000);

  it('Example 6: should fail with invalid token address', async () => {
    const params = {
      tokenA: 'InvalidTokenAddress',
      amountA: '0.001',
      type: 'supply',
      network: NetworkName.BNB,
      provider: 'kernelDao', // venus, kernelDao, , lista
    };

    const result = await agent.invokeTool('staking', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(result).toBeDefined();
    expect(parsedResult.status).toBe('error');
  });

  it('Example 7: should get staking balance', async () => {
    const params = {
      network: NetworkName.BNB,
      provider: 'kernelDao', // venus, kernelDao, , lista
    };

    const result = await agent.invokeTool('get_staking_balance', params);
    const parsedResult = typeof result === 'string' ? JSON.parse(result) : result;

    expect(parsedResult).toBeDefined();
    expect(parsedResult.status).toBe('success');
    expect(parsedResult.network).toBe(NetworkName.BNB);
  });
});
