// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {ReceiptToken} from "../src/ReceiptToken.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockUniswapV3Router} from "../src/mocks/MockUniswapV3Router.sol";

/// @dev Stands in for a strategy vault calling the reserve hooks.
contract GrantCaller {
    CashbackReserve reserve;

    constructor(CashbackReserve reserve_) {
        reserve = reserve_;
    }

    function grant(address wallet, address token, uint256 amount, uint256 depositUsd8, uint256 shares) external {
        reserve.grantStockback(wallet, token, amount, depositUsd8, shares);
    }

    function redeemed(address wallet, uint256 remainingShares) external {
        reserve.onRedeem(wallet, remainingShares);
    }
}

contract StockbackVestingReserveTest is Test {
    OracleAdapter oracle;
    MockOracle nvdaFeed;
    CashbackReserve cashback;
    MockERC20 nvda;
    GrantCaller vault;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    // NVDA at $500: $1 = 0.002 NVDA
    uint256 constant PER_USD = 0.002 ether;

    function setUp() public {
        nvda = new MockERC20("NVDA", "NVDA");
        oracle = new OracleAdapter(address(this));
        nvdaFeed = new MockOracle(500e8);
        oracle.setPriceFeed(address(nvda), address(nvdaFeed));
        cashback = new CashbackReserve(address(this));
        cashback.setOracle(address(oracle), 100);
        nvda.approve(address(cashback), 10 ether);
        cashback.fund(address(nvda), 10 ether);
        vault = new GrantCaller(cashback);
        cashback.setAuthorizedVault(address(vault), true);
    }

    function _grant(address wallet, uint256 depositUsd8, uint256 shares) internal returns (uint256 rewardUsd8) {
        nvdaFeed.setPrice(500e8); // keep the feed fresh across warps
        rewardUsd8 = cashback.quoteReward(wallet, depositUsd8);
        vault.grant(wallet, address(nvda), (rewardUsd8 * PER_USD) / 1e8, depositUsd8, shares);
    }

    function test_Defaults() public view {
        assertEq(cashback.rewardBps(), 100);
        assertEq(cashback.minDepositUsd8(), 50e8);
        assertEq(cashback.maxRewardPerDepositUsd8(), 10e8);
        assertEq(cashback.perWalletCapUsd8(), 25e8);
        assertEq(cashback.vestingPeriod(), 7 days);
    }

    function test_QuoteIsOnePercentCapped() public view {
        assertEq(cashback.quoteReward(alice, 49.99e8), 0, "below $50");
        assertEq(cashback.quoteReward(alice, 50e8), 0.5e8);
        assertEq(cashback.quoteReward(alice, 300e8), 3e8, "$300 -> $3");
        assertEq(cashback.quoteReward(alice, 1_000e8), 10e8);
        assertEq(cashback.quoteReward(alice, 50_000e8), 10e8, "per-deposit cap");
    }

    function test_WalletCapAcrossDeposits() public {
        assertEq(_grant(alice, 1_500e8, 1), 10e8);
        assertEq(_grant(alice, 1_500e8, 1), 10e8);
        assertEq(cashback.quoteReward(alice, 1_500e8), 5e8, "clamped to wallet remainder");
        _grant(alice, 1_500e8, 1);
        assertEq(cashback.walletStockbackUsd8(alice), 25e8);
        assertEq(cashback.quoteReward(alice, 1_500e8), 0);
        vm.expectRevert(bytes("CashbackReserve: ineligible"));
        vault.grant(alice, address(nvda), 1, 1_500e8, 1);
        assertEq(cashback.quoteReward(bob, 1_500e8), 10e8, "other wallets unaffected");
    }

    function test_OnlyAuthorizedVaultsGrant() public {
        vm.expectRevert(bytes("CashbackReserve: unauthorized"));
        cashback.grantStockback(alice, address(nvda), PER_USD, 300e8, 1);
    }

    function test_NothingClaimableUntilVested() public {
        _grant(alice, 300e8, 100e8);
        (uint256 claimableAmt,) = cashback.claimable(address(vault), alice);
        assertEq(claimableAmt, 0);
        (uint256 pendingAmt, uint256 pendingUsd, uint64 unlockAt) = cashback.pending(address(vault), alice);
        assertEq(pendingAmt, 3 * PER_USD);
        assertEq(pendingUsd, 3e8);
        assertEq(unlockAt, block.timestamp + 7 days);

        cashback.claim(address(vault), alice);
        assertEq(nvda.balanceOf(alice), 0, "claim before vesting pays nothing");

        vm.warp(block.timestamp + 7 days);
        // Anyone may trigger the claim; the wallet receives it.
        vm.prank(bob);
        (uint256 paid, uint256 usd) = cashback.claim(address(vault), alice);
        assertEq(paid, 3 * PER_USD);
        assertEq(usd, 3e8);
        assertEq(nvda.balanceOf(alice), 3 * PER_USD);
        assertEq(nvda.balanceOf(bob), 0);
        assertEq(cashback.reservedAmount(address(nvda)), 0);
        assertEq(cashback.grantsOf(address(vault), alice).length, 0);
        assertEq(cashback.walletStockbackUsd8(alice), 3e8, "claimed Stockback still counts toward the cap");

        cashback.claim(address(vault), alice);
        assertEq(nvda.balanceOf(alice), 3 * PER_USD, "no double claim");
    }

    function test_FullRedeemForfeitsUnvested() public {
        _grant(alice, 300e8, 100e8);
        vault.redeemed(alice, 0);
        assertEq(cashback.walletStockbackUsd8(alice), 0, "cap freed");
        assertEq(cashback.budgetSpentUsd8(), 0, "budget returned");
        assertEq(cashback.reservedAmount(address(nvda)), 0, "inventory released");
        assertEq(cashback.grantsOf(address(vault), alice).length, 0);
        vm.warp(block.timestamp + 7 days);
        cashback.claim(address(vault), alice);
        assertEq(nvda.balanceOf(alice), 0);
    }

    function test_PartialRedeemForfeitsNewestFirst() public {
        _grant(alice, 300e8, 300e8); // $3, oldest
        vm.warp(block.timestamp + 1 days);
        _grant(alice, 500e8, 500e8); // $5, newest

        // Still holds 400 of 800 shares: dropping the newest grant (500) leaves 300 <= 400.
        vault.redeemed(alice, 400e8);
        CashbackReserve.Grant[] memory g = cashback.grantsOf(address(vault), alice);
        assertEq(g.length, 1);
        assertEq(g[0].rewardUsd8, 3e8, "oldest grant kept");
        assertEq(cashback.walletStockbackUsd8(alice), 3e8);

        // Holding enough shares forfeits nothing.
        vault.redeemed(alice, 300e8);
        assertEq(cashback.grantsOf(address(vault), alice).length, 1);
    }

    function test_VestedGrantsSurviveRedeem() public {
        _grant(alice, 300e8, 300e8);
        vm.warp(block.timestamp + 7 days);
        _grant(alice, 500e8, 500e8);

        vault.redeemed(alice, 0);
        CashbackReserve.Grant[] memory g = cashback.grantsOf(address(vault), alice);
        assertEq(g.length, 1, "only the unvested grant is forfeited");
        assertEq(g[0].rewardUsd8, 3e8);

        cashback.claim(address(vault), alice);
        assertEq(nvda.balanceOf(alice), 3 * PER_USD);
    }

    function test_OnRedeemOnlyTouchesCallersGrants() public {
        _grant(alice, 300e8, 100e8);
        vm.prank(bob);
        cashback.onRedeem(alice, 0);
        assertEq(cashback.grantsOf(address(vault), alice).length, 1);
    }

    function test_ForfeitStillWorksAfterDeauthorize() public {
        _grant(alice, 300e8, 100e8);
        cashback.setAuthorizedVault(address(vault), false);
        vault.redeemed(alice, 0);
        assertEq(cashback.grantsOf(address(vault), alice).length, 0);
    }

    function test_GrantNeedsUnreservedInventory() public {
        cashback.withdraw(address(nvda), address(this), 10 ether - 3 * PER_USD);
        _grant(alice, 300e8, 1);
        assertEq(cashback.availableInventory(address(nvda)), 0);
        vm.expectRevert(bytes("CashbackReserve: inventory"));
        vault.grant(bob, address(nvda), 3 * PER_USD, 300e8, 1);
    }

    function test_OwnerCannotWithdrawReserved() public {
        _grant(alice, 1_000e8, 1);
        uint256 free = cashback.availableInventory(address(nvda));
        assertEq(free, 10 ether - 10 * PER_USD);
        vm.expectRevert(bytes("CashbackReserve: inventory reserved"));
        cashback.withdraw(address(nvda), address(this), free + 1);
        cashback.withdraw(address(nvda), address(this), free);

        vm.prank(bob);
        vm.expectRevert();
        cashback.withdraw(address(nvda), bob, 0);
    }

    function test_PausedStopsGrantsNotClaims() public {
        _grant(alice, 300e8, 1);
        cashback.setPaused(true);
        assertEq(cashback.quoteReward(bob, 300e8), 0);
        vm.warp(block.timestamp + 7 days);
        cashback.claim(address(vault), alice);
        assertEq(nvda.balanceOf(alice), 3 * PER_USD);
    }

    function test_GrantCountBounded() public {
        cashback.setPerWalletCap(1_000e8);
        cashback.setVesting(7 days, 3);
        for (uint256 i; i < 3; ++i) {
            _grant(alice, 50e8, 1);
        }
        vm.expectRevert(bytes("CashbackReserve: too many grants"));
        vault.grant(alice, address(nvda), PER_USD / 2, 50e8, 1);
    }

    function test_OracleCapsGrantAmount() public {
        vm.expectRevert(bytes("CashbackReserve: amount exceeds reward"));
        vault.grant(alice, address(nvda), 1 ether, 300e8, 1);
    }

    function test_AdminBounds() public {
        vm.expectRevert(bytes("CashbackReserve: vesting too long"));
        cashback.setVesting(91 days, 20);
        vm.expectRevert(bytes("CashbackReserve: bad grant limit"));
        cashback.setVesting(7 days, 0);
        vm.expectRevert(bytes("CashbackReserve: rate too high"));
        cashback.setRewardParams(1_001, 50e8, 10e8);

        vm.startPrank(bob);
        vm.expectRevert();
        cashback.setVesting(1 days, 20);
        vm.expectRevert();
        cashback.setPerWalletCap(1);
        vm.expectRevert();
        cashback.setAuthorizedVault(bob, true);
        vm.stopPrank();
    }

    /// Reserved inventory always equals what open grants owe, whatever order
    /// grants, forfeits and claims happen in.
    function testFuzz_ReservedMatchesOpenGrants(uint256 seed) public {
        cashback.setPerWalletCap(10_000e8);
        address[2] memory wallets = [alice, bob];
        uint256[2] memory held;
        for (uint256 step; step < 24; ++step) {
            uint256 r = uint256(keccak256(abi.encode(seed, step)));
            uint256 w = r % 2;
            uint256 action = (r >> 8) % 4;
            if (action == 0 || action == 1) {
                uint256 usd = 50e8 + ((r >> 16) % 2_000e8);
                uint256 shares = 1 + ((r >> 64) % 1_000e8);
                if (cashback.grantsOf(address(vault), wallets[w]).length < cashback.maxPendingGrants()) {
                    _grant(wallets[w], usd, shares);
                    held[w] += shares;
                }
            } else if (action == 2) {
                held[w] = held[w] == 0 ? 0 : (r >> 32) % held[w];
                vault.redeemed(wallets[w], held[w]);
            } else {
                vm.warp(block.timestamp + ((r >> 40) % 5 days));
                cashback.claim(address(vault), wallets[w]);
            }

            uint256 owed;
            uint256 usdOpen;
            for (uint256 i; i < 2; ++i) {
                CashbackReserve.Grant[] memory g = cashback.grantsOf(address(vault), wallets[i]);
                uint256 unvested;
                for (uint256 j; j < g.length; ++j) {
                    owed += g[j].amount;
                    usdOpen += g[j].rewardUsd8;
                    if (g[j].unlockAt > block.timestamp) unvested += g[j].shares;
                }
                if (action == 2 && i == w) assertLe(unvested, held[w], "unvested shares fit in holdings");
            }
            assertEq(cashback.reservedAmount(address(nvda)), owed, "reserved == owed");
            assertLe(usdOpen, cashback.budgetSpentUsd8());
            assertEq(
                cashback.budgetSpentUsd8(),
                cashback.walletStockbackUsd8(alice) + cashback.walletStockbackUsd8(bob),
                "budget == wallet totals"
            );
            assertLe(owed, nvda.balanceOf(address(cashback)), "reserve solvent");
        }
    }
}

