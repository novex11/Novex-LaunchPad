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
/// @notice The deposit reward is paid instantly and depends on the paying vault's
///         strategy and the deposit size: each strategy has ascending bands, and a
///         deposit earns the reward of the highest band it reaches. Deposits below the
///         first band earn nothing.
contract CashbackReserve is Ownable {
    using SafeERC20 for IERC20;

    /// @param minDepositUsd8 Smallest deposit (USD, 8 decimals) that earns `rewardUsd8`.
    struct RewardBand {
        uint256 minDepositUsd8;
        uint256 rewardUsd8;
    }

    uint256 public constant MAX_BANDS = 10;

    mapping(AllocationController.Strategy => RewardBand[]) internal _rewardBands;
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
    event RewardBandsUpdated(AllocationController.Strategy indexed strategy, RewardBand[] bands);
    event PerWalletCapUpdated(uint256 perWalletCapUsd8);

    constructor(address owner_) Ownable(owner_) {
        AllocationController.Strategy d = AllocationController.Strategy.Defensive;
        AllocationController.Strategy b = AllocationController.Strategy.Balanced;
        AllocationController.Strategy a = AllocationController.Strategy.Aggressive;
        _rewardBands[d].push(RewardBand(50e8, 0.77e8));
        _rewardBands[d].push(RewardBand(150e8, 1.5e8));
        _rewardBands[d].push(RewardBand(250e8, 2.5e8));
        _rewardBands[d].push(RewardBand(500e8, 5e8));
        _rewardBands[d].push(RewardBand(1_000e8, 10e8));
        _rewardBands[b].push(RewardBand(50e8, 2e8));
        _rewardBands[b].push(RewardBand(150e8, 3e8));
        _rewardBands[b].push(RewardBand(250e8, 4e8));
        _rewardBands[b].push(RewardBand(500e8, 7e8));
        _rewardBands[b].push(RewardBand(1_000e8, 12e8));
        _rewardBands[a].push(RewardBand(150e8, 6e8));
        _rewardBands[a].push(RewardBand(250e8, 8e8));
        _rewardBands[a].push(RewardBand(500e8, 12e8));
        _rewardBands[a].push(RewardBand(1_000e8, 20e8));
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

    /// @notice Replace a strategy's bands. Minimums must strictly ascend; an empty list
    ///         turns Stockback off for that strategy.
    function setRewardBands(AllocationController.Strategy strategy, RewardBand[] calldata bands) external onlyOwner {
        _setRewardBands(strategy, bands);
    }

    function setPerWalletCap(uint256 perWalletCapUsd8_) external onlyOwner {
        perWalletCapUsd8 = perWalletCapUsd8_;
        emit PerWalletCapUpdated(perWalletCapUsd8_);
    }

    function _setRewardBands(AllocationController.Strategy strategy, RewardBand[] memory bands) internal {
        require(bands.length <= MAX_BANDS, "CashbackReserve: too many bands");
        RewardBand[] storage stored = _rewardBands[strategy];
        while (stored.length > 0) stored.pop();
        for (uint256 i; i < bands.length; ++i) {
            require(i == 0 || bands[i].minDepositUsd8 > bands[i - 1].minDepositUsd8, "CashbackReserve: bands not ascending");
            stored.push(bands[i]);
        }
        emit RewardBandsUpdated(strategy, bands);
    }

    function rewardBands(AllocationController.Strategy strategy) external view returns (RewardBand[] memory) {
        return _rewardBands[strategy];
    }

    /// @notice Band reward (USD, 8 decimals) for a deposit into a vault of `strategy`,
    ///         before the wallet cap and budget.
    function rewardUsd8For(AllocationController.Strategy strategy, uint256 depositUsd8) public view returns (uint256 rewardUsd8) {
        RewardBand[] storage bands = _rewardBands[strategy];
        for (uint256 i; i < bands.length && depositUsd8 >= bands[i].minDepositUsd8; ++i) {
            rewardUsd8 = bands[i].rewardUsd8;
        }
    }

    function budgetRemaining() public view returns (uint256) {
        return globalBudgetUsd8 > budgetSpentUsd8 ? globalBudgetUsd8 - budgetSpentUsd8 : 0;
    }

    /// @notice Reward `wallet` would be paid now for this deposit, clamped to what is left
    ///         of its lifetime cap; 0 when ineligible (paused, below the first band, budget,
    ///         cap reached or within the duplicate guard).
    function quoteReward(
        AllocationController.Strategy strategy,
        address wallet,
        uint256 depositUsd8
    ) public view returns (uint256 rewardUsd8) {
        if (paused) return 0;
        if (
            lastRewardTimestamp[wallet] != 0 &&
            block.timestamp - lastRewardTimestamp[wallet] < duplicateGuardSeconds
        ) return 0;
        rewardUsd8 = rewardUsd8For(strategy, depositUsd8);
        uint256 used = walletStockbackUsd8[wallet];
        uint256 walletLeft = perWalletCapUsd8 > used ? perWalletCapUsd8 - used : 0;
        if (rewardUsd8 > walletLeft) rewardUsd8 = walletLeft;
        if (budgetRemaining() < rewardUsd8) return 0;
    }

    function canReward(
        AllocationController.Strategy strategy,
        address wallet,
        uint256 depositUsd8
    ) public view returns (bool) {
        return quoteReward(strategy, wallet, depositUsd8) > 0;
    }

    function payDepositStockback(
        address wallet,
        address rewardToken,
        uint256 tokenAmount,
        uint256 depositUsd8
    ) external {
        require(authorizedVaults[msg.sender], "CashbackReserve: unauthorized");
        uint256 rewardUsd8 = quoteReward(_strategyOf(msg.sender), wallet, depositUsd8);
        require(rewardUsd8 > 0, "CashbackReserve: ineligible");
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
