import { BaseModel } from "./BaseModel";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentConfig } from "../agent/types";
import { ChatMistralAI } from "@langchain/mistralai";

interface MistralModelConfig extends AgentConfig {
    apiKey: string;
    model: string;
}

export class MistralModel extends BaseModel {
    private config: MistralModelConfig;

    getLangChainLLM(): BaseChatModel {
        return new ChatMistralAI({
            apiKey: this.config.apiKey,
            model: this.config.model,
            temperature: this.config?.temperature,
            maxTokens: this.config?.maxTokens,
        });
    }
    // getN8nLLM() {
    //     throw new Error("Method not implemented.");
    // }
    constructor(config: MistralModelConfig) {
        super();
        this.config = config;
    }


}