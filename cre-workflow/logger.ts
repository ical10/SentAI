import {
	EVMClient,
	TxStatus,
	bytesToHex,
	getNetwork,
	hexToBase64,
	type Runtime,
} from "@chainlink/cre-sdk";
import { type Config, type GrokDecision } from "./types";
import { encodeAbiParameters, parseAbiParameters, parseUnits } from "viem";
import { SUGGESTED_PRICE_DECIMAL, USDC_DECIMAL } from "./constants";

/**
 * Logs market decision on-chain.
 *
 * @param runtime - CRE runtime instance with config and secrets
 * @param decision - consensus-safe decision made by xAI and secured by CRE
 */
export const logDecision = (runtime: Runtime<Config>, decision: GrokDecision) => {
	// 1. Setup network and client
	const network = getNetwork({
		chainFamily: "evm",
		chainSelectorName: runtime.config.chainSelectorName,
		isTestnet: runtime.config.isTestnet,
	});

	if (!network) {
		throw new Error(`Network not found`);
	}

	const evmClient = new EVMClient(network.chainSelector.selector);

	// 2. ABI-encode decision values
	const { sentiment_score, confidence, action, market_slug, size_usdc, suggested_price } =
		decision;
	const sizeUsdc = parseUnits(size_usdc.toString(), USDC_DECIMAL);
	const suggestedPrice = parseUnits(suggested_price.toString(), SUGGESTED_PRICE_DECIMAL);
	const reportData = encodeAbiParameters(
		parseAbiParameters("uint8, uint8, string, string, uint256, uint256"),
		[sentiment_score, confidence, action, market_slug, sizeUsdc, suggestedPrice],
	);

	// 3. Generate the signed report
	const reportResponse = runtime
		.report({
			encodedPayload: hexToBase64(reportData),
			encoderName: "evm",
			signingAlgo: "ecdsa",
			hashingAlgo: "keccak256",
		})
		.result();

	// 4. Submit on-chain
	const writeResult = evmClient
		.writeReport(runtime, {
			receiver: runtime.config.loggerAddress,
			report: reportResponse,
			gasConfig: {
				gasLimit: runtime.config.gasLimit,
			},
		})
		.result();

	// 5. Check the transaction status
	if (writeResult.txStatus === TxStatus.SUCCESS) {
		const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
		runtime.log(`Transaction successful: ${txHash}`);
		return txHash;
	}

	throw new Error(`Transaction failed with status: ${writeResult.txStatus}`);
};
