import { ChatOpenAI } from '@langchain/openai';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { IWallet } from '../wallet/types';
import { NetworkName, NetworksConfig } from '../network/types';
import { AgentConfig, AgentContext, AgentExecuteParams, IAgent } from './types';
import { GetWalletAddressTool, ITool } from './tools';
import { BaseAgent } from './BaseAgent';
import { IPlugin } from '../plugin/types';
import { DatabaseAdapter } from '../storage';
import { MessageEntity } from '../types';
import { EVM_NATIVE_TOKEN_ADDRESS, SOL_NATIVE_TOKEN_ADDRESS } from '../network';
import { CallbackManager, IToolExecutionCallback } from './callbacks';
import { CompiledStateGraph } from '@langchain/langgraph';
import { IModel } from '../model/types';

export class Agent extends BaseAgent {
  protected model: IModel;
  private wallet: IWallet;
  private executor!: AgentExecutor;
  private networks: NetworksConfig['networks'];
  protected db: DatabaseAdapter<any> | undefined;
  protected context: AgentContext = {};
  public readonly config: AgentConfig;
  constructor(model: IModel, config: AgentConfig, wallet: IWallet, networks: NetworksConfig['networks']) {
    super();
    this.model = model;
    this.wallet = wallet;
    this.networks = networks;
    this.config = config;

    this.initializeDefaultTools();
  }

  getModel(): IModel {
    return this.model;
  }

  getContext(): AgentContext {
    return this.context;
  }

  public isMockResponseTool(): boolean {
    return this.config.isMockResponseTool ?? false;
  }

  async initialize() {
    await this.initializeContext();
    await this.initializeExecutor();
  }

  protected getDefaultTools(): ITool[] {
    return [new GetWalletAddressTool({})];
  }

  private initializeDefaultTools(): void {
    const defaultTools = this.getDefaultTools();

    // Initialize default tools
    for (const tool of defaultTools) {
      this.registerTool(tool);
    }
  }

  async registerPlugin(plugin: IPlugin): Promise<void> {
    const pluginName = plugin.getName();
    this.plugins.set(pluginName, plugin);

    // Register all tools from the plugin
    const tools = plugin.getTools();
    for (const tool of tools) {
      await this.registerTool(tool);
    }
    this.initializeExecutor();
  }

  // initialize all plugins at once with all tools in the plugins
  async registerListPlugins(plugins: IPlugin[]): Promise<void> {
    for (const plugin of plugins) {
      const pluginName = plugin.getName();
      this.plugins.set(pluginName, plugin);
      const tools = plugin.getTools();
      for (const tool of tools) {
        await this.registerTool(tool);
      }
    }
    console.log('✓ Plugins registered\n');
    this.initializeExecutor();
  }

  getPlugin(name: string): IPlugin | undefined {
    return this.plugins.get(name);
  }

  protected async unregisterPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      await plugin.cleanup();
      this.plugins.delete(name);

      // Recreate tools array without this plugin's tools
      const pluginToolNames = new Set(plugin.getTools().map(t => t.getName()));
      this.tools = this.tools.filter(t => !pluginToolNames.has(t.name));

