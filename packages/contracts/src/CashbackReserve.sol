// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OracleAdapter} from "./OracleAdapter.sol";

/// @title CashbackReserve — holds Compose-funded Stockback inventory
/// @notice A deposit earns a percentage of its USD value as Stockback, capped per
///         deposit and per wallet, the same for every strategy. The reward is not paid
///         at deposit: it is granted, its inventory is set aside, and it vests after
///         `vestingPeriod`. Redeeming shares before a grant vests forfeits it, so
///         deposit-and-redeem loops earn nothing.
contract CashbackReserve is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @param shares Vault shares the deposit minted; they must stay held until unlockAt.
    struct Grant {
        address token;
        uint64 unlockAt;
        uint256 amount;
        uint256 rewardUsd8;
        uint256 shares;
    }

    uint256 public constant MAX_REWARD_BPS = 1_000;
    uint256 public constant MAX_VESTING_PERIOD = 90 days;

    uint256 public rewardBps = 100;
    uint256 public minDepositUsd8 = 50e8;
    uint256 public maxRewardPerDepositUsd8 = 10e8;
    uint256 public perWalletCapUsd8 = 25e8;
    uint256 public vestingPeriod = 7 days;
    /// @notice Bounds the per-(vault, wallet) grant list so claim and redeem stay cheap.
    uint256 public maxPendingGrants = 20;
    uint256 public globalBudgetUsd8 = 100_000e8;
    /// @notice USD granted and not forfeited (pending + claimed).
    uint256 public budgetSpentUsd8;
    bool public paused;

    /// @notice When set, every grant is checked against the oracle so a vault (or a
    ///         mispriced feed) can never reserve more inventory than the USD reward is worth.
    OracleAdapter public oracle;
    /// @notice Tolerance on the oracle check, in bps (rounding + price drift within a block).
    uint256 public payoutToleranceBps = 100;

    /// @notice USD Stockback granted to a wallet and not forfeited (pending + claimed).
    mapping(address => uint256) public walletStockbackUsd8;
    /// @notice Inventory owed to open grants; never withdrawable by the owner.
    mapping(address => uint256) public reservedAmount;
    mapping(address => bool) public authorizedVaults;

    mapping(address vault => mapping(address wallet => Grant[])) internal _grants;

    event StockbackGranted(
        address indexed wallet,
        address indexed vault,
        address indexed token,
        uint256 amount,
        uint256 usdValue8,
        uint64 unlockAt
    );
    event StockbackForfeited(
        address indexed wallet, address indexed vault, address indexed token, uint256 amount, uint256 usdValue8
    );
    event StockbackPaid(address indexed wallet, address indexed token, uint256 amount, uint256 usdValue8);
    event BudgetUpdated(uint256 newBudget);
    event CashbackPaused(bool paused);
    event OracleUpdated(address indexed oracle, uint256 toleranceBps);
    event RewardParamsUpdated(uint256 rewardBps, uint256 minDepositUsd8, uint256 maxRewardPerDepositUsd8);
    event PerWalletCapUpdated(uint256 perWalletCapUsd8);
    event VestingUpdated(uint256 vestingPeriod, uint256 maxPendingGrants);

    constructor(address owner_) Ownable(owner_) {}

    // ─── Admin ──────────────────────────────────────────────

    function setAuthorizedVault(address vault, bool authorized) external onlyOwner {
        authorizedVaults[vault] = authorized;
    }

    /// @notice Stops new grants. Claims and forfeits keep working.
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

    function setRewardParams(uint256 rewardBps_, uint256 minDepositUsd8_, uint256 maxRewardPerDepositUsd8_)
        external
        onlyOwner
    {
        require(rewardBps_ <= MAX_REWARD_BPS, "CashbackReserve: rate too high");
        rewardBps = rewardBps_;
        minDepositUsd8 = minDepositUsd8_;
        maxRewardPerDepositUsd8 = maxRewardPerDepositUsd8_;
        emit RewardParamsUpdated(rewardBps_, minDepositUsd8_, maxRewardPerDepositUsd8_);
    }

    function setPerWalletCap(uint256 perWalletCapUsd8_) external onlyOwner {
        perWalletCapUsd8 = perWalletCapUsd8_;
        emit PerWalletCapUpdated(perWalletCapUsd8_);
    }

    /// @notice Applies to new grants only; open grants keep their unlock time.
    function setVesting(uint256 vestingPeriod_, uint256 maxPendingGrants_) external onlyOwner {
        require(vestingPeriod_ <= MAX_VESTING_PERIOD, "CashbackReserve: vesting too long");
        require(maxPendingGrants_ > 0 && maxPendingGrants_ <= 50, "CashbackReserve: bad grant limit");
        vestingPeriod = vestingPeriod_;
        maxPendingGrants = maxPendingGrants_;
        emit VestingUpdated(vestingPeriod_, maxPendingGrants_);
    }

    function fund(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Recover inventory that is not owed to an open grant.
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        require(amount <= availableInventory(token), "CashbackReserve: inventory reserved");
        IERC20(token).safeTransfer(to, amount);
    }

    // ─── Views ──────────────────────────────────────────────

    function budgetRemaining() public view returns (uint256) {
        return globalBudgetUsd8 > budgetSpentUsd8 ? globalBudgetUsd8 - budgetSpentUsd8 : 0;
    }

    function availableInventory(address token) public view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        return bal > reservedAmount[token] ? bal - reservedAmount[token] : 0;
    }

    /// @notice USD reward (8 decimals) a deposit of `depositUsd8` by `wallet` would be
    ///         granted now; 0 when ineligible. Inventory is checked at grant time.
    function quoteReward(address wallet, uint256 depositUsd8) public view returns (uint256 rewardUsd8) {
        if (paused || rewardBps == 0 || depositUsd8 < minDepositUsd8) return 0;
        rewardUsd8 = (depositUsd8 * rewardBps) / 10_000;
        if (rewardUsd8 > maxRewardPerDepositUsd8) rewardUsd8 = maxRewardPerDepositUsd8;
        uint256 walletUsed = walletStockbackUsd8[wallet];
        uint256 walletLeft = perWalletCapUsd8 > walletUsed ? perWalletCapUsd8 - walletUsed : 0;
        if (rewardUsd8 > walletLeft) rewardUsd8 = walletLeft;
        uint256 budgetLeft = budgetRemaining();
        if (rewardUsd8 > budgetLeft) rewardUsd8 = budgetLeft;
    }

    function grantsOf(address vault, address wallet) external view returns (Grant[] memory) {
        return _grants[vault][wallet];
    }

    /// @notice Vested Stockback `wallet` can claim from `vault` now.
    function claimable(address vault, address wallet) external view returns (uint256 amount, uint256 usd8) {
        Grant[] storage list = _grants[vault][wallet];
        for (uint256 i; i < list.length; ++i) {
            if (list[i].unlockAt <= block.timestamp) {
                amount += list[i].amount;
                usd8 += list[i].rewardUsd8;
            }
        }
    }

    /// @notice Stockback still vesting, and the earliest time any of it unlocks (0 if none).
    function pending(address vault, address wallet)
        external
        view
        returns (uint256 amount, uint256 usd8, uint64 nextUnlockAt)
    {
        Grant[] storage list = _grants[vault][wallet];
        for (uint256 i; i < list.length; ++i) {
            if (list[i].unlockAt > block.timestamp) {
                amount += list[i].amount;
                usd8 += list[i].rewardUsd8;
                if (nextUnlockAt == 0 || list[i].unlockAt < nextUnlockAt) nextUnlockAt = list[i].unlockAt;
            }
        }
    }

    // ─── Vault hooks ────────────────────────────────────────

    /// @notice Called by a vault after minting `shares` for a deposit. Sets aside
    ///         `tokenAmount` of `token` for `wallet`, claimable after the vesting period.
    function grantStockback(address wallet, address token, uint256 tokenAmount, uint256 depositUsd8, uint256 shares)
        external
        nonReentrant
        returns (uint256 rewardUsd8)
    {
        require(authorizedVaults[msg.sender], "CashbackReserve: unauthorized");
        rewardUsd8 = quoteReward(wallet, depositUsd8);
        require(rewardUsd8 > 0 && tokenAmount > 0, "CashbackReserve: ineligible");
        Grant[] storage list = _grants[msg.sender][wallet];
        require(list.length < maxPendingGrants, "CashbackReserve: too many grants");
        require(tokenAmount <= availableInventory(token), "CashbackReserve: inventory");
        if (address(oracle) != address(0)) {
            uint256 valueUsd8 = oracle.getTokenValueUsd(token, tokenAmount);
            require(
                valueUsd8 <= (rewardUsd8 * (10_000 + payoutToleranceBps)) / 10_000,
                "CashbackReserve: amount exceeds reward"
            );
        }

        uint64 unlockAt = uint64(block.timestamp + vestingPeriod);
        budgetSpentUsd8 += rewardUsd8;
        walletStockbackUsd8[wallet] += rewardUsd8;
        reservedAmount[token] += tokenAmount;
        list.push(Grant({token: token, unlockAt: unlockAt, amount: tokenAmount, rewardUsd8: rewardUsd8, shares: shares}));
        emit StockbackGranted(wallet, msg.sender, token, tokenAmount, rewardUsd8, unlockAt);
    }

    /// @notice Called by a vault after `wallet` redeems, with the shares it still holds.
    ///         Forfeits the newest unvested grants until the shares backing the remaining
    ///         unvested grants fit in `remainingShares`. Vested grants are never forfeited.
    /// @dev Unauthenticated on purpose: it only touches grants keyed by msg.sender, and a
    ///      vault that has since been deauthorized must still be able to forfeit.
    function onRedeem(address wallet, uint256 remainingShares) external nonReentrant {
        Grant[] storage list = _grants[msg.sender][wallet];
        uint256 len = list.length;
        if (len == 0) return;

        uint256 unvestedShares;
        for (uint256 i; i < len; ++i) {
            if (list[i].unlockAt > block.timestamp) unvestedShares += list[i].shares;
        }
        if (unvestedShares <= remainingShares) return;

        // Walk newest → oldest, dropping unvested grants; kept grants pack to the back.
        uint256 write = len;
        for (uint256 i = len; i > 0; --i) {
            Grant memory g = list[i - 1];
            if (unvestedShares > remainingShares && g.unlockAt > block.timestamp) {
                unvestedShares -= g.shares;
                _release(wallet, g);
                emit StockbackForfeited(wallet, msg.sender, g.token, g.amount, g.rewardUsd8);
            } else {
                list[--write] = g;
            }
        }

        uint256 kept = len - write;
        for (uint256 i; i < kept; ++i) {
            list[i] = list[write + i];
        }
        while (list.length > kept) list.pop();
    }

    // ─── Claim ──────────────────────────────────────────────

    /// @notice Pays `wallet` every vested grant from `vault`. Anyone may call it; the
    ///         Stockback always goes to the wallet that earned it.
    function claim(address vault, address wallet) external nonReentrant returns (uint256 amountPaid, uint256 usdPaid8) {
        return _claim(vault, wallet);
    }

    function claimMany(address[] calldata vaults, address wallet) external nonReentrant {
        for (uint256 i; i < vaults.length; ++i) {
            _claim(vaults[i], wallet);
        }
    }

    // ─── Internal ───────────────────────────────────────────

    function _claim(address vault, address wallet) internal returns (uint256 amountPaid, uint256 usdPaid8) {
        Grant[] storage list = _grants[vault][wallet];
        uint256 len = list.length;
        uint256 write;
        for (uint256 i; i < len; ++i) {
            Grant memory g = list[i];
            if (g.unlockAt <= block.timestamp) {
                reservedAmount[g.token] -= g.amount;
                amountPaid += g.amount;
                usdPaid8 += g.rewardUsd8;
                IERC20(g.token).safeTransfer(wallet, g.amount);
                emit StockbackPaid(wallet, g.token, g.amount, g.rewardUsd8);
            } else {
                list[write++] = g;
            }
        }
        while (list.length > write) list.pop();
    }

    function _release(address wallet, Grant memory g) internal {
        reservedAmount[g.token] -= g.amount;
        budgetSpentUsd8 -= g.rewardUsd8;
        walletStockbackUsd8[wallet] -= g.rewardUsd8;
    }
}
