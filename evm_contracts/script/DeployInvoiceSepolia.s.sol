// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {InvoiceContract, IPermit2, IUniversalRouter} from "../src/InvoiceContract.sol";

/// @notice Deploy InvoiceContract to Sepolia.
///         MERCHANT=0x... forge script script/DeployInvoiceSepolia.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $PRIVATE_KEY
contract DeployInvoiceSepolia is Script {
    // https://docs.uniswap.org/contracts/v4/deployments  (Sepolia, chain id 11155111)
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant UNIVERSAL_ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;

    function run() external {
        address merchant = vm.envAddress("MERCHANT");

        vm.startBroadcast();
        InvoiceContract invoice = new InvoiceContract(
            merchant,
            IUniversalRouter(UNIVERSAL_ROUTER),
            IPermit2(PERMIT2)
        );
        vm.stopBroadcast();

        console2.log("InvoiceContract", address(invoice));
        console2.log("merchant", merchant);
        console2.log("permit2", PERMIT2);
        console2.log("universalRouter", UNIVERSAL_ROUTER);
    }
}