      // Reinitialize executor with updated tools
      await this.initializeExecutor();
    }
  }

  protected async onToolsUpdated(): Promise<void> {}

  private async initializeExecutor(): Promise<void> {
    this.executor = (await this.createExecutor()) as AgentExecutor;
  }

  async registerDatabase(database: DatabaseAdapter<any> | undefined): Promise<void> {
    try {
      if (database) {
        this.db = database;
        await this.db.init();
        console.info('✓ Database initialized\n');
      }
    } catch (error) {
      console.error('Failed to connect to Postgres:', error);
      throw error; // Re-throw to handle it in the calling code
    }
  }

  async initializeContext(): Promise<AgentContext> {
    if (this.db) {
      const networkNames = Object.keys(this.networks);
      if (networkNames.length) {
        const defaultNetwork = networkNames[0] as NetworkName;
        const address = await this.wallet?.getAddress(defaultNetwork);
        if (!address) throw new Error('Not found wallet address');
        const user = await this.db.createAndGetUserByAddress({ address });
        this.context.user = user;
      }
    }
    return this.context;
  }

  protected async createExecutor(): Promise<
    AgentExecutor | CompiledStateGraph<any, any, any, any, any, any>
  > {
    const requiredPrompt = `
    Native token address: 
    - EVM (${Object.values(this.networks)
      .filter(network => network.type === 'evm')
      .map(network => network.config.name)
      .join(', ')}): ${EVM_NATIVE_TOKEN_ADDRESS}
    - Solana: ${SOL_NATIVE_TOKEN_ADDRESS}
    Available networks include: ${Object.keys(this.networks).join(', ')}`;

    const defaultSystemPrompt = `You are a helpful blockchain agent. You can help users interact with different blockchain networks. 
    First, you need to understand the user's request and then you need to choose the appropriate tool to execute the user's request.
    If you get an error after executing the command, show users the process you have done step by step and the problem you got and suggest a solution to fix the error.
    Ask users if your understanding is correct and if you need to change anything in the process you have done.`;

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', `${this.config.systemPrompt ?? defaultSystemPrompt}\n${requiredPrompt}`],
      new MessagesPlaceholder('chat_history'),
      ['human', '{input}'],
      new MessagesPlaceholder('agent_scratchpad'),
    ]);

    const agent = createOpenAIToolsAgent({
      llm: this.getModel().getLangChainLLM(),
      tools: this.getTools(),
      prompt,
    });

    return AgentExecutor.fromAgentAndTools({
      agent: await agent,
      tools: this.getTools(),
    });
  }

  async execute(commandOrParams: string | AgentExecuteParams): Promise<any> {
    // Wait for executor to be initialized if it hasn't been already
    if (!this.executor) {
      await this.initializeExecutor();
    }
    if (!Object.keys(this.context).length) {
      await this.initializeContext();
    }
    let _history: MessageEntity[] = [];

    if (this.db) {
      if (typeof commandOrParams === 'string') {
        if (this.context?.user?.id) {
          _history = await this.db?.getMessagesByUserId(this.context?.user?.id);
        }
      } else {
        if (commandOrParams?.threadId) {
          _history = await this.db?.getMessagesByThreadId(commandOrParams?.threadId);
        }
      }
      // } else {
      //   if (typeof commandOrParams !== 'string' && commandOrParams?.history) {
      //     _history = commandOrParams.history;
      //   }
    }

    const history = _history.map((message: MessageEntity) =>
      message?.message_type === 'human'
        ? new HumanMessage(message?.content)
        : new AIMessage(message?.content),
    );

    const maxRetries = 3;
    let retryCount = 0;
    let lastError: any = null;
    let result: any;

    const originalInput =
      typeof commandOrParams === 'string' ? commandOrParams : commandOrParams.input;

    while (retryCount <= maxRetries) {
      console.log(`🔴 AI reasoning attempt ${retryCount + 1}/${maxRetries}\n`);

      try {
        const input = typeof commandOrParams === 'string' ? commandOrParams : commandOrParams.input;

        // Only use history on first try
        const chat_history = history;

        result = await this.executor.invoke({ input, chat_history });

        if (result && result.output) {
          if (
            typeof result.output === 'string' &&
            (result.output.includes('error') ||
              result.output.includes('Error') ||
              result.output.includes('failed'))
          ) {
            retryCount++;

            if (retryCount === maxRetries) {
              console.error(`🔴 AI reasoning max retries reached, returning error output`);
              try {
                const threadId =
                  typeof commandOrParams === 'string' ? undefined : commandOrParams?.threadId;
                await this.db?.createMessage(
                  {
                    content: originalInput,
                    user_id: this.context?.user?.id,
                    message_type: 'human',
                  },
                  threadId,
                );
                await this.db?.createMessage(
                  { content: result.output, user_id: this.context?.user?.id, message_type: 'ai' },
                  threadId,
                );
              } catch (dbError) {
                console.error('Error persisting message:', dbError);
              }

              return result.output;
            }

            const retryPrompt = `The previous command failed with error: "${result.output}". Please rethink and change your approach, planning different steps/tools to fix the issue. Original command: ${originalInput}`;

            if (typeof commandOrParams === 'string') {
              commandOrParams = retryPrompt;
            } else {
              commandOrParams.input = retryPrompt;
            }

            console.error(
              `🔴 AI reasoning attempt ${retryCount} failed with output error, retrying...`,
            );
            continue;
          }

          try {
            const threadId =
              typeof commandOrParams === 'string' ? undefined : commandOrParams?.threadId;

            await this.db?.createMessage(
              { content: originalInput, user_id: this.context?.user?.id, message_type: 'human' },
              threadId,
            );

            await this.db?.createMessage(
              { content: result.output, user_id: this.context?.user?.id, message_type: 'ai' },
              threadId,
            );

            console.log('Message persisted successfully');
          } catch (dbError) {
            console.error('Error persisting message:', dbError);
          }

          return result.output;
        }
      } catch (error) {
        lastError = error;
        console.error(`🔴 AI reasoning attempt ${retryCount + 1} failed with exception:`, error);

        retryCount++;

        if (retryCount === maxRetries) {
          console.error(`🔴 AI reasoning max retries reached, returning error`);
          return JSON.stringify({
            status: 'error',
            message: lastError instanceof Error ? lastError.message : String(lastError),
          });
        }

        // Retry prompt
        const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
        const retryPrompt = `The previous command failed with error: "${errorMsg}". Please rethink and try to fix the issue. Original command: ${originalInput}`;

        if (typeof commandOrParams === 'string') {
          commandOrParams = retryPrompt;
        } else {
          commandOrParams.input = retryPrompt;
        }
      }
    }

    // Fallback if loop ended without return
    return JSON.stringify({
      status: 'error',
      message: 'Execution failed after maximum retries',
    });
  }

  public getWallet(): IWallet {
    return this.wallet;
  }

  public getNetworks(): NetworksConfig['networks'] {
    return this.networks;
  }
}
