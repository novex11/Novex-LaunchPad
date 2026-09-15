// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CashbackReserve — holds Compose-funded Stockback inventory
contract CashbackReserve is Ownable {
    using SafeERC20 for IERC20;

    uint256 public minEligibleDepositUsd8 = 100e8;
    uint256 public maxRewardedDepositUsd8 = 10_000e8;
    uint256 public depositStockbackUsd8 = 2e8;
    uint256 public globalBudgetUsd8 = 100_000e8;
    uint256 public budgetSpentUsd8;
    uint256 public perWalletCapUsd8 = 50e8;
    bool public paused;

    mapping(address => uint256) public walletStockbackUsd8;
    mapping(address => uint256) public lastRewardTimestamp;
    uint256 public duplicateGuardSeconds = 86400;

    mapping(address => bool) public authorizedVaults;

    event StockbackPaid(address indexed wallet, address indexed token, uint256 amount, uint256 usdValue8);
    event BudgetUpdated(uint256 newBudget);
    event CashbackPaused(bool paused);

    constructor(address owner_) Ownable(owner_) {}

    function setAuthorizedVault(address vault, bool authorized) external onlyOwner {
        authorizedVaults[vault] = authorized;
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit CashbackPaused(paused_);
    }

    function budgetRemaining() public view returns (uint256) {
        return globalBudgetUsd8 > budgetSpentUsd8 ? globalBudgetUsd8 - budgetSpentUsd8 : 0;
    }

    function canReward(address wallet, uint256 depositUsd8) public view returns (bool) {
        if (paused) return false;
        if (depositUsd8 < minEligibleDepositUsd8) return false;
        if (budgetRemaining() < depositStockbackUsd8) return false;
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
        require(canReward(wallet, depositUsd8), "CashbackReserve: ineligible");
        uint256 rewardUsd8 = depositStockbackUsd8;
        require(budgetRemaining() >= rewardUsd8, "CashbackReserve: budget exhausted");
        budgetSpentUsd8 += rewardUsd8;
        walletStockbackUsd8[wallet] += rewardUsd8;
        lastRewardTimestamp[wallet] = block.timestamp;
        IERC20(rewardToken).safeTransfer(msg.sender, tokenAmount);
        emit StockbackPaid(wallet, rewardToken, tokenAmount, rewardUsd8);
    }

    function fund(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}
