// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ReceiptToken} from "./ReceiptToken.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {AllocationController} from "./AllocationController.sol";
import {CashbackReserve} from "./CashbackReserve.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";
import {ExecutionRouter} from "./ExecutionRouter.sol";

/// @title StrategyVault — ERC-4626-style vault for managed stock baskets
contract StrategyVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ReceiptToken public receiptToken;
    OracleAdapter public oracle;
    AllocationController public controller;
    CashbackReserve public cashbackReserve;
    EmergencyRegistry public emergency;
    ExecutionRouter public executionRouter;

    address public depositAsset;
    address public immutable usdStableAsset;
    AllocationController.Strategy public strategy;
    uint256 public totalShares;
    uint256 public tvlCapUsd8;

    address[] public basketTokens;
    mapping(address => bool) public isBasketToken;

    struct DepositParams {
        uint256 amount;
        address[] basketTokens;
        uint256[] basketWeightsBps;
        uint256 minShares;
    }

    enum RedeemMode {
        OriginalAsset,
        ProportionalBasket,
        UsdStable
    }

    /// @param valueUsd8 USD value (8 decimals) the deposit added to the vault after swaps
    event Deposited(
        address indexed user,
        uint256 amountIn,
        uint256 sharesMinted,
        uint256 valueUsd8
    );
    event Redeemed(
        address indexed user,
        uint256 sharesBurned,
        RedeemMode mode,
        uint256 valueUsd8
    );
    event BasketSwap(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event CashbackForwarded(address indexed user, uint256 amount);
    event TvlCapUpdated(uint256 tvlCapUsd8);

    constructor(
        address owner_,
        address depositAsset_,
        AllocationController.Strategy strategy_,
        address receiptToken_,
        address oracle_,
        address controller_,
        address cashback_,
        address emergency_,
        address executionRouter_,
        address usdStableAsset_,
        uint256 tvlCapUsd8_
    ) Ownable(owner_) {
        depositAsset = depositAsset_;
        usdStableAsset = usdStableAsset_;
        strategy = strategy_;
        receiptToken = ReceiptToken(receiptToken_);
        oracle = OracleAdapter(oracle_);
        controller = AllocationController(controller_);
        cashbackReserve = CashbackReserve(cashback_);
        emergency = EmergencyRegistry(emergency_);
        executionRouter = ExecutionRouter(executionRouter_);
        tvlCapUsd8 = tvlCapUsd8_;
    }

    // ─── Admin ──────────────────────────────────────────────

    /// @notice Raise or lower the USD TVL cap (owner is the VaultFactory for factory vaults).
    function setTvlCapUsd8(uint256 newCap) external onlyOwner {
        tvlCapUsd8 = newCap;
        emit TvlCapUpdated(newCap);
    }

    // ─── Views ──────────────────────────────────────────────

    function basketTokenCount() external view returns (uint256) {
        return basketTokens.length;
    }

    function sharePrice() public view returns (uint256) {
        if (totalShares == 0) return 1e18;
        return (navUsd8() * 1e18) / totalShares;
    }

    /// @notice Net asset value: sum of all basket token balances priced via oracle
    ///         (staleness-checked, so deposits never mint against a dead feed).
    function navUsd8() public view returns (uint256 total) {
        for (uint256 i; i < basketTokens.length; ++i) {
            address token = basketTokens[i];
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) {
                total += oracle.getTokenValueUsd(token, bal);
            }
        }
    }

    /// @notice NAV using the latest feed answers without the staleness check, so a
    ///         late keeper can never lock holders out of redeeming.
    function navUsd8Unchecked() public view returns (uint256 total) {
        for (uint256 i; i < basketTokens.length; ++i) {
            address token = basketTokens[i];
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) {
                total += _tokenValueUnchecked(token, bal);
            }
        }
    }

    function _tokenValueUnchecked(address token, uint256 rawAmount) internal view returns (uint256) {
        uint256 price = oracle.getPriceUnchecked(token);
        return (rawAmount * price) / (10 ** IERC20Metadata(token).decimals());
    }

    // ─── Deposit ────────────────────────────────────────────

    function deposit(DepositParams calldata params) external nonReentrant returns (uint256 sharesMinted) {
        require(params.amount > 0, "StrategyVault: zero amount");
        require(!emergency.depositsPaused(), "StrategyVault: deposits paused");
        require(
            !oracle.isMultiplierPending(depositAsset),
            "StrategyVault: multiplier pending"
        );

        (bool valid, string memory reason) = controller.validateAllocation(
            strategy,
            params.basketTokens,
            params.basketWeightsBps
        );
        require(valid, reason);

        // The retained (un-swapped) part of every deposit stays in the vault, so the
        // deposit asset always counts toward NAV even when it is not a basket line.
        _registerBasketToken(depositAsset);

        // Snapshot NAV and price BEFORE transfer so existing holders are not diluted
        uint256 navBefore = navUsd8();
        uint256 priceBefore = totalShares == 0
            ? 1e18
            : (navBefore * 1e18) / totalShares;
        require(priceBefore > 0, "StrategyVault: zero price");

        uint256 depositValue8 = oracle.getTokenValueUsd(depositAsset, params.amount);
        require(depositValue8 > 0, "StrategyVault: zero value");
        require(navBefore + depositValue8 <= tvlCapUsd8, "StrategyVault: TVL cap");

        // Pull deposit asset from user
        IERC20(depositAsset).safeTransferFrom(msg.sender, address(this), params.amount);

        // Execute basket swaps via ExecutionRouter
        _executeBasketSwaps(params);

        // Mint shares for the value that actually landed in the vault after swaps, so
        // swap slippage is borne by the depositor (and bounded by minShares) instead of
        // diluting existing holders.
        uint256 navAfter = navUsd8();
        uint256 valueAdded8 = navAfter > navBefore ? navAfter - navBefore : 0;
        sharesMinted = (valueAdded8 * 1e18) / priceBefore;
        require(sharesMinted > 0, "StrategyVault: zero shares");
        require(sharesMinted >= params.minShares, "StrategyVault: slippage");
        totalShares += sharesMinted;
        receiptToken.mint(msg.sender, sharesMinted);

        // Try to pay Stockback cashback to user
        _tryCashback(msg.sender, depositValue8);

        emit Deposited(msg.sender, params.amount, sharesMinted, valueAdded8);
    }

    function _registerBasketToken(address token) internal {
        if (!isBasketToken[token]) {
            isBasketToken[token] = true;
            basketTokens.push(token);
        }
    }

    function _executeBasketSwaps(DepositParams calldata params) internal {
        uint256 totalSwapAmount;

        // First pass: register tokens and tally swap total
        for (uint256 i; i < params.basketTokens.length; ++i) {
            address token = params.basketTokens[i];
            _registerBasketToken(token);

            if (token == depositAsset) continue;
            uint256 legAmount = (params.amount * params.basketWeightsBps[i]) / 10_000;
            if (legAmount == 0) continue;
            totalSwapAmount += legAmount;
        }

        if (totalSwapAmount == 0) return;

        // Approve router for total swap amount
        IERC20(depositAsset).forceApprove(address(executionRouter), totalSwapAmount);

        // Second pass: execute each swap leg
        for (uint256 i; i < params.basketTokens.length; ++i) {
            address token = params.basketTokens[i];
            if (token == depositAsset) continue;
            uint256 legAmount = (params.amount * params.basketWeightsBps[i]) / 10_000;
            if (legAmount == 0) continue;

            // Per-leg floor: ExecutionRouter enforces its oracle-based maxSlippageBps
            // on every swap; minShares bounds the total value received.
            uint256 amountOut = executionRouter.executeSwap(
                depositAsset,
                token,
                legAmount,
                0,
                address(this)
            );

            emit BasketSwap(depositAsset, token, legAmount, amountOut);
        }
    }

    function _tryCashback(address user, uint256 depositUsd8) internal {
        if (address(cashbackReserve) == address(0)) return;

        uint256 rewardTokenPrice = oracle.getPrice(depositAsset);
        if (rewardTokenPrice == 0) return;

        uint256 rewardUsd8 = cashbackReserve.depositStockbackUsd8();
        uint256 rewardAmount = (rewardUsd8 * 1e18) / rewardTokenPrice;
        if (rewardAmount == 0) return;

        // payDepositStockback sends reward tokens to this vault; we forward to user.
        // Wrapped in try/catch so deposits succeed even if cashback fails.
        try cashbackReserve.payDepositStockback(
            user,
            depositAsset,
            rewardAmount,
            depositUsd8
        ) {
            IERC20(depositAsset).safeTransfer(user, rewardAmount);
            emit CashbackForwarded(user, rewardAmount);
        } catch {
            // Cashback unavailable — deposit still succeeds
        }
    }

    // ─── Redeem ─────────────────────────────────────────────

    function redeem(uint256 shares, RedeemMode mode, uint256 minOut) external nonReentrant {
        require(shares > 0, "StrategyVault: zero shares");
        require(
            receiptToken.balanceOf(msg.sender) >= shares,
            "StrategyVault: insufficient shares"
        );

        // Compute value and ratio BEFORE burning. Valuation uses unchecked prices so
        // exits stay possible while a feed is stale; swap-based modes still go
        // through the router's oracle floor.
        uint256 shareRatio = (shares * 1e18) / totalShares;
        uint256 valueUsd8 = (navUsd8Unchecked() * shareRatio) / 1e18;

        // Burn receipt shares
        receiptToken.burn(msg.sender, shares);
        totalShares -= shares;

        if (mode == RedeemMode.OriginalAsset) {
            _redeemOriginalAsset(shareRatio, minOut);
        } else if (mode == RedeemMode.ProportionalBasket) {
            _redeemProportionalBasket(shareRatio, minOut);
        } else {
            _redeemUsdStable(shareRatio, minOut);
        }

        emit Redeemed(msg.sender, shares, mode, valueUsd8);
    }

    /// @dev Swap basket tokens back to deposit asset, then transfer to redeemer
    function _redeemOriginalAsset(uint256 shareRatio, uint256 minOut) internal {
        uint256 depositBalBefore = IERC20(depositAsset).balanceOf(address(this));

        // Swap user's proportional share of each non-deposit token back
        for (uint256 i; i < basketTokens.length; ++i) {
            address token = basketTokens[i];
            if (token == depositAsset) continue;
            uint256 tokenBal = IERC20(token).balanceOf(address(this));
            uint256 swapAmount = (tokenBal * shareRatio) / 1e18;
            if (swapAmount == 0) continue;

            IERC20(token).forceApprove(address(executionRouter), swapAmount);
            uint256 amountOut = executionRouter.executeSwap(
                token,
                depositAsset,
                swapAmount,
                0,
                address(this)
            );
            emit BasketSwap(token, depositAsset, swapAmount, amountOut);
        }

        uint256 depositBalAfter = IERC20(depositAsset).balanceOf(address(this));
        uint256 swapProceeds = depositBalAfter - depositBalBefore;

        // User gets proportional deposit asset + swap proceeds
        uint256 directAmount = (depositBalBefore * shareRatio) / 1e18;
        uint256 totalOut = directAmount + swapProceeds;

        require(totalOut >= minOut, "StrategyVault: min output");
        if (totalOut > 0) {
            IERC20(depositAsset).safeTransfer(msg.sender, totalOut);
        }
    }

    /// @dev Transfer proportional share of every basket token directly
    function _redeemProportionalBasket(uint256 shareRatio, uint256 minOut) internal {
        uint256 totalValueUsd8;
        for (uint256 i; i < basketTokens.length; ++i) {
            address token = basketTokens[i];
            uint256 tokenBal = IERC20(token).balanceOf(address(this));
            uint256 amountOut = (tokenBal * shareRatio) / 1e18;
            if (amountOut > 0) {
                IERC20(token).safeTransfer(msg.sender, amountOut);
                totalValueUsd8 += _tokenValueUnchecked(token, amountOut);
            }
        }
        // minOut interpreted as USD8 minimum for proportional mode
        require(totalValueUsd8 >= minOut, "StrategyVault: min output");
    }

    /// @dev Swap basket tokens to USD stable (USDG), then transfer to redeemer
    function _redeemUsdStable(uint256 shareRatio, uint256 minOut) internal {
        require(usdStableAsset != address(0), "StrategyVault: no stable asset");

        uint256 stableBalBefore = IERC20(usdStableAsset).balanceOf(address(this));

        for (uint256 i; i < basketTokens.length; ++i) {
            address token = basketTokens[i];
            if (token == usdStableAsset) continue;
            uint256 tokenBal = IERC20(token).balanceOf(address(this));
            uint256 swapAmount = (tokenBal * shareRatio) / 1e18;
            if (swapAmount == 0) continue;

            IERC20(token).forceApprove(address(executionRouter), swapAmount);
            uint256 amountOut = executionRouter.executeSwap(
                token,
                usdStableAsset,
                swapAmount,
                0,
                address(this)
            );
            emit BasketSwap(token, usdStableAsset, swapAmount, amountOut);
        }

        uint256 stableBalAfter = IERC20(usdStableAsset).balanceOf(address(this));
        uint256 swapProceeds = stableBalAfter - stableBalBefore;
        uint256 directStable = (stableBalBefore * shareRatio) / 1e18;
        uint256 totalOut = directStable + swapProceeds;

        require(totalOut >= minOut, "StrategyVault: min output");
        if (totalOut > 0) {
            IERC20(usdStableAsset).safeTransfer(msg.sender, totalOut);
        }
    }
}
