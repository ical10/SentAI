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

interface MarketsResponse {
	markets: PolymarketMarket[];
}


/**
 * Builds and sends a Polymarket Gamma API request via CRE HTTPSendRequester.
 *
 * Returns a closure matching the HTTPClient.sendRequest() callback signature:
 *   (sendRequester: HTTPSendRequester, config: Config) => MarketsResponse
 *
 */
const FetchMarkets = (sendRequester: HTTPSendRequester, _config: Config): MarketsResponse => {
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
		.filter((m) => m.active && !m.closed) // TODO: need to check if the question is contains keyword related crypto tokens
		.slice(0, MAX_MARKETS)
		.map((m) => {
			//TODO: need to parse outcomePrices due to its type
			// and pass down as returned object
			return {
				market_slug: m.slug,
				question: m.question,
			};
		})
}

/**
 * Fetch currently active markets on Polymarket for xAI Responses inputs.
 * Uses Polymarket Gamma API to get active markets and requires consensus across CRE nodes.
 * @param runtime - CRE runtime instance with config and secrets
 * @returns Polymarket Gamma API response for currently active markets
 */
export const fetchActiveMarkets = (runtime: Runtime<Config>): PolymarketMarket[] => {
	const httpClient = new cre.capabilities.HTTPClient();

	const result: MarketsResponse = httpClient
		.sendRequest(runtime, FetchMarkets, consensusIdenticalAggregation<MarketsResponse>())(runtime.config)
		.result();
}
