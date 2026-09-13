// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReceiptToken} from "./ReceiptToken.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {ExecutionRouter} from "./ExecutionRouter.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";

/// @title PairVault — permissionless 2-token pair vault with creator economics
/// @notice Each pair vault holds exactly two approved tokens with a fixed
///         weight split. USDG is the universal deposit currency. Creators
///         earn a fee (100-500 bps) on every non-creator deposit.
contract PairVault {
    using SafeERC20 for IERC20;

    // ─── Immutable state ────────────────────────────────────

    address public immutable creator;
    address public immutable tokenA;
    address public immutable tokenB;
    address public immutable usdgAsset;
    uint16 public immutable weightABps; // e.g. 6000 = 60% into tokenA
    uint16 public immutable creatorFeeBps; // 100-500 (1%-5%)

    ReceiptToken public immutable receiptToken;
    OracleAdapter public immutable oracle;
    ExecutionRouter public immutable executionRouter;
    EmergencyRegistry public immutable emergency;

    // ─── Mutable state ──────────────────────────────────────

    uint256 public totalShares;
    uint256 public creatorEarningsUsdg; // accumulated USDG owed to creator
    bool public creatorDeposited; // true after creator's first-deposit at 1:1 NAV

    // ─── Events ─────────────────────────────────────────────

    event Deposited(
        address indexed user,
        uint256 usdgAmount,
        uint256 sharesMinted,
        uint256 creatorFeeUsdg,
        uint256 navUsd8AtDeposit
    );
    event Redeemed(
        address indexed user,
        uint256 sharesBurned,
        uint256 usdgOut,
        uint256 valueUsd8
    );
    event CreatorFeesClaimed(address indexed creator, uint256 usdgAmount);
    event PairSwap(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor(
        address creator_,
        address tokenA_,
        address tokenB_,
        uint16 weightABps_,
        uint16 creatorFeeBps_,
        address receiptToken_,
        address usdgAsset_,
        address oracle_,
        address executionRouter_,
        address emergency_
    ) {
        creator = creator_;
        tokenA = tokenA_;
        tokenB = tokenB_;
        weightABps = weightABps_;
        creatorFeeBps = creatorFeeBps_;
        receiptToken = ReceiptToken(receiptToken_);
        usdgAsset = usdgAsset_;
        oracle = OracleAdapter(oracle_);
        executionRouter = ExecutionRouter(executionRouter_);
        emergency = EmergencyRegistry(emergency_);
    }

    // ─── Views ──────────────────────────────────────────────

    function weightBBps() external view returns (uint16) {
        return uint16(10_000 - weightABps);
    }

    /// @notice USD8 value of both tokens held by this vault
    function navUsd8() public view returns (uint256 total) {
        uint256 balA = IERC20(tokenA).balanceOf(address(this));
        uint256 balB = IERC20(tokenB).balanceOf(address(this));
        if (balA > 0) total += oracle.getTokenValueUsd(tokenA, balA);
        if (balB > 0) total += oracle.getTokenValueUsd(tokenB, balB);
    }

    /// @notice Share price in 1e18 fixed-point (USD8 per share)
    function sharePrice() public view returns (uint256) {
        if (totalShares == 0) return 1e18;
        return (navUsd8() * 1e18) / totalShares;
    }

    // ─── Deposit ────────────────────────────────────────────

    /// @notice Deposit USDG. Creator fee is retained for creator to claim.
    ///         Rest is split by `weightABps` and swapped into tokenA / tokenB.
    /// @param usdgAmount USDG amount (18-decimal, matches USDG token decimals)
    /// @param minShares  Slippage guard on shares minted
    function deposit(uint256 usdgAmount, uint256 minShares)
        external
        returns (uint256 sharesMinted)
    {
        return _deposit(msg.sender, msg.sender, usdgAmount, minShares);
    }

    /// @notice Deposit on behalf of `recipient`. Payer sends the USDG; the
    ///         receipt shares mint to `recipient`. Used by the launchpad Zap
    ///         when routing non-USDG sources on the user's behalf.
    /// @dev Fee waiver + creator-flag semantics track the *recipient* so the
    ///      launcher's first-deposit-at-1:1-NAV bonus still applies when
    ///      seeded through the Zap.
    function depositFor(
        address recipient,
        uint256 usdgAmount,
        uint256 minShares
    ) external returns (uint256 sharesMinted) {
        require(recipient != address(0), "PairVault: zero recipient");
        return _deposit(msg.sender, recipient, usdgAmount, minShares);
    }

    function _deposit(
        address payer,
        address recipient,
        uint256 usdgAmount,
        uint256 minShares
    ) internal returns (uint256 sharesMinted) {
        require(usdgAmount > 0, "PairVault: zero amount");
        require(!emergency.depositsPaused(), "PairVault: deposits paused");
        _requireNoMultiplierPending();

        // Snapshot price BEFORE transfer (prevents share-dilution)
        uint256 navBefore = navUsd8();
        uint256 priceBefore = totalShares == 0
            ? 1e18
            : (navBefore * 1e18) / totalShares;

        // USDG is $1 → USD8 value == usdgAmount in 8-decimal
        uint256 usdgPrice = oracle.getPrice(usdgAsset); // ~1e8
        uint256 depositValueUsd8 = (usdgAmount * usdgPrice) / 1e18;

        // Pull USDG from the payer (may be caller or Zap)
        IERC20(usdgAsset).safeTransferFrom(payer, address(this), usdgAmount);

        // Creator fee — skip on the creator's very first deposit, regardless
        // of who paid it (recipient identity is what matters).
        uint256 feeUsdg = 0;
        bool isCreator = recipient == creator;
        bool takeFee = !(isCreator && !creatorDeposited);
        if (takeFee) {
            feeUsdg = (usdgAmount * creatorFeeBps) / 10_000;
            creatorEarningsUsdg += feeUsdg;
        }
        if (isCreator && !creatorDeposited) {
            creatorDeposited = true;
        }

        uint256 swapUsdg = usdgAmount - feeUsdg;

        // Route swaps into tokenA / tokenB per weights
        _executePairSwaps(swapUsdg);

        // Mint shares based on pre-transfer price and pre-fee value
        uint256 shareValueUsd8 = depositValueUsd8 - ((feeUsdg * usdgPrice) / 1e18);
        sharesMinted = (shareValueUsd8 * 1e18) / priceBefore;
        require(sharesMinted >= minShares, "PairVault: slippage");

        totalShares += sharesMinted;
        receiptToken.mint(recipient, sharesMinted);

        emit Deposited(recipient, usdgAmount, sharesMinted, feeUsdg, navUsd8());
    }

    /// @notice Maximum tolerated slippage in basis points for oracle-guarded swaps.
    ///         200 bps = 2 % — comparable to Long.xyz-style concentrated-liquidity bounds.
    uint16 public constant SWAP_SLIPPAGE_BPS = 200;

    /// @dev Revert if either leg has a pending ERC-8056 multiplier change
    ///      (e.g. stock split, dividend). Inspired by Long.xyz epoch guards
    ///      that pause trading around corporate actions.
    function _requireNoMultiplierPending() internal view {
        require(
            !oracle.isMultiplierPending(tokenA),
            "PairVault: tokenA multiplier pending"
        );
        require(
            !oracle.isMultiplierPending(tokenB),
            "PairVault: tokenB multiplier pending"
        );
    }

    /// @dev Compute a floor output from oracle prices so swaps never execute
    ///      at a price worse than `SWAP_SLIPPAGE_BPS` below fair value.
    function _oracleMinOut(
        address tokenIn,
        uint256 amountIn,
        address tokenOut
    ) internal view returns (uint256) {
        uint256 valueUsd8 = oracle.getTokenValueUsd(tokenIn, amountIn);
        uint256 priceOut = oracle.getPrice(tokenOut);
        if (priceOut == 0) return 0;
        // fairOut in 18-decimal tokenOut units
        uint256 fairOut = (valueUsd8 * 1e18) / priceOut;
        return (fairOut * (10_000 - SWAP_SLIPPAGE_BPS)) / 10_000;
    }

    function _executePairSwaps(uint256 usdgAmount) internal {
        if (usdgAmount == 0) return;

        uint256 amountForA = (usdgAmount * weightABps) / 10_000;
        uint256 amountForB = usdgAmount - amountForA;

        // Approve router for full amount
        IERC20(usdgAsset).forceApprove(address(executionRouter), usdgAmount);

        if (tokenA == usdgAsset) {
            // Hold USDG as tokenA leg
        } else if (amountForA > 0) {
            uint256 minA = _oracleMinOut(usdgAsset, amountForA, tokenA);
            uint256 outA = executionRouter.executeSwap(
                usdgAsset,
                tokenA,
                amountForA,
                minA,
                address(this)
            );
            emit PairSwap(usdgAsset, tokenA, amountForA, outA);
        }

        if (tokenB == usdgAsset) {
            // Hold USDG as tokenB leg
        } else if (amountForB > 0) {
            uint256 minB = _oracleMinOut(usdgAsset, amountForB, tokenB);
            uint256 outB = executionRouter.executeSwap(
                usdgAsset,
                tokenB,
                amountForB,
                minB,
                address(this)
            );
            emit PairSwap(usdgAsset, tokenB, amountForB, outB);
        }

        // Clear allowance
        IERC20(usdgAsset).forceApprove(address(executionRouter), 0);
    }

    // ─── Redeem ─────────────────────────────────────────────

    /// @notice Redeem receipt shares for USDG. Both legs swap back to USDG.
    function redeem(uint256 shares, uint256 minUsdgOut)
        external
        returns (uint256 usdgOut)
    {
        require(shares > 0, "PairVault: zero shares");
        require(
            receiptToken.balanceOf(msg.sender) >= shares,
            "PairVault: insufficient shares"
        );
        _requireNoMultiplierPending();

        uint256 price = sharePrice();
        uint256 valueUsd8 = (shares * price) / 1e18;
        uint256 shareRatio = (shares * 1e18) / totalShares;

        receiptToken.burn(msg.sender, shares);
        totalShares -= shares;

        usdgOut = _redeemToUsdg(shareRatio);
        require(usdgOut >= minUsdgOut, "PairVault: min output");

        if (usdgOut > 0) {
            IERC20(usdgAsset).safeTransfer(msg.sender, usdgOut);
        }

        emit Redeemed(msg.sender, shares, usdgOut, valueUsd8);
    }

    function _redeemToUsdg(uint256 shareRatio) internal returns (uint256) {
        uint256 usdgBefore = IERC20(usdgAsset).balanceOf(address(this));
        // Note: usdgBefore includes creatorEarningsUsdg. We subtract it out
        // so redeemers never touch fees owed to the creator.
        uint256 availableUsdgBefore = usdgBefore > creatorEarningsUsdg
            ? usdgBefore - creatorEarningsUsdg
            : 0;

        // Swap proportional tokenA back to USDG (oracle-guarded)
        if (tokenA != usdgAsset) {
            uint256 balA = IERC20(tokenA).balanceOf(address(this));
            uint256 swapA = (balA * shareRatio) / 1e18;
            if (swapA > 0) {
                uint256 minOutA = _oracleMinOut(tokenA, swapA, usdgAsset);
                IERC20(tokenA).forceApprove(address(executionRouter), swapA);
                uint256 outA = executionRouter.executeSwap(
                    tokenA,
                    usdgAsset,
                    swapA,
                    minOutA,
                    address(this)
                );
                emit PairSwap(tokenA, usdgAsset, swapA, outA);
            }
        }

        // Swap proportional tokenB back to USDG (oracle-guarded)
        if (tokenB != usdgAsset) {
            uint256 balB = IERC20(tokenB).balanceOf(address(this));
            uint256 swapB = (balB * shareRatio) / 1e18;
            if (swapB > 0) {
                uint256 minOutB = _oracleMinOut(tokenB, swapB, usdgAsset);
                IERC20(tokenB).forceApprove(address(executionRouter), swapB);
                uint256 outB = executionRouter.executeSwap(
                    tokenB,
                    usdgAsset,
                    swapB,
                    minOutB,
                    address(this)
                );
                emit PairSwap(tokenB, usdgAsset, swapB, outB);
            }
        }

        uint256 usdgAfter = IERC20(usdgAsset).balanceOf(address(this));
        uint256 availableUsdgAfter = usdgAfter > creatorEarningsUsdg
            ? usdgAfter - creatorEarningsUsdg
            : 0;

        // Swap proceeds
        uint256 swapProceeds = availableUsdgAfter > availableUsdgBefore
            ? availableUsdgAfter - availableUsdgBefore
            : 0;

        // Direct USDG share (if tokenA or tokenB is USDG)
        uint256 directShare = 0;
        if (tokenA == usdgAsset || tokenB == usdgAsset) {
            directShare = (availableUsdgBefore * shareRatio) / 1e18;
        }
        return directShare + swapProceeds;
    }

    // ─── Creator fees ───────────────────────────────────────

    /// @notice Creator withdraws accumulated USDG fees
    function claimCreatorFees() external returns (uint256 amount) {
        require(msg.sender == creator, "PairVault: not creator");
        amount = creatorEarningsUsdg;
        require(amount > 0, "PairVault: no fees");
        creatorEarningsUsdg = 0;
        IERC20(usdgAsset).safeTransfer(creator, amount);
        emit CreatorFeesClaimed(creator, amount);
    }
}
