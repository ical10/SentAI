  // SPDX-License-Identifier: MIT
  pragma solidity ^0.8.28;

  import "forge-std/Script.sol";
  import "forge-std/console2.sol";
  import {SentAILogger} from "../src/SentAILogger.sol";

  contract DeploySentAILogger is Script {
      function run() external returns (SentAILogger logger) {
          address forwarder = address(0x15fC6ae953E024d975e77382eEeC56A9101f9F88); // ETH Sepolia CRE Simulation Forwarder
          uint256 pk = vm.envUint("PRIVATE_KEY");

          vm.startBroadcast(pk);
          logger = new SentAILogger(forwarder);
          vm.stopBroadcast();

          console2.log("SentAILogger deployed at:", address(logger));
          console2.log("CRE Forwarder:", forwarder);
      }
  }
