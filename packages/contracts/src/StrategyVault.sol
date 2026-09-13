// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReceiptToken} from "./ReceiptToken.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {AllocationController} from "./AllocationController.sol";
import {CashbackReserve} from "./CashbackReserve.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";
import {ExecutionRouter} from "./ExecutionRouter.sol";

/// @title StrategyVault — ERC-4626-style vault for managed stock baskets
contract StrategyVault is Ownable {
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

    event Deposited(
        address indexed user,
        uint256 amountIn,
        uint256 sharesMinted,
        uint256 navUsd8AtDeposit
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

    // ─── Views ──────────────────────────────────────────────

    function basketTokenCount() external view returns (uint256) {
        return basketTokens.length;
    }

    function sharePrice() public view returns (uint256) {
        if (totalShares == 0) return 1e18;
        return (navUsd8() * 1e18) / totalShares;
    }

    /// @notice Net asset value: sum of all basket token balances priced via oracle
    function navUsd8() public view returns (uint256 total) {
        for (uint256 i; i < basketTokens.length; ++i) {
            address token = basketTokens[i];
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) {
                total += oracle.getTokenValueUsd(token, bal);
            }
        }
    }

    // ─── Deposit ────────────────────────────────────────────

    function deposit(DepositParams calldata params) external returns (uint256 sharesMinted) {
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

        // Snapshot NAV and price BEFORE transfer (fixes share-dilution bug)
        uint256 navBefore = navUsd8();
        uint256 priceBefore = totalShares == 0
            ? 1e18
            : (navBefore * 1e18) / totalShares;

        uint256 depositValue8 = oracle.getTokenValueUsd(depositAsset, params.amount);
        require(navBefore + depositValue8 <= tvlCapUsd8, "StrategyVault: TVL cap");

        // Pull deposit asset from user
        IERC20(depositAsset).safeTransferFrom(msg.sender, address(this), params.amount);

        // Execute basket swaps via ExecutionRouter
        _executeBasketSwaps(params);

        // Mint receipt shares based on pre-transfer price
        sharesMinted = (depositValue8 * 1e18) / priceBefore;
        require(sharesMinted >= params.minShares, "StrategyVault: slippage");
        totalShares += sharesMinted;
        receiptToken.mint(msg.sender, sharesMinted);

        // Try to pay Stockback cashback to user
        _tryCashback(msg.sender, depositValue8);

        emit Deposited(msg.sender, params.amount, sharesMinted, navUsd8());
    }

    function _executeBasketSwaps(DepositParams calldata params) internal {
        uint256 totalSwapAmount;

        // First pass: register tokens and tally swap total
        for (uint256 i; i < params.basketTokens.length; ++i) {
            address token = params.basketTokens[i];

            if (!isBasketToken[token]) {
                isBasketToken[token] = true;
                basketTokens.push(token);
            }

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

            uint256 amountOut = executionRouter.executeSwap(
                depositAsset,
                token,
                legAmount,
                0, // per-leg minOut: overall minShares protects against slippage
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

    function redeem(uint256 shares, RedeemMode mode, uint256 minOut) external {
        require(shares > 0, "StrategyVault: zero shares");
        require(
            receiptToken.balanceOf(msg.sender) >= shares,
            "StrategyVault: insufficient shares"
        );

        // Compute value and ratio BEFORE burning
        uint256 price = sharePrice();
        uint256 valueUsd8 = (shares * price) / 1e18;
        uint256 shareRatio = (shares * 1e18) / totalShares;

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
                totalValueUsd8 += oracle.getTokenValueUsd(token, amountOut);
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
