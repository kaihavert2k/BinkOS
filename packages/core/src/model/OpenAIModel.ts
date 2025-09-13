import { ChatOpenAI } from "@langchain/openai";
import { BaseModel } from "./BaseModel";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentConfig } from "../agent/types";

interface OpenAIModelConfig extends AgentConfig {
    apiKey: string;
    model: string;
}

export class OpenAIModel extends BaseModel {
    private config: OpenAIModelConfig;

    getLangChainLLM(): BaseChatModel {
        return new ChatOpenAI({
            apiKey: this.config.apiKey,
            model: this.config.model,
            temperature: this.config?.temperature,
            maxTokens: this.config?.maxTokens,
        });
    }
    // getN8nLLM() {
    //     throw new Error("Method not implemented.");
    // }
    constructor(config: OpenAIModelConfig) {
        super();
        this.config = config;
    }


}