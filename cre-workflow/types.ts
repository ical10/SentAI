// Type definitions and schemas for the SentAI CRE workflow.
// Includes configuration validation, xAI Grok API types,
// Polymarket market types, and Chainlink Data Feed types.

import { z } from "zod";
import { ETH_ADDRESS_REGEX } from "./constants";

/*********************************
 * Configuration Schemas
 *********************************/

/**
 * Schema for the workflow configuration file (config.staging.json).
 * Validates cron schedule, Grok model, contract addresses, and data feed mappings.
 */
export const configSchema = z.object({
	schedule: z.string().min(1, "Cron schedule is required"),
	grokModel: z.string().min(1, "Grok model name is required"),
	loggerAddress: z
		.string()
		.regex(ETH_ADDRESS_REGEX, "loggerAddress must be a 0x-prefixed 20-byte hex"),
	chainSelectorName: z.string().min(1, "Chain selector name is required"),
	gasLimit: z
		.string()
		.regex(/^\d+$/, "gasLimit must be a numeric string")
		.refine((val) => Number(val) > 0, { message: "gasLimit must be greater than 0" }),
	dataFeeds: z.record(
		z.string().min(1),
		z.string().regex(ETH_ADDRESS_REGEX, "Data feed proxy must be a valid Ethereum address"),
	),
});

/** Type inferred from the validated config schema. */
export type Config = z.infer<typeof configSchema>;

/*********************************
 * Grok Decision Schema
 *********************************/

/**
 * Schema for validating Grok's structured JSON response.
 * Sentiment score follows the Crypto Fear & Greed Index (0-100):
 *   0-24 = Extreme Fear, 25-49 = Fear, 50 = Neutral,
 *   51-74 = Greed, 75-100 = Extreme Greed
 * Reference: https://www.binance.com/en/square/fear-and-greed-index
 *
 * See https://docs.x.ai/developers/model-capabilities/text/structured-outputs for details
 */
export const GrokDecisionItemSchema = z.object({
	sentiment_score: z.number().int().min(0).max(100),
	confidence: z.number().int().min(0).max(100),
	action: z.enum(["HOLD", "BET_YES", "BET_NO"]),
	market_slug: z.string().min(1, "market_slug is required"),
	size_usdc: z.number().min(0).max(50),
	suggested_price: z.number().min(0.01).max(0.99),
	reason: z.string().min(1, "reason is required"),
});

/** Validated decision type inferred from the Grok schema. */
export type GrokDecision = z.infer<typeof GrokDecisionItemSchema>;

/** Wrap items with an array */
export const GrokDecisionsSchema = z.array(GrokDecisionItemSchema);

/** Validated decisions array inferred type */
export type GrokDecisions = z.infer<typeof GrokDecisionsSchema>;

/*********************************
 * xAI Grok API Types
 *********************************/

/**
 * Response wrapper from the Grok HTTP request.
 * Contains both the parsed result and raw response metadata.
 */
export type GrokResponse = {
	statusCode: number; // HTTP status from xAI API
	content: string; // The structured JSON string from Grok (matches GrokDecisionSchema)
	model: string; // The model used, e.g. "grok-4-1-fast-reasoning"
	id: string; // Unique response ID from xAI
};

/**
 * A single message in the xAI Responses API input array.
 * System prompt and user prompt are both passed as input messages.
 * Note: `instructions` param is NOT supported — use input messages instead.
 * See: https://docs.x.ai/developers/model-capabilities/text/generate-text
 */
export interface XAIInputMessage {
	role: "system" | "user";
	content: string;
}

/**
 * Request payload structure for xAI Responses API (POST /v1/responses).
 * See: https://docs.x.ai/developers/model-capabilities/text/structured-outputs
 */
export interface XAIResponsesRequest {
	model: string;
	input: XAIInputMessage[];
	tools: { type: string; from_date?: string }[];
	text: {
		format: {
			type: "json_schema";
			name: string;
			schema: Record<string, unknown>;
			strict: boolean;
		};
	};
	store: boolean; // false — we don't need stateful conversations
}

/**
 * Response structure from xAI Responses API.
 * The structured output is in output[].content[].text for message items.
 * See: https://docs.x.ai/developers/model-capabilities/text/structured-outputs
 */
export interface XAIResponsesApiResponse {
	id: string;
	model: string;
	output: {
		type: string; // "message", "reasoning", "tool_call", etc.
		content?: {
			type: string; // "output_text"
			text: string; // The structured JSON string
		}[];
	}[];
}

/*********************************
 * Polymarket Types
 *********************************/

/**
 * Polymarket market data from the Gamma API.
 * Contains the fields we need for sentiment analysis and order placement.
 * Source: GET https://gamma-api.polymarket.com/markets
 */
export interface PolymarketMarket {
	market_slug: string; // URL slug for the market
	question: string; // The market question (UNTRUSTED — prompt injection risk)
	yesPrice: string; // Current YES token price (e.g. "0.65")
	noPrice: string; // Current NO token price (e.g. "0.35")
	endDate: string; // The end date of the market
	eventStartTime: string; // The start time of the market
}

/*********************************
 * Chainlink Data Feed Types
 *********************************/

/**
 * Result from Chainlink AggregatorV3Interface.latestRoundData().
 * Used for on-chain price reads via EVMClient.
 * Answer has 8 decimals (e.g., 9876543210000 = $98,765.43210000).
 */
export interface ChainlinkPriceData {
	roundId: bigint;
	answer: bigint; // Price with 8 decimals
	startedAt: bigint;
	updatedAt: bigint;
	answeredInRound: bigint;
}
