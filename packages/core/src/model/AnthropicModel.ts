import { BaseModel } from "./BaseModel";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { AgentConfig } from "../agent/types";

interface AnthropicModelConfig extends AgentConfig {
    apiKey: string;
    model: string;
}
export class AnthropicModel extends BaseModel {
    private config: AnthropicModelConfig;

    constructor(config: AnthropicModelConfig) {
        super();
        this.config = config;
    }

    getLangChainLLM(): BaseChatModel {
        // @ts-ignore
        return new ChatAnthropic({
            apiKey: this.config.apiKey,
            model: this.config.model,
            temperature: this.config?.temperature,
            maxTokens: this.config?.maxTokens,
        });
    }
}