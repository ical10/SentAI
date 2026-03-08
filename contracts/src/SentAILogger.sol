// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

contract SentAILogger is ReceiverTemplate {
	struct Decision {
		uint256 timestamp;
		uint8 sentimentScore;
		uint8 confidence;
		string action;
		string marketSlug;
		uint256 sizeUsdc;
		uint256 suggestedPrice;
	}

	uint256 public decisionCount;
	mapping(uint256 => Decision) private decisions;
	mapping(bytes32 => uint256[]) private decisionsBySlug; // keccak256(slug) -> decision IDs

	event SentAIDecision(
		uint256 indexed id, // cross-reference with getDecision(id)
		uint256 indexed timestamp,
		uint8 sentimentScore,
		uint8 confidence,
		string action,
		string marketSlug,
		uint256 sizeUsdc,
		uint256 suggestedPrice
	);

	mapping(bytes32 => bool) private processedReports;

	constructor(address forwarder) ReceiverTemplate(forwarder) {}

	function _processReport(bytes calldata report) internal override {
		// 1. Check if the report has not already been processed yet
		bytes32 reportHash = keccak256(report);
		require(!processedReports[reportHash], "Report already processed");

		// 2. Write to chain that the report is processed
		processedReports[reportHash] = true;

		// 3. ABI-decode report to be sent as a human-readable event
		(
			uint8 sentimentScore,
			uint8 confidence,
			string memory action,
			string memory marketSlug,
			uint256 sizeUsdc,
			uint256 suggestedPrice
		) = abi.decode(report, (uint8, uint8, string, string, uint256, uint256));

		uint256 id = decisionCount;
		decisions[id] = Decision(
			block.timestamp,
			sentimentScore,
			confidence,
			action,
			marketSlug,
			sizeUsdc,
			suggestedPrice
		);
		decisionsBySlug[keccak256(bytes(marketSlug))].push(id);
		decisionCount = id + 1;

		emit SentAIDecision(
			id,
			block.timestamp,
			sentimentScore,
			confidence,
			action,
			marketSlug,
			sizeUsdc,
			suggestedPrice
		);
	}

	function getDecision(uint256 id) external view returns (Decision memory) {
		require(id < decisionCount, "Decision does not exist");
		return decisions[id];
	}

	function getDecisionsBySlug(string calldata slug) external view returns (uint256[] memory) {
		bytes32 slugHash = keccak256(bytes(slug));
		return decisionsBySlug[slugHash];
	}

	function isReportProcessed(bytes32 reportHash) external view returns (bool) {
		return processedReports[reportHash];
	}
}
