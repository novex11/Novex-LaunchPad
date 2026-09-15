// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReceiptToken} from "./ReceiptToken.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";
import {IWETH} from "./interfaces/IWETH.sol";

/// @title PairVault — two-token vault funded in kind
/// @notice Depositors add both tokens directly; no swaps or DEX liquidity are
///         needed. The first deposit (made by the factory at launch) must match
///         the target weight at oracle prices and mints 1e18 shares per $1.
///         Later deposits are proportional to current reserves, so share math
///         never depends on the oracle and redemptions can never be blocked by a
///         stale price. Deposits: creator or fee-exempt recipients only — the pair
///         is private to its creator and the public holds the pair's curve token,
///         whose buys reach the vault through the factory-approved CurveRouter.
///         Redeem is open to any share holder. The creator fee (shares minted to
///         the creator) only applies to depositors outside those paths, so in
///         practice it is never charged. Deposits pause while either stock token
///         has a pending ERC-8056 multiplier change.
contract PairVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Max deviation of the seed's value split from `weightABps`.
    uint16 public constant WEIGHT_TOLERANCE_BPS = 300;
    /// @dev Seed must be worth at least $1 (1e18 shares).
    uint256 public constant MIN_INITIAL_SHARES = 1e18;
    /// @dev USD with 8 decimals -> 18-decimal shares.
    uint256 private constant SHARE_SCALE = 1e10;

    struct Config {
        address creator;
        address tokenA;
        address tokenB;
        uint16 weightABps;
        uint16 creatorFeeBps;
        address receiptToken;
        address oracle;
        address emergency;
        address weth;
        /// @dev Launching factory (its seed is fee-free); defaults to the deployer.
        address factory;
    }

    address public immutable factory;
    address public immutable creator;
    address public immutable tokenA;
    address public immutable tokenB;
    address public immutable weth;
    uint16 public immutable weightABps;
    uint16 public immutable creatorFeeBps;
    uint8 public immutable decimalsA;
    uint8 public immutable decimalsB;
    ReceiptToken public immutable receiptToken;
    OracleAdapter public immutable oracle;
    EmergencyRegistry public immutable emergency;

    /// @notice Total shares ever minted to the creator as deposit fees.
    uint256 public creatorFeeShares;

    /// @notice owner => operator => may redeem the owner's shares (e.g. PairRouter).
    mapping(address => mapping(address => bool)) public isOperator;

    event Deposited(
        address indexed user,
        uint256 amountA,
        uint256 amountB,
        uint256 sharesMinted,
        uint256 feeShares,
        uint256 navUsd8
    );
    event Redeemed(
        address indexed user,
        uint256 sharesBurned,
        uint256 amountA,
        uint256 amountB,
        uint256 valueUsd8
    );
    event OperatorSet(address indexed owner, address indexed operator, bool approved);

    constructor(Config memory c) {
        factory = c.factory == address(0) ? msg.sender : c.factory;
        creator = c.creator;
        tokenA = c.tokenA;
        tokenB = c.tokenB;
        weightABps = c.weightABps;
        creatorFeeBps = c.creatorFeeBps;
        receiptToken = ReceiptToken(c.receiptToken);
        oracle = OracleAdapter(c.oracle);
        emergency = EmergencyRegistry(c.emergency);
        weth = c.weth;
        decimalsA = IERC20Metadata(c.tokenA).decimals();
        decimalsB = IERC20Metadata(c.tokenB).decimals();
    }

    // ─── Views ──────────────────────────────────────────────

    function weightBBps() external view returns (uint16) {
        return uint16(10_000 - weightABps);
    }

    function totalShares() public view returns (uint256) {
        return receiptToken.totalSupply();
    }

    function reserves() public view returns (uint256 balA, uint256 balB) {
        balA = IERC20(tokenA).balanceOf(address(this));
        balB = IERC20(tokenB).balanceOf(address(this));
    }

    /// @notice USD value (8 decimals) of both reserves at the latest oracle prices.
    function navUsd8() public view returns (uint256) {
        (uint256 balA, uint256 balB) = reserves();
        return _valueUsd8(tokenA, decimalsA, balA) + _valueUsd8(tokenB, decimalsB, balB);
    }

    /// @notice USD (8 decimals) per 1e18 shares. $1.00 before the first deposit.
    function sharePrice() external view returns (uint256) {
        uint256 ts = totalShares();
        if (ts == 0) return 1e8;
        return Math.mulDiv(navUsd8(), 1e18, ts);
    }

    /// @notice Token amounts needed to deposit roughly `valueUsd8` of value,
    ///         and the gross shares that deposit mints (before creator fee).
    function quoteDeposit(uint256 valueUsd8)
        external
        view
        returns (uint256 amountA, uint256 amountB, uint256 shares)
    {
        uint256 ts = totalShares();
        if (ts == 0) {
            uint256 valueA = (valueUsd8 * weightABps) / 10_000;
            amountA = _amountForValue(tokenA, decimalsA, valueA);
            amountB = _amountForValue(tokenB, decimalsB, valueUsd8 - valueA);
            shares = valueUsd8 * SHARE_SCALE;
            return (amountA, amountB, shares);
        }
        uint256 nav = navUsd8();
        require(nav > 0, "PairVault: no price");
        shares = Math.mulDiv(valueUsd8, ts, nav);
        (uint256 balA, uint256 balB) = reserves();
        amountA = Math.mulDiv(shares, balA, ts, Math.Rounding.Ceil);
        amountB = Math.mulDiv(shares, balB, ts, Math.Rounding.Ceil);
    }

    /// @notice Gross shares and exact token amounts a deposit of at most
    ///         (`maxA`, `maxB`) would use right now.
    function previewDeposit(uint256 maxA, uint256 maxB)
        external
        view
        returns (uint256 shares, uint256 usedA, uint256 usedB)
    {
        uint256 ts = totalShares();
        if (ts == 0) {
            uint256 value = _valueUsd8(tokenA, decimalsA, maxA) + _valueUsd8(tokenB, decimalsB, maxB);
            return (value * SHARE_SCALE, maxA, maxB);
        }
        return _proportional(ts, maxA, maxB);
    }

    function quoteRedeem(uint256 shares)
        public
        view
        returns (uint256 amountA, uint256 amountB, uint256 valueUsd8)
    {
        uint256 ts = totalShares();
        if (ts == 0 || shares == 0) return (0, 0, 0);
        (uint256 balA, uint256 balB) = reserves();
        amountA = Math.mulDiv(shares, balA, ts);
        amountB = Math.mulDiv(shares, balB, ts);
        valueUsd8 = _valueUsd8(tokenA, decimalsA, amountA) + _valueUsd8(tokenB, decimalsB, amountB);
    }

    // ─── Deposit ────────────────────────────────────────────

    /// @notice Deposit up to `maxA` tokenA and `maxB` tokenB. Only the
    ///         proportional amounts are pulled. If one leg is WETH you may send
    ///         native ETH instead; unused ETH is refunded.
    function deposit(uint256 maxA, uint256 maxB, uint256 minShares)
        external
        payable
        nonReentrant
        returns (uint256 shares)
    {
        return _deposit(msg.sender, maxA, maxB, minShares);
    }

    /// @notice Deposit on behalf of `recipient`; the caller pays.
    function depositFor(address recipient, uint256 maxA, uint256 maxB, uint256 minShares)
        external
        payable
        nonReentrant
        returns (uint256 shares)
    {
        require(recipient != address(0), "PairVault: zero recipient");
        return _deposit(recipient, maxA, maxB, minShares);
    }

    function _deposit(address recipient, uint256 maxA, uint256 maxB, uint256 minShares)
        internal
        returns (uint256 shares)
    {
        require(!emergency.depositsPaused(), "PairVault: deposits paused");
        require(
            !oracle.isMultiplierPending(tokenA) && !oracle.isMultiplierPending(tokenB),
            "PairVault: multiplier pending"
        );
        if (msg.value > 0) {
            require(weth != address(0) && (tokenA == weth || tokenB == weth), "PairVault: ETH not accepted");
        }

        uint256 ts = totalShares();
        uint256 gross;
        uint256 usedA;
        uint256 usedB;
        if (ts == 0) {
            (gross, usedA, usedB) = _initial(maxA, maxB);
        } else {
            (gross, usedA, usedB) = _proportional(ts, maxA, maxB);
            require(gross > 0, "PairVault: zero shares");
        }

        uint256 nativeSpent = _pull(tokenA, usedA) + _pull(tokenB, usedB);
        if (msg.value > nativeSpent) {
            (bool ok, ) = msg.sender.call{value: msg.value - nativeSpent}("");
            require(ok, "PairVault: refund failed");
        }

        // Deposits: creator or fee-exempt recipients only. The pair is private to
        // its creator; the public holds the curve token, whose buys reach the vault
        // through a factory-approved fee-exempt recipient (CurveRouter). The launch
        // seed the factory places is the third allowed path. None of them pay a fee.
        bool allowed = recipient == creator || msg.sender == factory || _feeExempt(recipient);
        require(allowed, "PairVault: creator only");
        uint256 fee = allowed ? 0 : (gross * creatorFeeBps) / 10_000;
        shares = gross - fee;
        require(shares >= minShares, "PairVault: slippage");

        receiptToken.mint(recipient, shares);
        if (fee > 0) {
            receiptToken.mint(creator, fee);
            creatorFeeShares += fee;
        }

        emit Deposited(recipient, usedA, usedB, shares, fee, navUsd8());
    }

    /// @dev Asks the factory whether `recipient` is fee-exempt; false when the factory
    ///      is an EOA or predates the feature (no revert, no assumptions).
    function _feeExempt(address recipient) internal view returns (bool) {
        (bool ok, bytes memory data) =
            factory.staticcall(abi.encodeWithSignature("feeExemptRecipients(address)", recipient));
        return ok && data.length == 32 && abi.decode(data, (bool));
    }

    /// @dev First deposit: value split must match the target weight at fresh prices.
    function _initial(uint256 amountA, uint256 amountB)
        internal
        view
        returns (uint256 gross, uint256 usedA, uint256 usedB)
    {
        require(amountA > 0 && amountB > 0, "PairVault: zero amount");
        uint256 valueA = oracle.getTokenValueUsd(tokenA, amountA);
        uint256 valueB = oracle.getTokenValueUsd(tokenB, amountB);
        uint256 total = valueA + valueB;
        require(total > 0, "PairVault: zero value");
        uint256 actualWeightA = (valueA * 10_000) / total;
        uint256 diff = actualWeightA > weightABps
            ? actualWeightA - weightABps
            : weightABps - actualWeightA;
        require(diff <= WEIGHT_TOLERANCE_BPS, "PairVault: weight mismatch");
        gross = total * SHARE_SCALE;
        require(gross >= MIN_INITIAL_SHARES, "PairVault: seed too small");
        return (gross, amountA, amountB);
    }

    function _proportional(uint256 ts, uint256 maxA, uint256 maxB)
        internal
        view
        returns (uint256 gross, uint256 usedA, uint256 usedB)
    {
        (uint256 balA, uint256 balB) = reserves();
        require(balA > 0 && balB > 0, "PairVault: empty reserves");
        uint256 sharesA = Math.mulDiv(maxA, ts, balA);
        uint256 sharesB = Math.mulDiv(maxB, ts, balB);
        gross = sharesA < sharesB ? sharesA : sharesB;
        usedA = Math.mulDiv(gross, balA, ts, Math.Rounding.Ceil);
        usedB = Math.mulDiv(gross, balB, ts, Math.Rounding.Ceil);
    }

    /// @dev Pulls `amount` of `token` from the caller. Wraps native ETH for the
    ///      WETH leg when ETH was sent. Returns the native wei consumed.
    function _pull(address token, uint256 amount) internal returns (uint256 nativeSpent) {
        if (amount == 0) return 0;
        if (token == weth && msg.value > 0) {
            require(msg.value >= amount, "PairVault: insufficient ETH");
            IWETH(weth).deposit{value: amount}();
            return amount;
        }
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        return 0;
    }

    // ─── Redeem ─────────────────────────────────────────────

    /// @notice Burn shares for a proportional slice of both reserves. Never
    ///         paused and never depends on oracle freshness.
    function redeem(uint256 shares, uint256 minAmountA, uint256 minAmountB)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        return _redeem(msg.sender, shares, minAmountA, minAmountB, msg.sender);
    }

    /// @notice Let `operator` redeem your shares on your behalf (e.g. to sell
    ///         them for ETH through PairRouter). Revoke with `approved = false`.
    function setOperator(address operator, bool approved) external {
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
    }

    /// @notice Burn `owner`'s shares and send both tokens to `to`. Callable by
    ///         the owner or an operator the owner approved.
    function redeemFrom(
        address owner,
        uint256 shares,
        uint256 minAmountA,
        uint256 minAmountB,
        address to
    ) external nonReentrant returns (uint256 amountA, uint256 amountB) {
        require(msg.sender == owner || isOperator[owner][msg.sender], "PairVault: not operator");
        require(to != address(0), "PairVault: zero recipient");
        return _redeem(owner, shares, minAmountA, minAmountB, to);
    }

    function _redeem(address owner, uint256 shares, uint256 minAmountA, uint256 minAmountB, address to)
        internal
        returns (uint256 amountA, uint256 amountB)
    {
        require(shares > 0, "PairVault: zero shares");
        uint256 valueUsd8;
        (amountA, amountB, valueUsd8) = quoteRedeem(shares);
        require(amountA >= minAmountA && amountB >= minAmountB, "PairVault: slippage");

        receiptToken.burn(owner, shares);
        if (amountA > 0) IERC20(tokenA).safeTransfer(to, amountA);
        if (amountB > 0) IERC20(tokenB).safeTransfer(to, amountB);

        emit Redeemed(owner, shares, amountA, amountB, valueUsd8);
    }

    // ─── Pricing helpers ────────────────────────────────────

    /// @dev Value at the latest price, ignoring staleness; 0 if the feed is unusable.
    function _valueUsd8(address token, uint8 dec, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        try oracle.getPriceUnchecked(token) returns (uint256 price) {
            return Math.mulDiv(amount, price, 10 ** dec);
        } catch {
            return 0;
        }
    }

    function _amountForValue(address token, uint8 dec, uint256 valueUsd8) internal view returns (uint256) {
        uint256 price = oracle.getPriceUnchecked(token);
        return Math.mulDiv(valueUsd8, 10 ** dec, price, Math.Rounding.Ceil);
    }
}
