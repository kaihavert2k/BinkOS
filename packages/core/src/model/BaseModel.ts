import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { IModel } from "./types";

export abstract class BaseModel implements IModel {
    abstract getLangChainLLM(): BaseChatModel;
    // abstract getN8nLLM(): N8nLLM;
}