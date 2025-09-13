import { ChatOllama } from "@langchain/ollama";
import { BaseModel } from "./BaseModel";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentConfig } from "../agent/types";

interface OllamaModelConfig extends AgentConfig {
    apiKey: string;
    model: string;
}

export class OllamaModel extends BaseModel {
    private config: OllamaModelConfig;

    constructor(config: OllamaModelConfig) {
        super();
        this.config = config;
    }

    getLangChainLLM(): BaseChatModel {
        return new ChatOllama({
            model: this.config.model,
            temperature: this.config?.temperature,
        });
    }
}