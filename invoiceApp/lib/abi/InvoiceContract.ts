// Human-readable ABI (ethers v6 parses these directly) — matches InvoiceContract.sol
// exactly, function for function, event for event, error for error. Regenerate this
// (or swap it for a real compiler-generated ABI JSON) if the contract's interface
// changes; nothing here is inferred, it's a direct transcription of the .sol source.

export const INVOICE_CONTRACT_ABI = [
  // --- state getters ---
  "function merchant() view returns (address)",
  "function UNIVERSAL_ROUTER() view returns (address)",
  "function PERMIT2() view returns (address)",
  "function nextInvoiceId() view returns (uint256)",
  "function acceptedTokens(address token) view returns (bool)",
  "function getInvoice(uint256 invoiceId) view returns (tuple(address payer, address token, uint256 amount, uint64 dueDate, uint8 status))",

  // --- merchant-only writes ---
  "function setMerchant(address newMerchant)",
  "function setAcceptedToken(address token, bool accepted)",
  "function createInvoice(address payer, address token, uint256 amount, uint64 dueDate) returns (uint256 invoiceId)",
  "function cancelInvoice(uint256 invoiceId)",

  // --- payer writes ---
  "function payInvoiceERC20(uint256 invoiceId)",
  "function payInvoiceETH(uint256 invoiceId) payable",
  "function payInvoiceWithRouterSwap(uint256 invoiceId, address tokenIn, uint256 maxAmountIn, bytes commands, bytes[] inputs, uint256 routerDeadline) returns (uint256 amountInSpent, uint256 amountOutReceived)",

  // --- anyone ---
  "function expireInvoice(uint256 invoiceId)",

  // --- events ---
  "event InvoiceCreated(uint256 indexed invoiceId, address indexed merchant, address indexed payer, address token, uint256 amount, uint64 dueDate)",
  "event InvoicePaid(uint256 indexed invoiceId, address indexed payer, address indexed merchant, address token, uint256 amount, uint256 timestamp)",
  "event InvoicePaidWithSwap(uint256 indexed invoiceId, address indexed payer, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut)",
  "event InvoiceCancelled(uint256 indexed invoiceId)",
  "event InvoiceExpired(uint256 indexed invoiceId)",
  "event MerchantUpdated(address indexed previousMerchant, address indexed newMerchant)",
  "event AcceptedTokenSet(address indexed token, bool accepted)",

  // --- custom errors (lets ethers decode reverts with a name instead of raw data) ---
  "error InvalidAmount()",
  "error InvalidMerchant()",
  "error InvoiceNotFound()",
  "error InvoiceNotPending()",
  "error InvoiceExpiredError()",
  "error WrongPayer()",
  "error WrongAmount()",
  "error NotDueYet()",
  "error NotAuthorized()",
  "error UnsupportedToken()",
  "error TokenNotAccepted()",
  "error SlippageExceeded()",
  "error SwapDidNotDeliver()",
  "error AmountOutOfRange()",
] as const;

export const INVOICE_STATUS_LABELS = ["Pending", "Paid", "Cancelled", "Expired"] as const;
export type InvoiceStatusLabel = (typeof INVOICE_STATUS_LABELS)[number];
