// Type definitions and schemas for the SentAI CRE workflow.
// Includes configuration validation, xAI Grok API types,
// Polymarket market types, and Chainlink Data Feed types.

import { z } from "zod"
import { ETH_ADDRESS_REGEX } from "./constants.ts"

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
		.refine(val => Number(val) > 0, { message: "gasLimit must be greater than 0" }),
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
export const GrokDecisionSchema = z.object({
	sentiment_score: z.number().int().min(0).max(100),
	confidence: z.number().int().min(0).max(100),
	action: z.enum(["HOLD", "BET_YES", "BET_NO"]),
	market_slug: z.string(),
	size_usdc: z.number().min(0).max(50),
	suggested_price: z.number().min(0.01).max(0.99),
	reason: z.string().min(1, "reason is required"),
}).superRefine((data, ctx) => {
	if (data.action !== "HOLD" && data.market_slug.length === 0) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: "market_slug is required when action is BET_YES or BET_NO",
			path: ["market_slug"],
		});
	}
})

/** Validated decision type inferred from the Grok schema. */
export type GrokDecision = z.infer<typeof GrokDecisionSchema>;

/*********************************
 * xAI Grok API Types
 *********************************/

/**
 * Response wrapper from the Grok HTTP request.
 * Contains both the parsed result and raw response metadata.
 */
export type GrokResponse = {
	statusCode: number; // HTTP status from xAI API
	grokResponse: string; // The structured JSON string from Grok (matches GrokDecisionSchema)
	model: string; // The model used, e.g. "grok-4-1-fast-reasoning"
	id: string; // Unique response ID from xAI
}

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

