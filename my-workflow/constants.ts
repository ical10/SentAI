// Shared constants for the SentAI CRE workflow.

/** Regex pattern for validating 0x-prefixed Ethereum addresses (20 bytes). */
export const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/u;

/** Maximum number of Polymarket markets to pass to Grok per cycle.
 *  Limits prompt size to control token usage and API costs. */
export const MAX_MARKETS = 3;
