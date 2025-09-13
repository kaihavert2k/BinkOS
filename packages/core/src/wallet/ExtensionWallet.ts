import { NetworkName } from '../network';
import {
  IWallet,
  SignedTransactionRequest,
  SignMessageParams,
  SignTransactionParams,
  TransactionReceipt,
  TransactionRequest,
} from './types';
import { Socket } from 'socket.io';
import { Network } from '../network/Network';
import { ethers, Transaction as EvmTransaction } from 'ethers';
import {
  Connection,
  Transaction as SolanaTransaction,
  VersionedTransaction,
} from '@solana/web3.js';

export class ExtensionWallet implements IWallet {
  socket: Socket | null = null;
  readonly #network: Network;
  readonly timeout: number;

  constructor(network: Network, timeout: number = 120000) {
    this.#network = network;
    this.timeout = timeout;
  }

  public async connect(socket: Socket): Promise<void> {
    this.socket = socket;
  }

  private async ensureConnection(): Promise<void> {
    if (!this.socket) {
      throw new Error('Not connected to extension wallet client');
    }
    if (!this.socket.connected) {
      throw new Error('Not connected to extension wallet client');
    }
  }

  public async getPublicKey(network: NetworkName): Promise<string> {
    return this.getAddress(network);
  }
  public async getPrivateKey(network: NetworkName): Promise<string> {
    throw new Error('Not supported getting private key for extension wallet');
  }

  public async getAddress(network: NetworkName): Promise<string> {
    await this.ensureConnection();

    const response = (await this.socket
      ?.timeout(this.timeout)
      .emitWithAck('get_address', { network })) as {
      address?: string;
      error?: string;
    };
    if (response.error) {
      throw new Error(response.error);
    }
    if (!response.address) {
      throw new Error('No address found');
    }
    return response.address;
  }

  public async signMessage(params: SignMessageParams): Promise<string> {
    await this.ensureConnection();

    const response = (await this.socket
      ?.timeout(this.timeout)
      .emitWithAck('sign_message', params)) as {
      signature?: string;
      error?: string;
    };
    if (response.error) {
      throw new Error(response.error);
    }
    if (!response.signature) {
      throw new Error('No signature found');
    }
    return response.signature;
  }

  public async signTransaction(params: SignTransactionParams): Promise<string> {
    await this.ensureConnection();

    let transactionStr: string;

    if (params.transaction instanceof EvmTransaction) {
      transactionStr = params.transaction.unsignedSerialized;
    } else if (params.transaction instanceof VersionedTransaction) {
      transactionStr = Buffer.from(params.transaction.serialize()).toString('base64');
    } else {
      transactionStr = Buffer.from(params.transaction.serialize()).toString('base64');
    }

    const response = (await this.socket?.timeout(this.timeout).emitWithAck('sign_transaction', {
      network: params.network,
      transaction: transactionStr,
    })) as { signedTransaction?: string; error?: string };

    if (response.error) {
      throw new Error(response.error);
    }
    if (!response.signedTransaction) {
      throw new Error('No signed transaction found');
    }
    return response.signedTransaction;
  }

  public async waitForSolanaTransaction(
    connection: Connection,
    signature: string,
    blockhash: string,
    lastValidBlockHeight: number,
  ): Promise<void> {
    const result = await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      'confirmed',
    );