/// @dev End-to-end through a factory vault: grant on deposit, forfeit on redeem, claim after vesting.
contract StockbackVestingVaultTest is Test {
    MockERC20 nvda;
    MockERC20 aapl;
    MockERC20 msft;
    MockERC20 usdg;
    OracleAdapter oracle;
    MockOracle[4] feeds;
    CashbackReserve cashback;
    StrategyVault vault;
    ReceiptToken receipt;
    address user = address(0xBEEF);
    address user2 = address(0xCAFE);

    function setUp() public {
        nvda = new MockERC20("NVDA", "NVDA");
        aapl = new MockERC20("AAPL", "AAPL");
        msft = new MockERC20("MSFT", "MSFT");
        usdg = new MockERC20("USDG", "USDG");
        oracle = new OracleAdapter(address(this));
        feeds = [new MockOracle(500e8), new MockOracle(200e8), new MockOracle(400e8), new MockOracle(1e8)];
        oracle.setPriceFeed(address(nvda), address(feeds[0]));
        oracle.setPriceFeed(address(aapl), address(feeds[1]));
        oracle.setPriceFeed(address(msft), address(feeds[2]));
        oracle.setPriceFeed(address(usdg), address(feeds[3]));

        AllocationController controller = new AllocationController(address(this));
        cashback = new CashbackReserve(address(this));
        cashback.setOracle(address(oracle), 100);
        EmergencyRegistry emergency = new EmergencyRegistry(address(this));
        MockUniswapV3Router uni = new MockUniswapV3Router(address(oracle));
        UniswapV3SwapAdapter adapter = new UniswapV3SwapAdapter(address(this), address(uni));
        ExecutionRouter router = new ExecutionRouter(address(this), address(adapter));
        router.setEmergency(address(emergency));
        router.setOracle(address(oracle));
        router.setMaxSlippageBps(100);
        adapter.setAuthorizedCaller(address(router), true);

        address[] memory toks = new address[](4);
        (toks[0], toks[1], toks[2], toks[3]) = (address(nvda), address(aapl), address(msft), address(usdg));
        uint256[] memory w = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            controller.setApprovedAsset(toks[i], true);
            router.setApprovedToken(toks[i], true);
            MockERC20(toks[i]).transfer(address(uni), 100_000 ether);
            w[i] = 2500;
        }

        VaultFactory factory = new VaultFactory(
            address(this), address(oracle), address(controller), address(cashback), address(emergency), address(router)
        );
        factory.setUsdStableAsset(address(usdg));
        (address v, address r) = factory.createVault(
            VaultFactory.CreateParams({
                depositAsset: address(nvda),
                strategy: AllocationController.Strategy.Balanced,
                receiptName: "Compose NVDA Balanced",
                receiptSymbol: "tNVDA-B",
                tvlCapUsd8: 1_000_000e8,
                targetTokens: toks,
                targetWeightsBps: w
            })
        );
        vault = StrategyVault(v);
        receipt = ReceiptToken(r);
        router.setAuthorizedCaller(v, true);
        cashback.setAuthorizedVault(v, true);
        nvda.approve(address(cashback), 10 ether);
        cashback.fund(address(nvda), 10 ether);

        nvda.transfer(user, 10 ether);
        nvda.transfer(user2, 10 ether);
        vm.prank(user);
        nvda.approve(v, type(uint256).max);
        vm.prank(user2);
        nvda.approve(v, type(uint256).max);
    }

    function _warp(uint256 dt) internal {
        vm.warp(block.timestamp + dt);
        for (uint256 i; i < 4; ++i) {
            feeds[i].setPrice(feeds[i].price());
        }
    }

    function test_Deposit300EarnsThreeDollarsAfterSevenDays() public {
        uint256 before = nvda.balanceOf(user);
        vm.prank(user);
        vault.deposit(0.6 ether, 0); // $300
        assertEq(nvda.balanceOf(user), before - 0.6 ether, "nothing paid at deposit");
        assertEq(cashback.walletStockbackUsd8(user), 3e8);

        _warp(7 days - 1);
        cashback.claim(address(vault), user);
        assertEq(nvda.balanceOf(user), before - 0.6 ether, "still vesting");

        _warp(1);
        cashback.claim(address(vault), user);
        // $3 of NVDA at $500 = 0.006 NVDA
        assertEq(nvda.balanceOf(user), before - 0.6 ether + 0.006 ether);
    }

    function test_DepositAndRedeemEarnsNothing() public {
        vm.startPrank(user);
        uint256 shares = vault.deposit(1 ether, 0);
        vault.redeem(shares, StrategyVault.RedeemMode.ProportionalBasket, 0);
        vm.stopPrank();

        assertEq(cashback.walletStockbackUsd8(user), 0, "grant forfeited");
        assertEq(cashback.reservedAmount(address(nvda)), 0);
        _warp(8 days);
        (uint256 amt,) = cashback.claimable(address(vault), user);
        assertEq(amt, 0);
    }

    function test_RedeemAfterVestingKeepsReward() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);
        _warp(7 days);
        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.OriginalAsset, 0);
        (uint256 amt, uint256 usd8) = cashback.claimable(address(vault), user);
        assertEq(usd8, 5e8);
        assertEq(amt, 0.01 ether);
    }

    function test_PartialRedeemKeepsOlderGrant() public {
        vm.prank(user);
        uint256 first = vault.deposit(0.6 ether, 0); // $3
        _warp(1 days);
        vm.prank(user);
        vault.deposit(1 ether, 0); // $5

        // Redeem down to exactly the first deposit's shares: the newest grant no longer
        // fits, the first still does.
        uint256 toRedeem = receipt.balanceOf(user) - first;
        vm.prank(user);
        vault.redeem(toRedeem, StrategyVault.RedeemMode.ProportionalBasket, 0);
        assertEq(cashback.walletStockbackUsd8(user), 3e8);
    }

    /// Whatever gas limit a wallet picks, a deposit either reverts or records its grant:
    /// it never succeeds with the Stockback silently dropped.
    function test_GasStarvedGrantRevertsDeposit() public {
        vm.prank(user);
        vault.deposit(1 ether, 0); // first grant, so later ones append to a warm list
        uint256 granted = cashback.walletStockbackUsd8(user);

        uint256 okGas;
        for (uint256 gasLimit = 300_000; gasLimit <= 1_500_000; gasLimit += 1_000) {
            uint256 snap = vm.snapshotState();
            vm.prank(user);
            (bool ok,) = address(vault).call{gas: gasLimit}(abi.encodeCall(StrategyVault.deposit, (0.6 ether, 0)));
            if (ok) {
                assertEq(cashback.walletStockbackUsd8(user), granted + 3e8, "succeeded without its grant");
                if (okGas == 0) okGas = gasLimit;
            }
            vm.revertToState(snap);
        }
        assertGt(okGas, 0, "deposit never succeeded");
    }

    function test_DepositSucceedsWhenReserveEmpty() public {
        cashback.withdraw(address(nvda), address(this), 10 ether);
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);
        assertGt(shares, 0);
        assertEq(cashback.walletStockbackUsd8(user), 0);
    }

    function test_RedeemWorksWhenReserveHasNoGrants() public {
        cashback.setPaused(true);
        vm.prank(user2);
        uint256 shares = vault.deposit(1 ether, 0);
        vm.prank(user2);
        vault.redeem(shares, StrategyVault.RedeemMode.ProportionalBasket, 0);
        assertEq(receipt.balanceOf(user2), 0);
    }
}
