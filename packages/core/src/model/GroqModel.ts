import { BaseModel } from "./BaseModel";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentConfig } from "../agent/types";
import { ChatGroq } from "@langchain/groq";

interface GroqModelConfig extends AgentConfig {
    apiKey: string;
    model: string;
}

export class GroqModel extends BaseModel {
    private config: GroqModelConfig;

    getLangChainLLM(): BaseChatModel {
        // @ts-ignore
        return new ChatGroq({
            apiKey: this.config.apiKey,
            model: this.config.model,
            temperature: this.config?.temperature,
            maxTokens: this.config?.maxTokens,
        });
    }
    // getN8nLLM() {
    //     throw new Error("Method not implemented.");
    // }
    constructor(config: GroqModelConfig) {
        super();
        this.config = config;
    }


}