    if (result.value.err) {
      throw new Error(`Transaction failed: ${result.value.err.toString()}`);
    }
  }

  public async sendTransaction(
    network: NetworkName,
    signedTransaction: SignedTransactionRequest,
  ): Promise<TransactionReceipt> {
    const networkType = this.#network.getNetworkType(network);
    const networkConfig = this.#network.getConfig(network);

    if (networkType === 'evm') {
      const response = await this.socket?.timeout(this.timeout).emitWithAck('send_transaction', {
        network,
        transaction: signedTransaction.transaction,
      });
      const provider = this.#network.getProvider(network, 'evm');
      const tx = await provider.getTransaction(response.tx_hash);
      if (response.error) {
        throw new Error(response.error);
      }
      if (!response.tx_hash) {
        throw new Error('No tx_hash found');
      }
      return {
        hash: response.tx_hash,
        wait: async () => {
          await tx?.wait();
          return {
            hash: response.tx_hash,
            wait: async () => {
              throw new Error('Already waited');
            },
          };
        },
      };
    } else {
      const connection = new Connection(networkConfig.config.rpcUrl);

      // Try to parse as VersionedTransaction first
      try {
        const tx = VersionedTransaction.deserialize(
          Buffer.from(signedTransaction.transaction, 'base64'),
        );

        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        let lastValidBlockHeight = signedTransaction.lastValidBlockHeight;
        if (!tx.message.recentBlockhash) {
          tx.message.recentBlockhash = latestBlockhash.blockhash;
          lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
        }

        if (!lastValidBlockHeight) {
          throw new Error('Last valid block height is required');
        }

        const simulation = await connection.simulateTransaction(tx, { sigVerify: true });

        if (simulation.value?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(simulation.value?.err)}`);
        }

        // Send and confirm transaction
        const signature = await connection.sendTransaction(tx);

        return {
          hash: signature,
          wait: async () => {
            await this.waitForSolanaTransaction(
              connection,
              signature,
              tx.message.recentBlockhash,
              lastValidBlockHeight,
            );
            return {
              hash: signature,
              wait: async () => ({
                hash: signature,
                wait: async () => {
                  throw new Error('Already waited');
                },
              }),
            };
          },
        };
      } catch (e) {
        // If not a VersionedTransaction, try as regular Transaction
        const tx = SolanaTransaction.from(Buffer.from(signedTransaction.transaction, 'base64'));

        if (!tx.recentBlockhash) {
          const latestBlockhash = await connection.getLatestBlockhash('confirmed');
          tx.recentBlockhash = latestBlockhash.blockhash;
          tx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
        }

        const simulation = await connection.simulateTransaction(tx);

        if (simulation.value?.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(simulation.value?.err)}`);
        }

        // Send and confirm transaction
        const signature = await connection.sendRawTransaction(tx.serialize());

        return {
          hash: signature,
          wait: async () => {
            await this.waitForSolanaTransaction(
              connection,
              signature,
              tx.recentBlockhash!,
              tx.lastValidBlockHeight!,
            );
            return {
              hash: signature,
              wait: async () => ({
                hash: signature,
                wait: async () => {
                  throw new Error('Already waited');
                },
              }),
            };
          },
        };
      }
    }
  }

  public async signAndSendTransaction(
    network: NetworkName,
    transaction: TransactionRequest,
  ): Promise<TransactionReceipt> {
    const networkType = this.#network.getNetworkType(network);
    const networkConfig = this.#network.getConfig(network);

    if (networkType === 'evm') {
      const provider = new ethers.JsonRpcProvider(networkConfig.config.rpcUrl);
      const address = await this.getAddress(network);

      const signer = new ethers.VoidSigner(address, provider);

      // Create and sign transaction
      const tx = await signer.populateTransaction({
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
        gasLimit: transaction.gasLimit,
      });
      tx.from = null;

      const transactionStr = EvmTransaction.from(tx).unsignedSerialized;

      // Send signed transaction
      const sentTx = await this.sendTransaction(network, { transaction: transactionStr });
      const receipt = await sentTx.wait();
      if (!receipt) throw new Error('Transaction failed');

      return {
        hash: sentTx.hash,
        wait: async () => {
          const finalReceipt = await sentTx.wait();
          if (!finalReceipt) throw new Error('Transaction failed');
          return {
            hash: finalReceipt.hash,
            wait: async () => ({
              hash: finalReceipt.hash,
              wait: async () => {
                throw new Error('Already waited');
              },
            }),
          };
        },
      };
    } else {
      const connection = new Connection(networkConfig.config.rpcUrl);

      // Try to parse as VersionedTransaction first
      try {
        let tx = VersionedTransaction.deserialize(Buffer.from(transaction.data, 'base64'));
        const latestBlockhash = await connection.getLatestBlockhash('confirmed');
        let lastValidBlockHeight = transaction.lastValidBlockHeight;
        if (!tx.message.recentBlockhash) {
          tx.message.recentBlockhash = latestBlockhash.blockhash;
          lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
        }

        if (!lastValidBlockHeight) {
          throw new Error('Last valid block height is required');
        }

        // Sign transaction
        const signedTx = await this.signTransaction({
          network,
          transaction: tx as VersionedTransaction,
        });

        // Send raw transaction
        const rawTransaction = Buffer.from(signedTx, 'base64');
        const signature = await connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        return {
          hash: signature,
          wait: async () => {
            await this.waitForSolanaTransaction(
              connection,
              signature,
              tx.message.recentBlockhash,
              lastValidBlockHeight,
            );
            return {
              hash: signature,
              wait: async () => ({
                hash: signature,
                wait: async () => {
                  throw new Error('Already waited');
                },
              }),
            };
          },
        };
      } catch (e) {
        console.log('🚀 ~ Wallet ~ signAndSendTransactionSolana ~ error:', e);

        // If not a VersionedTransaction, try as regular Transaction
        const tx = SolanaTransaction.from(Buffer.from(transaction.data, 'base64'));
        if (!tx.recentBlockhash) {
          const latestBlockhash = await connection.getLatestBlockhash('confirmed');
          tx.recentBlockhash = latestBlockhash.blockhash;
          tx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
        }
        // Sign transaction
        const signedTx = await this.signTransaction({
          network,
          transaction: tx as SolanaTransaction,
        });
        // Send raw transaction
        const rawTransaction = Buffer.from(signedTx, 'base64');
        const signature = await connection.sendRawTransaction(rawTransaction, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        return {
          hash: signature,
          wait: async () => {
            await this.waitForSolanaTransaction(
              connection,
              signature,
              tx.recentBlockhash!,
              tx.lastValidBlockHeight!,
            );
            return {
              hash: signature,
              wait: async () => ({
                hash: signature,
                wait: async () => {
                  throw new Error('Already waited');
                },
              }),
            };
          },
        };
      }
    }
  }

  // Method to disconnect the socket
  public disconnect(): void {
    this.socket?.disconnect();
  }
}
