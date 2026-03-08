// Shared constants for the SentAI CRE workflow.

/** Regex pattern for validating 0x-prefixed Ethereum addresses (20 bytes). */
export const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/u;

/** Maximum number of Polymarket markets to pass to Grok per cycle.
 *  Limits prompt size to control token usage and API costs. */
export const MAX_MARKETS = 3;

export const USDC_DECIMAL = 6;
export const SUGGESTED_PRICE_DECIMAL = 9;

/** Chainlink Data Feed answers use 8 decimals (e.g., 9876543210000 = $98,765.43). */
export const CHAINLINK_PRICE_DECIMALS = 1e8;

/** 5-minute window size in seconds for Polymarket slug generation. */
export const WINDOW_5M = 300;

/** 15-minute window size in seconds for Polymarket slug generation. */
export const WINDOW_15M = 900;
