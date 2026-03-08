import { Runner, CronCapability, handler, Runtime, CronPayload } from "@chainlink/cre-sdk";
import { configSchema, Config, GrokDecisionsSchema } from "./types";
import { fetchActiveMarkets, extractTokens, fetchPrices } from "./data";
import { askGrok } from "./grok";
import { logDecision } from "./logger";
import { CHAINLINK_PRICE_DECIMALS } from "./constants";

const onCronTrigger = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) {
		throw new Error("Scheduled execution time is required");
	}

	runtime.log("Running CronTrigger");

	const markets = fetchActiveMarkets(runtime);
	if (!markets.length) {
		runtime.log("No active crypto markets - skipping cycle");
		return JSON.stringify({ action: "HOLD", reason: "no_active_markets" });
	}

	const tokens = extractTokens(markets);
	// Build target timestamps per token for historical price lookup.
	// Uses the earliest timestamp per token (i.e., the 15m market start) when multiple
	// timeframes exist. This means the 5m market will use the 15m start price — off by
	// a few minutes, but avoids extra chain reads that would exceed CRE's 15 call limit.
	const targetTimestamps: Record<string, number> = {};
	for (const m of markets) {
		const token = m.market_slug.split("-")[0].toUpperCase();
		const raw = m.market_slug.split("-").pop();
		const parsed = raw ? parseInt(raw) : NaN;
		const ts = Number.isNaN(parsed) ? Math.floor(runtime.now().getTime() / 1000) : parsed;
		targetTimestamps[token] = Math.min(targetTimestamps[token] ?? ts, ts);
	}
	const prices = fetchPrices(runtime, tokens, targetTimestamps);

	for (const m of markets) {
		const token = m.market_slug.split("-")[0].toUpperCase();
		const price = prices[token];
		const priceStr = price ? `$${(Number(price) / CHAINLINK_PRICE_DECIMALS).toFixed(2)}` : "N/A";
		const ts = targetTimestamps[token];
		const tsStr = new Date(ts * 1000).toUTCString();
		runtime.log(
			`[Price to beat] ${m.market_slug} | ${token}/USD: ${priceStr} at ${tsStr} (Chainlink Data Feed at market creation)`,
		);
	}

	const questions = markets.map((m) => m.question);
	const result = askGrok(runtime, markets, prices, questions);

	let decisions;
	try {
		const parsedContent = JSON.parse(result.content);
		decisions = GrokDecisionsSchema.parse(parsedContent);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		runtime.log(`Failed to parse Grok response: ${message}`);
		return JSON.stringify({ action: "HOLD", reason: "parse_error" });
	}

	for (const decision of decisions) {
		runtime.log(
			`[Decision] ${decision.action} on ${decision.market_slug} | Confidence: ${decision.confidence}% | Size: $${decision.size_usdc} | Reason: ${decision.reason}`,
		);

		if (decision.action !== "HOLD") {
			logDecision(runtime, decision);
		}
	}

	return JSON.stringify(decisions);
};

const initWorkflow = (config: Config) => {
	const cronTrigger = new CronCapability();

	return [
		handler(
			cronTrigger.trigger({
				schedule: config.schedule,
			}),
			onCronTrigger,
		),
	];
};

export async function main() {
	const runner = await Runner.newRunner<Config>({
		configSchema,
	});
	await runner.run(initWorkflow);
}
