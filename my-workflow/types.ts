import { z } from "zod"

// config.staging.json should match this schema
export const configSchema = z.object({
	schedule: z.string(),
	grokModel: z.string(),
	loggerAddress: z.string(),
	chainSelectorName: z.string(),
	gasLimit: z.string(),
	dataFeeds: z.record(z.string(), z.string()),
});

// Grok structured output schema
// See https://docs.x.ai/developers/model-capabilities/text/structured-outputs#structured-outputs for details
export const GrokDecisionSchema = z.object({
	sentiment_score: z.number().int().min(-100).max(100),
	confidence: z.number().int().min(0).max(100),
	action: z.enum(["HOLD", "BET_YES", "BET_NO"]),
	market_slug: z.string(),
	size_usdc: z.number(),
	suggested_price: z.number().min(0.01).max(0.99),
	reason: z.string(),
})
