// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @title InvoiceContract
/// @notice Per-merchant invoices, payable in ETH, the invoice ERC-20, or via Uniswap v4 swap.
/// @dev Design notes (wrapper vs in-contract swap, trust model) live in README.md.
contract InvoiceContract is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Pending, Paid, Cancelled, Expired }

    struct Invoice {
        address payer;   // Restricted payer. address(0) means anyone may pay.
        address token;   // ERC-20 used for payment. address(0) means native ETH.
        uint256 amount;  // Fixed amount, set at creation and never changed.
        uint64 dueDate;  // UNIX timestamp. 0 means no deadline.
        Status status;
    }

    address public merchant;

    IUniversalRouter public immutable UNIVERSAL_ROUTER;
    IPermit2 public immutable PERMIT2;

    uint256 public nextInvoiceId = 1;
    mapping(uint256 => Invoice) public invoices;

    /// @notice Invoice tokens and swap tokenIn. ETH is not listed; use token = address(0).
    mapping(address => bool) public acceptedTokens;

    event InvoiceCreated(
        uint256 indexed invoiceId,
        address indexed merchant,
        address indexed payer,
        address token,
        uint256 amount,
        uint64 dueDate
    );

    event InvoicePaid(
        uint256 indexed invoiceId,
        address indexed payer,
        address indexed merchant,
        address token,
        uint256 amount,
        uint256 timestamp
    );

    event InvoicePaidWithSwap(
        uint256 indexed invoiceId,
        address indexed payer,
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );

    event InvoiceCancelled(uint256 indexed invoiceId);
    event InvoiceExpired(uint256 indexed invoiceId);
    event MerchantUpdated(address indexed previousMerchant, address indexed newMerchant);
    event AcceptedTokenSet(address indexed token, bool accepted);

    error InvalidAmount();
    error InvalidMerchant();
    error InvoiceNotFound();
    error InvoiceNotPending();
    error InvoiceExpiredError();
    error WrongPayer();
    error WrongAmount();
    error NotDueYet();
    error NotAuthorized();
    error UnsupportedToken();
    error TokenNotAccepted();
    error SlippageExceeded();
    error SwapDidNotDeliver();
    error AmountOutOfRange();

    modifier onlyMerchant() {
        if (msg.sender != merchant) revert NotAuthorized();
        _;
    }

    constructor(address merchant_, IUniversalRouter universalRouter_, IPermit2 permit2_) {
        if (merchant_ == address(0)) revert InvalidMerchant();
        merchant = merchant_;
        UNIVERSAL_ROUTER = universalRouter_;
        PERMIT2 = permit2_;
    }

    /// @notice Replace the payee. Unpaid invoices settle to the merchant at payment time.
    function setMerchant(address newMerchant) external onlyMerchant {
        if (newMerchant == address(0)) revert InvalidMerchant();
        address previousMerchant = merchant;
        merchant = newMerchant;
        emit MerchantUpdated(previousMerchant, newMerchant);
    }

    /// @notice Merchant-only allow-list. `token` cannot be address(0).
    function setAcceptedToken(address token, bool accepted) external onlyMerchant {
        if (token == address(0)) revert UnsupportedToken();
        acceptedTokens[token] = accepted;
        emit AcceptedTokenSet(token, accepted);
    }

    /// @notice Merchant-only. ERC-20 `token` must be accepted; `address(0)` is ETH.
    function createInvoice(
        address payer,
        address token,
        uint256 amount,
        uint64 dueDate
    ) external onlyMerchant returns (uint256 invoiceId) {
        if (amount == 0) revert InvalidAmount();
        if (token != address(0) && !acceptedTokens[token]) revert TokenNotAccepted();

        invoiceId = nextInvoiceId++;
        invoices[invoiceId] = Invoice({
            payer: payer,
            token: token,
            amount: amount,
            dueDate: dueDate,
            status: Status.Pending
        });

        emit InvoiceCreated(invoiceId, merchant, payer, token, amount, dueDate);
    }

    /// @notice Pay in the invoice ERC-20. Caller must approve this contract first.
    function payInvoiceERC20(uint256 invoiceId) external {
        Invoice storage inv = _validateForPayment(invoiceId);
        if (inv.token == address(0)) revert WrongAmount();

        inv.status = Status.Paid;
        IERC20(inv.token).safeTransferFrom(msg.sender, merchant, inv.amount);

        emit InvoicePaid(invoiceId, msg.sender, merchant, inv.token, inv.amount, block.timestamp);
    }

    /// @notice Swap an accepted ERC-20 to the invoice token via client-built UR calldata.
    function payInvoiceWithRouterSwap(
        uint256 invoiceId,
        address tokenIn,
        uint256 maxAmountIn,
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 routerDeadline
    ) external nonReentrant returns (uint256 amountInSpent, uint256 amountOutReceived) {
        Invoice storage inv = _validateForPayment(invoiceId);
        if (tokenIn == address(0) || tokenIn == inv.token) revert UnsupportedToken();
        if (!acceptedTokens[tokenIn]) revert TokenNotAccepted();
        // Permit2's allowance amount field is uint160 — reject anything that wouldn't fit
        // rather than silently truncating it in the cast below.
        if (maxAmountIn > type(uint160).max) revert AmountOutOfRange();
        if (routerDeadline > type(uint48).max) revert AmountOutOfRange();

        inv.status = Status.Paid;

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), maxAmountIn);

        // Inner scope avoids "stack too deep" on the later InvoicePaid emit.
        {
            uint256 tokenInBefore = IERC20(tokenIn).balanceOf(address(this));
            uint256 tokenOutBefore = _balanceOf(inv.token, address(this));

            IERC20(tokenIn).forceApprove(address(PERMIT2), maxAmountIn);
            PERMIT2.approve(tokenIn, address(UNIVERSAL_ROUTER), uint160(maxAmountIn), uint48(routerDeadline));
            UNIVERSAL_ROUTER.execute(commands, inputs, routerDeadline);
            PERMIT2.approve(tokenIn, address(UNIVERSAL_ROUTER), 0, 0);
            IERC20(tokenIn).forceApprove(address(PERMIT2), 0);

            amountInSpent = tokenInBefore - IERC20(tokenIn).balanceOf(address(this));
            amountOutReceived = _balanceOf(inv.token, address(this)) - tokenOutBefore;
        }

        if (amountInSpent > maxAmountIn) revert SlippageExceeded();
        if (amountOutReceived < inv.amount) revert SwapDidNotDeliver();

        uint256 tokenInLeftover = maxAmountIn - amountInSpent;
        if (tokenInLeftover > 0) IERC20(tokenIn).safeTransfer(msg.sender, tokenInLeftover);

        _push(inv.token, merchant, inv.amount);
        uint256 tokenOutLeftover = amountOutReceived - inv.amount;
        if (tokenOutLeftover > 0) _push(inv.token, msg.sender, tokenOutLeftover);

        emit InvoicePaid(invoiceId, msg.sender, merchant, inv.token, inv.amount, block.timestamp);
        emit InvoicePaidWithSwap(invoiceId, msg.sender, tokenIn, amountInSpent, inv.token, inv.amount);
    }

    receive() external payable {}

    /// @notice Pay a native-ETH invoice. `msg.value` must equal `amount`.
    function payInvoiceETH(uint256 invoiceId) external payable {
        Invoice storage inv = _validateForPayment(invoiceId);
        if (inv.token != address(0)) revert WrongAmount();
        if (msg.value != inv.amount) revert WrongAmount();

        inv.status = Status.Paid;
        (bool ok, ) = merchant.call{value: msg.value}("");
        require(ok, "ETH transfer failed");

        emit InvoicePaid(invoiceId, msg.sender, merchant, address(0), inv.amount, block.timestamp);
    }

    /// @notice Merchant-only cancel of a pending invoice.
    function cancelInvoice(uint256 invoiceId) external onlyMerchant {
        Invoice storage inv = _getInvoice(invoiceId);
        if (inv.status != Status.Pending) revert InvoiceNotPending();

        inv.status = Status.Cancelled;
        emit InvoiceCancelled(invoiceId);
    }

    /// @notice Anyone may expire a pending invoice after `dueDate`. Status does not auto-update.
    function expireInvoice(uint256 invoiceId) external {
        Invoice storage inv = _getInvoice(invoiceId);
        if (inv.status != Status.Pending) revert InvoiceNotPending();
        if (inv.dueDate == 0 || block.timestamp <= inv.dueDate) revert NotDueYet();

        inv.status = Status.Expired;
        emit InvoiceExpired(invoiceId);
    }

    function getInvoice(uint256 invoiceId) external view returns (Invoice memory) {
        return _getInvoice(invoiceId);
    }

    function _getInvoice(uint256 invoiceId) private view returns (Invoice storage inv) {
        if (invoiceId == 0 || invoiceId >= nextInvoiceId) revert InvoiceNotFound();
        inv = invoices[invoiceId];
    }

    function _validateForPayment(uint256 invoiceId) private view returns (Invoice storage inv) {
        inv = _getInvoice(invoiceId);
        if (inv.status != Status.Pending) revert InvoiceNotPending();
        if (inv.dueDate != 0 && block.timestamp > inv.dueDate) revert InvoiceExpiredError();
        if (inv.payer != address(0) && inv.payer != msg.sender) revert WrongPayer();
    }

    function _balanceOf(address token, address owner) private view returns (uint256) {
        if (token == address(0)) return owner.balance;
        return IERC20(token).balanceOf(owner);
    }

    function _push(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
