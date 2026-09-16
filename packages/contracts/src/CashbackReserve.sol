// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {AllocationController} from "./AllocationController.sol";

interface IStrategyVaultView {
    function strategy() external view returns (AllocationController.Strategy);
}

/// @title CashbackReserve — holds Compose-funded Stockback inventory
/// @notice The deposit reward depends on the paying vault's strategy: each tier has
///         its own minimum deposit and flat USD reward. Deposits below a tier's
///         minimum earn nothing.
contract CashbackReserve is Ownable {
    using SafeERC20 for IERC20;

    struct RewardTier {
        uint256 minDepositUsd8;
        uint256 rewardUsd8;
    }

    mapping(AllocationController.Strategy => RewardTier) public rewardTiers;
    uint256 public maxRewardedDepositUsd8 = 10_000e8;
    uint256 public globalBudgetUsd8 = 100_000e8;
    uint256 public budgetSpentUsd8;
    uint256 public perWalletCapUsd8 = 50e8;
    bool public paused;

    /// @notice When set, every payout is checked against the oracle so a vault (or a
    ///         mispriced feed) can never pull more inventory than the USD reward is worth.
    OracleAdapter public oracle;
    /// @notice Tolerance on the oracle check, in bps (rounding + price drift within a block).
    uint256 public payoutToleranceBps = 100;

    mapping(address => uint256) public walletStockbackUsd8;
    mapping(address => uint256) public lastRewardTimestamp;
    uint256 public duplicateGuardSeconds = 86400;

    mapping(address => bool) public authorizedVaults;

    event StockbackPaid(address indexed wallet, address indexed token, uint256 amount, uint256 usdValue8);
    event BudgetUpdated(uint256 newBudget);
    event CashbackPaused(bool paused);
    event OracleUpdated(address indexed oracle, uint256 toleranceBps);
    event RewardTierUpdated(AllocationController.Strategy indexed strategy, uint256 minDepositUsd8, uint256 rewardUsd8);
    event PerWalletCapUpdated(uint256 perWalletCapUsd8);

    constructor(address owner_) Ownable(owner_) {
        _setRewardTier(AllocationController.Strategy.Defensive, 50e8, 0.77e8);
        _setRewardTier(AllocationController.Strategy.Balanced, 50e8, 2e8);
        _setRewardTier(AllocationController.Strategy.Aggressive, 150e8, 6e8);
    }

    function setAuthorizedVault(address vault, bool authorized) external onlyOwner {
        authorizedVaults[vault] = authorized;
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit CashbackPaused(paused_);
    }

    function setOracle(address oracle_, uint256 toleranceBps) external onlyOwner {
        require(toleranceBps <= 1_000, "CashbackReserve: tolerance too high");
        oracle = OracleAdapter(oracle_);
        payoutToleranceBps = toleranceBps;
        emit OracleUpdated(oracle_, toleranceBps);
    }

    function setGlobalBudget(uint256 budgetUsd8) external onlyOwner {
        globalBudgetUsd8 = budgetUsd8;
        emit BudgetUpdated(budgetUsd8);
    }

    function setRewardTier(
        AllocationController.Strategy strategy,
        uint256 minDepositUsd8,
        uint256 rewardUsd8
    ) external onlyOwner {
        _setRewardTier(strategy, minDepositUsd8, rewardUsd8);
    }

    function setPerWalletCap(uint256 perWalletCapUsd8_) external onlyOwner {
        perWalletCapUsd8 = perWalletCapUsd8_;
        emit PerWalletCapUpdated(perWalletCapUsd8_);
    }

    function _setRewardTier(AllocationController.Strategy strategy, uint256 minDepositUsd8, uint256 rewardUsd8) internal {
        rewardTiers[strategy] = RewardTier(minDepositUsd8, rewardUsd8);
        emit RewardTierUpdated(strategy, minDepositUsd8, rewardUsd8);
    }

    /// @notice Flat USD reward (8 decimals) a deposit into a vault of `strategy` earns.
    function rewardUsd8For(AllocationController.Strategy strategy) external view returns (uint256) {
        return rewardTiers[strategy].rewardUsd8;
    }

    function budgetRemaining() public view returns (uint256) {
        return globalBudgetUsd8 > budgetSpentUsd8 ? globalBudgetUsd8 - budgetSpentUsd8 : 0;
    }

    function canReward(
        AllocationController.Strategy strategy,
        address wallet,
        uint256 depositUsd8
    ) public view returns (bool) {
        RewardTier memory tier = rewardTiers[strategy];
        if (paused) return false;
        if (tier.rewardUsd8 == 0) return false;
        if (depositUsd8 < tier.minDepositUsd8) return false;
        if (budgetRemaining() < tier.rewardUsd8) return false;
        if (walletStockbackUsd8[wallet] >= perWalletCapUsd8) return false;
        if (
            lastRewardTimestamp[wallet] != 0 &&
            block.timestamp - lastRewardTimestamp[wallet] < duplicateGuardSeconds
        ) return false;
        return true;
    }

    function payDepositStockback(
        address wallet,
        address rewardToken,
        uint256 tokenAmount,
        uint256 depositUsd8
    ) external {
        require(authorizedVaults[msg.sender], "CashbackReserve: unauthorized");
        AllocationController.Strategy strategy = _strategyOf(msg.sender);
        require(canReward(strategy, wallet, depositUsd8), "CashbackReserve: ineligible");
        uint256 rewardUsd8 = rewardTiers[strategy].rewardUsd8;
        require(budgetRemaining() >= rewardUsd8, "CashbackReserve: budget exhausted");
        if (address(oracle) != address(0)) {
            uint256 paidUsd8 = oracle.getTokenValueUsd(rewardToken, tokenAmount);
            require(
                paidUsd8 <= (rewardUsd8 * (10_000 + payoutToleranceBps)) / 10_000,
                "CashbackReserve: amount exceeds reward"
            );
        }
        budgetSpentUsd8 += rewardUsd8;
        walletStockbackUsd8[wallet] += rewardUsd8;
        lastRewardTimestamp[wallet] = block.timestamp;
        IERC20(rewardToken).safeTransfer(msg.sender, tokenAmount);
        emit StockbackPaid(wallet, rewardToken, tokenAmount, rewardUsd8);
    }

    /// @dev Authorized callers are strategy vaults; a caller without a strategy() view
    ///      (e.g. an owner-authorized test harness) is treated as Balanced.
    function _strategyOf(address vault) internal view returns (AllocationController.Strategy) {
        try IStrategyVaultView(vault).strategy() returns (AllocationController.Strategy s) {
            return s;
        } catch {
            return AllocationController.Strategy.Balanced;
        }
    }

    function fund(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Recover inventory (e.g. when retiring a reward token).
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
