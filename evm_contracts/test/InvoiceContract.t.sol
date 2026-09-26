// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {InvoiceContract, IPermit2, IUniversalRouter} from "../src/InvoiceContract.sol";

contract TestToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Constructor only stores this address. approve is a no-op.
contract Permit2Mock is IPermit2 {
    function approve(address, address, uint160, uint48) external {}
}

/// @dev Stands in for Universal Router. Sends a preset amount of tokenOut or ETH to the caller.
contract RouterMock is IUniversalRouter {
    TestToken public tokenOut;
    uint256 public amountOut;
    bool public payoutEth;

    function setPayout(TestToken tokenOut_, uint256 amountOut_) external {
        tokenOut = tokenOut_;
        amountOut = amountOut_;
        payoutEth = false;
    }

    function setEthPayout(uint256 amountOut_) external {
        amountOut = amountOut_;
        payoutEth = true;
    }

    function execute(bytes calldata, bytes[] calldata, uint256) external payable {
        if (amountOut == 0) return;
        if (payoutEth) {
            (bool ok, ) = msg.sender.call{value: amountOut}("");
            require(ok, "eth payout failed");
        } else {
            tokenOut.transfer(msg.sender, amountOut);
        }
    }
}

contract InvoiceContractTest is Test {
    InvoiceContract invoice;
    Permit2Mock permit2;
    RouterMock router;
    TestToken usdc;
    TestToken dai;

    address merchant = makeAddr("merchant");
    address payer = makeAddr("payer");

    function setUp() public {
        permit2 = new Permit2Mock();
        router = new RouterMock();
        usdc = new TestToken("USD Coin", "USDC");
        dai = new TestToken("Dai", "DAI");

        invoice = new InvoiceContract(merchant, IUniversalRouter(address(router)), IPermit2(address(permit2)));
    }

    function test_constructor_storesPermit2AndRouter() public view {
        assertEq(address(invoice.PERMIT2()), address(permit2));
        assertEq(address(invoice.UNIVERSAL_ROUTER()), address(router));
        assertEq(invoice.merchant(), merchant);
    }

    function test_constructor_rejectsZeroMerchant() public {
        vm.expectRevert(InvoiceContract.InvalidMerchant.selector);
        new InvoiceContract(address(0), IUniversalRouter(address(router)), IPermit2(address(permit2)));
    }

    function test_createInvoice_rejectsUnacceptedErc20() public {
        vm.prank(merchant);
        vm.expectRevert(InvoiceContract.TokenNotAccepted.selector);
        invoice.createInvoice(payer, address(usdc), 100e6, 0);
    }

    function test_createInvoice_allowsNativeEthWithoutAllowList() public {
        vm.prank(merchant);
        uint256 id = invoice.createInvoice(payer, address(0), 1 ether, 0);
        assertEq(id, 1);
        assertEq(invoice.getInvoice(id).token, address(0));
    }

    function test_setAcceptedToken_rejectsZeroAddress() public {
        vm.prank(merchant);
        vm.expectRevert(InvoiceContract.UnsupportedToken.selector);
        invoice.setAcceptedToken(address(0), true);
    }

    function test_payInvoiceERC20_requiresPayerApproval() public {
        vm.startPrank(merchant);
        invoice.setAcceptedToken(address(usdc), true);
        uint256 id = invoice.createInvoice(payer, address(usdc), 100e6, 0);
        vm.stopPrank();

        usdc.mint(payer, 100e6);
        vm.prank(payer);
        usdc.approve(address(invoice), 100e6);

        vm.prank(payer);
        invoice.payInvoiceERC20(id);

        assertEq(usdc.balanceOf(merchant), 100e6);
        assertEq(uint256(invoice.getInvoice(id).status), uint256(InvoiceContract.Status.Paid));
    }

    function test_payInvoiceWithRouterSwap_settlesTokenOut() public {
        vm.startPrank(merchant);
        invoice.setAcceptedToken(address(usdc), true);
        invoice.setAcceptedToken(address(dai), true);
        uint256 id = invoice.createInvoice(payer, address(usdc), 100e6, 0);
        vm.stopPrank();

        dai.mint(payer, 100e18);
        usdc.mint(address(router), 100e6);
        router.setPayout(usdc, 100e6);

        vm.startPrank(payer);
        dai.approve(address(invoice), 100e18);
        invoice.payInvoiceWithRouterSwap(id, address(dai), 100e18, "", new bytes[](0), block.timestamp + 1 hours);
        vm.stopPrank();

        assertEq(usdc.balanceOf(merchant), 100e6);
        assertEq(uint256(invoice.getInvoice(id).status), uint256(InvoiceContract.Status.Paid));
    }

    function test_payInvoiceWithRouterSwap_settlesNativeEth() public {
        vm.startPrank(merchant);
        invoice.setAcceptedToken(address(dai), true);
        uint256 id = invoice.createInvoice(payer, address(0), 0.05 ether, 0);
        vm.stopPrank();

        dai.mint(payer, 100e18);
        vm.deal(address(router), 0.05 ether);
        router.setEthPayout(0.05 ether);

        uint256 merchantBefore = merchant.balance;

        vm.startPrank(payer);
        dai.approve(address(invoice), 100e18);
        invoice.payInvoiceWithRouterSwap(id, address(dai), 100e18, "", new bytes[](0), block.timestamp + 1 hours);
        vm.stopPrank();

        assertEq(merchant.balance - merchantBefore, 0.05 ether);
        assertEq(uint256(invoice.getInvoice(id).status), uint256(InvoiceContract.Status.Paid));
    }

    function test_payInvoiceWithRouterSwap_rejectsNativeTokenIn() public {
        vm.prank(merchant);
        uint256 id = invoice.createInvoice(payer, address(0), 1 ether, 0);

        vm.prank(payer);
        vm.expectRevert(InvoiceContract.UnsupportedToken.selector);
        invoice.payInvoiceWithRouterSwap(id, address(0), 1 ether, "", new bytes[](0), block.timestamp + 1 hours);
    }
}