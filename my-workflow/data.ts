// Polymarket-first data fetchers compatible with CRE workflow.
import {
	EVMClient,
	LAST_FINALIZED_BLOCK_NUMBER,
	consensusIdenticalAggregation,
	cre,
	encodeCallMsg,
	getNetwork,
	ok,
	type HTTPSendRequester,
	type Runtime,
} from "@chainlink/cre-sdk";

import { type Config, type PolymarketMarket } from "./types.ts";
import { AggregatorV3Interface } from "../contracts/abi";
import {
	type Address,
	bytesToHex,
	decodeFunctionResult,
	encodeFunctionData,
	zeroAddress,
} from "viem";

interface GammaMarketRaw {
	slug: string;
	question: string;
	outcomePrices: string | string[]; // may arrive as JSON string or actually array
	active: boolean;
	closed: boolean;
}

// Fetch only supported tokens on Polymarket
const SUPPORTED_TOKENS = ["btc", "eth"] as const;

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
};

/**
 * Builds and sends a Polymarket Gamma API request via CRE HTTPSendRequester.
 *
 * Returns a closure matching the HTTPClient.sendRequest() callback signature:
 *   (sendRequester: HTTPSendRequester, config: Config) => PolymarketMarket[]
 *
 */
const FetchMarkets =
	(nowInMs: number) =>
	(sendRequester: HTTPSendRequester, _config: Config): PolymarketMarket[] => {
		// 1. Get current 15-min window timestamp using consensus-safe timestamp
		// TODO: convert Math.floor(...) into a helper function
		const timestamp = Math.floor(nowInMs / 1000 / 900) * 900;

		// 2. Build slugs for each token
		const slugs = SUPPORTED_TOKENS.map((token) => `${token}-updown-15m-${timestamp}`);

		// 3. Fetch markets by slug (comma-separated)
		const resp = sendRequester
			.sendRequest({
				method: "GET",
				url: `https://gamma-api.polymarket.com/markets?slug=${slugs.join(",")}&active=true&closed=false`,
			})
			.result();

		const bodyText = new TextDecoder().decode(resp.body);

		if (!ok(resp)) {
			throw new Error(
				`Polymarket HTTP request failed with status: ${resp.statusCode}. Error: ${bodyText}`,
			);
		}

		const rawMarkets: GammaMarketRaw[] = JSON.parse(bodyText);

		// 4. Parse rawMarkets into validated market data
		//   Validated data:
		//    - Is a crypto market through slug-based fetch calls
		//    - Prices are properly parsed to follow expected results
		const markets: PolymarketMarket[] = rawMarkets.map((m) => {
			const [yesPrice, noPrice] = parseOutcomePrices(m.outcomePrices);
			return {
				market_slug: m.slug,
				question: m.question,
				yesPrice,
				noPrice,
			};
		});

		return markets;
	};

/**
 * Fetch currently active markets on Polymarket for xAI Responses inputs.
 * Uses Polymarket Gamma API to get active markets and requires consensus across CRE nodes.
 * @param runtime - CRE runtime instance with config and secrets
 * @returns Polymarket Gamma API response for currently active markets
 */
export const fetchActiveMarkets = (runtime: Runtime<Config>): PolymarketMarket[] => {
	const httpClient = new cre.capabilities.HTTPClient();
	const nowInMs = runtime.now().getTime();

	const result: PolymarketMarket[] = httpClient
		.sendRequest(runtime, FetchMarkets(
				nowInMs,
			), consensusIdenticalAggregation<PolymarketMarket[]>())(runtime.config)
		.result();

	return result;
};

/**
 * Fetch prices for a list of supported tokens.
 *
 * @param runtime - CRE runtime instance with config and secrets
 * @param tokens - an array of supported tokens
 * @returns price for each token in USD denomination
 */
export const fetchPrices = (runtime: Runtime<Config>, tokens: string[]): Record<string, bigint> => {
	const config = runtime.config;
	const network = getNetwork({
		chainFamily: "evm",
		chainSelectorName: config.chainSelectorName,
		isTestnet: true,
	});

	if (!network) {
		throw new Error(`Network not found for chain selector: ${config.chainSelectorName}`);
	}

	const evmClient = new EVMClient(network.chainSelector.selector);
	const prices: Record<string, bigint> = {};

	// Read feeds sequentially in sorted order for determinism
	for (const token of tokens.sort()) {
		const proxyAddress = config.dataFeeds[token];
		if (!proxyAddress) {
			runtime.log(`No data feed configured for ${token} - skipping`);
			continue;
		}

		const callData = encodeFunctionData({
			abi: AggregatorV3Interface,
			functionName: "latestRoundData",
		});

		const contractCall = evmClient
			.callContract(runtime, {
				call: encodeCallMsg({
					from: zeroAddress,
					to: proxyAddress as Address,
					data: callData,
				}),
				blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
			})
			.result();

		const [_roundId, answer] = decodeFunctionResult({
			abi: AggregatorV3Interface,
			functionName: "latestRoundData",
			data: bytesToHex(contractCall.data),
		});

		prices[token] = answer;
		runtime.log(`${token} in USD: $${(Number(answer) / 1e8).toFixed(2)}`);
	}

	return prices;
};
