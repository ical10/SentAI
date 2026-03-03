// Polymarket-first data fetchers compatible with CRE workflow.
import {
	consensusIdenticalAggregation,
	cre,
	ok,
	type HTTPSendRequester,
	type Runtime,
} from "@chainlink/cre-sdk";
import { type Config, type PolymarketMarket } from "./types.ts";
import { MAX_MARKETS } from "./constants.ts";

interface GammaMarketRaw {
	slug: string;
	question: string;
	outcomePrices: string | string[]; // may arrive as JSON string or actually array
	active: boolean;
	closed: boolean;
}

// We define token aliases using Map
// for faster and deterministic lookups
const TOKEN_ALIASES = new Map<string, string>([
	["BTC", "BTC"],
	["BITCOIN", "BTC"],
	["ETH", "ETH"],
	["ETHEREUM", "ETH"],
]);

/**
 * Checks if a question includes a token alias or not,
 * which might indicates if it is crypto market-related question.
 *
 * @param question - UNTRUSTED market question
 * @returns a boolean to indicate if it's a crypto market question
 */
const isCryptoMarket = (question: string): boolean => {
	const upperCased = question.toUpperCase();
	for (const alias of TOKEN_ALIASES.keys()) {
		if (upperCased.includes(alias)) return true;
	}
	return false;
};

/**
 * Handles parsing of outcomePrice.
 *
 * @param raw - Raw value of outcomePrice
 * @returns parsed prices in the form of [yesPrice, noPrice]
 *
 */
const parseOutcomePrices = (raw: string | string[]): [string, string] => {
	let prices: string[];
	const defaultPrices: [string, string] = ["0.50", "0.50"];

	if (Array.isArray(raw)) {
		prices = raw;
	} else if (typeof raw === "string") {
		try {
			prices = JSON.parse(raw);
		} catch {
			return defaultPrices;
		}
	} else {
		return defaultPrices;
	}

	return [prices[0] ?? "0.50", prices[1] ?? "0.50"];
}


/**
 * Builds and sends a Polymarket Gamma API request via CRE HTTPSendRequester.
 *
 * Returns a closure matching the HTTPClient.sendRequest() callback signature:
 *   (sendRequester: HTTPSendRequester, config: Config) => PolymarketMarket[]
 *
 */
const FetchMarkets = (sendRequester: HTTPSendRequester, _config: Config): PolymarketMarket[] => {
	// 1. GET Polymarket's active markets with a conservative limit=3
	// to avoid filling up xAI's context
	const resp = sendRequester
		.sendRequest({
			method: "GET",
			url: `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${MAX_MARKETS}`
		})
		.result();

	const bodyText = new TextDecoder().decode(resp.body);

	if (!ok(resp)) {
		throw new Error(`Polymarket HTTP request failed with status: ${resp.statusCode}. Error: ${bodyText}`);
	}

	const rawMarkets: GammaMarketRaw[] = JSON.parse(bodyText);

	// 2. Parse rawMarkets into validated market data
	//   Validated data:
	//    - Only active markets and not closed
	//    - Is a crypto market using  isCryptoMarket
	//    - Only the first three markets
	//    - Prices are properly parsed to follow expected results
	const markets: PolymarketMarket[] = rawMarkets
		.filter((m) => m.active && !m.closed && isCryptoMarket(m.question))
		.slice(0, MAX_MARKETS)
		.map((m) => {
			const [yesPrice, noPrice] = parseOutcomePrices(m.outcomePrices);
			return {
				market_slug: m.slug,
				question: m.question,
				yesPrice,
				noPrice,
			};
		});

	return markets;
}

/**
 * Fetch currently active markets on Polymarket for xAI Responses inputs.
 * Uses Polymarket Gamma API to get active markets and requires consensus across CRE nodes.
 * @param runtime - CRE runtime instance with config and secrets
 * @returns Polymarket Gamma API response for currently active markets
 */
export const fetchActiveMarkets = (runtime: Runtime<Config>): PolymarketMarket[] => {
	const httpClient = new cre.capabilities.HTTPClient();

	const result: PolymarketMarket[] = httpClient
		.sendRequest(runtime, FetchMarkets, consensusIdenticalAggregation<PolymarketMarket[]>())(runtime.config)
		.result();

	return result;
}
