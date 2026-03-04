// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

contract SentAILogger is ReceiverTemplate {
	event SentAIDecision(
		uint256 indexed timestamp,
		uint8 sentimentScore,
		uint8 confidence,
		string action,
		string marketSlug,
		uint256 sizeUsdc,
		uint256 suggestedPrice
	);

	mapping(bytes32 => bool) public processedReports;

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

		emit SentAIDecision(
			block.timestamp,
			sentimentScore,
			confidence,
			action,
			marketSlug,
			sizeUsdc,
			suggestedPrice
		);
	}
}
