import { Runner, CronCapability, handler, Runtime, CronPayload } from "@chainlink/cre-sdk";
import { configSchema, Config, GrokDecisionSchema } from "./types";
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

	const questions = markets.map((m) => m.question);
	const result = askGrok(runtime, markets, prices, questions);
	const parsedContent = JSON.parse(result.content);
	const decision = GrokDecisionSchema.parse(parsedContent);

	if (decision.action !== "HOLD") {
		logDecision(runtime, decision);
	}

	return JSON.stringify(decision);
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
