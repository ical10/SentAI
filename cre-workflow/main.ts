import { Runner, CronCapability, handler, Runtime, CronPayload } from "@chainlink/cre-sdk";
import { configSchema, Config, GrokDecisionsSchema } from "./types";
import { fetchActiveMarkets, extractTokens, fetchPrices } from "./data";
import { askGrok } from "./grok";
import { logDecision } from "./logger";

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
	const prices = fetchPrices(runtime, tokens);

	for (const m of markets) {
		const token = m.market_slug.split("-")[0].toUpperCase();
		const price = prices[token];
		const priceStr = price ? `$${(Number(price) / 1e8).toFixed(2)}` : "N/A";
		runtime.log(
			`[Price to beat] ${m.market_slug} | Current ${token}/USD: ${priceStr} (Chainlink Data Feed at execution time)`,
		);
	}

	const questions = markets.map((m) => m.question);
	const result = askGrok(runtime, markets, prices, questions);
	const parsedContent = JSON.parse(result.content);
	const decisions = GrokDecisionsSchema.parse(parsedContent);

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
