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

import { ChainlinkPriceData, type Config, type PolymarketMarket } from "./types";
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
	endDate: string;
	eventStartTime: string;
	resolutionSource: string;
}

// Fetch only supported tokens on Polymarket
const SUPPORTED_TOKENS = ["btc", "eth"] as const;

interface CallGetRoundDataReturnProps {
	roundId: bigint;
	answer: bigint;
	updatedAt: bigint;
}

/**
 * A wrapper function that encodes/decodes EVM call to get round data
 *
 * @param evmClient - EVM client instance to call contract
 * @param runtime - CRE runtime instance with config and secrets
 * @param proxyAddress - address of proxy contract for AggregatorV3 contract
 * @param roundId - (optional) roundId for the queried round data
 * @returns roundId, answer, and updatedAt from the queried round data
 */
export const callGetRoundData = (
	evmClient: EVMClient,
	runtime: Runtime<Config>,
	proxyAddress: Address,
	roundId?: bigint,
): CallGetRoundDataReturnProps => {
	const callData =
		roundId !== undefined
			? encodeFunctionData({
					abi: AggregatorV3Interface,
					functionName: "getRoundData",
					args: [roundId],
				})
			: encodeFunctionData({
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

	const [_roundId, answer, _startedAt, updatedAt] =
		roundId !== undefined
			? decodeFunctionResult({
					abi: AggregatorV3Interface,
					functionName: "getRoundData",
					data: bytesToHex(contractCall.data),
				})
			: decodeFunctionResult({
					abi: AggregatorV3Interface,
					functionName: "latestRoundData",
					data: bytesToHex(contractCall.data),
				});

	return {
		roundId: _roundId,
		answer,
		updatedAt,
	};
};

/**
 * Binary search helper to get the round at a given timestamp.
 *
 * @param evmClient - EVM client instance to call contract
 * @param runtime - CRE runtime instance with config and secrets
 * @param proxyAddress - address of proxy contract for AggregatorV3 contract
 * @param targetTimestamp - desired timestamp to match the most probable round
 * @returns bestAnswer as bigint
 */
const findRoundAtTimestamp = (
	evmClient: EVMClient,
	runtime: Runtime<Config>,
	proxyAddress: Address,
	targetTimestamp: number,
): bigint => {
	// 1. Get the latest round as upper bound
	// Chainlink roundIds encode phaseId in upper bits: roundId = (phaseId << 64) | aggregatorRoundId
	// Search only within the current phase to avoid reverts on invalid roundIds
	const latest = callGetRoundData(evmClient, runtime, proxyAddress);
	const phaseId = latest.roundId >> 64n;
	const phaseBase = phaseId << 64n;
	const latestAggRoundId = latest.roundId - phaseBase;

	// If target is in the future or very recent, just return latest
	const latestTs = Number(latest.updatedAt);
	if (targetTimestamp >= latestTs) {
		return latest.answer;
	}

	// Estimate lo by assuming ~60s average between rounds (conservative)
	// This narrows the search range to stay within CRE's 15 chain read limit
	const secondsBack = BigInt(latestTs - targetTimestamp);
	const estimatedRoundsBack = secondsBack / 60n + 10n; // +10 buffer
	const estimatedLo =
		latestAggRoundId > estimatedRoundsBack ? latestAggRoundId - estimatedRoundsBack : 1n;

	let lo = phaseBase | estimatedLo;
	let hi = latest.roundId;
	let bestAnswer = latest.answer;

	// Cap iterations to avoid exceeding CRE chain read limits
	const MAX_ITERATIONS = 5;
	let iterations = 0;

	while (lo <= hi && iterations < MAX_ITERATIONS) {
		iterations++;
		const mid = lo + (hi - lo) / 2n;
		const round = callGetRoundData(evmClient, runtime, proxyAddress, mid);
		const roundUpdated = Number(round.updatedAt);

		if (roundUpdated <= targetTimestamp) {
			bestAnswer = round.answer;
			lo = mid + 1n;
		} else {
			hi = mid - 1n;
		}
	}

	return bestAnswer;
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
		// 1. Get current 5-min and 15-min window timestamp using consensus-safe timestamp
		// TODO: convert Math.floor(...) into a helper function
		const timestamp5m = Math.floor(nowInMs / 1000 / 300) * 300;
		const timestamp15m = Math.floor(nowInMs / 1000 / 900) * 900;

		// 2. Build slugs for each token
		const slugs = SUPPORTED_TOKENS.flatMap((token) => [
			`${token}-updown-5m-${timestamp5m}`,
			`${token}-updown-15m-${timestamp15m}`,
		]);

		// 3. Fetch markets by slug (comma-separated)
		const resp = sendRequester
			.sendRequest({
				method: "GET",
				url: `https://gamma-api.polymarket.com/markets?${slugs.map((s) => `slug=${s}`).join("&")}&active=true&closed=false`,
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
				endDate: m.endDate,
				eventStartTime: m.eventStartTime,
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

	runtime.log(`Found ${result.length} active Polymarket markets`);
	for (const m of result) {
		runtime.log(
			`[Market] ${m.market_slug} | YES: ${m.yesPrice} | NO: ${m.noPrice} | Window ends: ${new Date(m.endDate).toUTCString()} | Resolution: Chainlink Data Feed`,
		);
	}

	return result;
};

/**
 * Fetch prices for a list of supported tokens from Chainlink Data Feeds (AggregatorV3Interface)
 *
 * @param runtime - CRE runtime instance with config and secrets
 * @param tokens - an array of supported tokens
 * @returns price for each token in USD denomination
 */
export const fetchPrices = (
	runtime: Runtime<Config>,
	tokens: string[],
	targetTimestamps: Record<string, number>,
): Record<string, bigint> => {
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

		const targetTs = targetTimestamps[token];
		if (targetTs === undefined) {
			runtime.log(`No target timestamp for ${token} - skipping`);
			continue;
		}

		const answer = findRoundAtTimestamp(evmClient, runtime, proxyAddress as Address, targetTs);
		prices[token] = answer;
		runtime.log(`[Chainlink Data Feed] ${token} in USD: $${(Number(answer) / 1e8).toFixed(2)}`);
	}

	return prices;
};

/**
 * Extracts token name from slug.
 *
 * @param markets - Trusted market metadata (slugs, YES/NO prices)
 * @returns an array of extracted token names (sorted)
 */
export const extractTokens = (markets: PolymarketMarket[]): string[] => {
	const tokens = new Set<string>();

	for (const market of markets) {
		const token = market.market_slug.split("-")[0].toUpperCase();
		if (token) {
			tokens.add(token);
		}
	}

	return Array.from(tokens).sort();
};
