// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InvoiceContract, IPermit2, IUniversalRouter} from "../src/InvoiceContract.sol";

/// @notice Deploy InvoiceContract to local Anvil and create three ETH invoices.
///         The broadcaster must be the merchant (Anvil account 0).
///         Before that, payer 1 swaps ETH for USDC, USDT, and JPYC on the forked
///         mainnet Uniswap v4 pools.
contract SeedLocalInvoices is Script {
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// @dev Mainnet Universal Router, present on the Anvil mainnet fork.
    ///      Stored on InvoiceContract so payInvoiceWithRouterSwap can settle ETH invoices.
    IUniversalRouter constant MAINNET_UNIVERSAL_ROUTER =
        IUniversalRouter(0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af);

    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant JPYC = 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29;

    address constant MERCHANT = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant PAYER_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address constant PAYER_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    address constant PAYER_3 = 0x90F79bf6EB2c4f870365E785982E1f101E93b906;
    /// @dev Anvil account 1. Public development key.
    uint256 constant PAYER_1_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    /// @dev CREATE2 salt. Same deployer, bytecode, and constructor args keep the address fixed.
    bytes32 constant INVOICE_SALT = keccak256("InvoiceContract.v1");

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    function run() external {
        vm.startBroadcast(PAYER_1_KEY);
        // ETH is currency0 in each of these pools, so zeroForOne swaps ETH for the token.
        // Caps are far above the spot cost so the exact-output swap can fill.
        _swapEthForExactOut(USDC, 500, 10, 1000 * 10 ** 6, 2 ether);
        _swapEthForExactOut(USDT, 500, 10, 1000 * 10 ** 6, 2 ether);
        _swapEthForExactOut(JPYC, 3000, 60, 10000 ether, 1 ether);
        vm.stopBroadcast();

        console2.log("payer1 USDC", IERC20(USDC).balanceOf(PAYER_1));
        console2.log("payer1 USDT", IERC20(USDT).balanceOf(PAYER_1));
        console2.log("payer1 JPYC", IERC20(JPYC).balanceOf(PAYER_1));

        vm.startBroadcast();

        address predicted = _invoiceAddress();
        InvoiceContract invoice;
        if (predicted.code.length == 0) {
            invoice = new InvoiceContract{salt: INVOICE_SALT}(
                MERCHANT,
                MAINNET_UNIVERSAL_ROUTER,
                IPermit2(PERMIT2)
            );
        } else {
            invoice = InvoiceContract(payable(predicted));
            console2.log("InvoiceContract already deployed");
        }

        invoice.setAcceptedToken(USDC, true);
        invoice.setAcceptedToken(USDT, true);
        invoice.setAcceptedToken(JPYC, true);

        // token = address(0) means native ETH. dueDate = 0 means no deadline.
        uint256 id1 = invoice.createInvoice(PAYER_1, address(0), 0.05 ether, uint64(block.timestamp + 7 days));
        uint256 id2 = invoice.createInvoice(address(0), address(0), 0.02 ether, 0);
        uint256 id3 = invoice.createInvoice(PAYER_2, address(0), 0.015 ether, uint64(block.timestamp + 30 days));

        vm.stopBroadcast();

        console2.log("InvoiceContract", address(invoice));
        console2.log("invoice", id1);
        console2.log("invoice", id2);
        console2.log("invoice", id3);
    }

    /// @dev Uniswap v4 exact-output swap through the mainnet Universal Router.
    ///      Actions: SWAP_EXACT_OUT_SINGLE (0x08), SETTLE_ALL (0x0c), TAKE_ALL (0x0f).
    ///      A following SWEEP (0x04) returns unused ETH to payer 1.
    function _swapEthForExactOut(
        address tokenOut,
        uint24 fee,
        int24 tickSpacing,
        uint256 amountOut,
        uint256 amountInMax
    ) internal {
        PoolKey memory key = PoolKey({
            currency0: address(0),
            currency1: tokenOut,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: address(0)
        });

        bytes memory actions = abi.encodePacked(uint8(0x08), uint8(0x0c), uint8(0x0f));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(key, true, uint128(amountOut), uint128(amountInMax), bytes(""));
        params[1] = abi.encode(address(0), amountInMax);
        params[2] = abi.encode(tokenOut, amountOut);

        bytes memory commands = abi.encodePacked(uint8(0x10), uint8(0x04));
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(actions, params);
        inputs[1] = abi.encode(address(0), PAYER_1, uint256(0));

        MAINNET_UNIVERSAL_ROUTER.execute{value: amountInMax}(commands, inputs, block.timestamp + 1 hours);
    }

    /// @dev CREATE2 deployer is the broadcasting merchant, not this script contract.
    function _invoiceAddress() internal pure returns (address) {
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(InvoiceContract).creationCode,
                abi.encode(MERCHANT, MAINNET_UNIVERSAL_ROUTER, IPermit2(PERMIT2))
            )
        );
        return vm.computeCreate2Address(INVOICE_SALT, initCodeHash, MERCHANT);
    }
}