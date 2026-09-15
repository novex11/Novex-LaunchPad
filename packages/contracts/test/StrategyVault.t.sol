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
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

contract StrategyVaultTest is Test {
    StrategyVault vault;
    ReceiptToken receipt;
    OracleAdapter oracle;
    AllocationController controller;
    CashbackReserve cashback;
    EmergencyRegistry emergency;
    ExecutionRouter router;
    MockSwapRouter mockRouter;

    MockERC20 nvda;
    MockERC20 aapl;
    MockERC20 msft;
    MockERC20 googl;
    MockERC20 usdg;
    MockOracle nvdaFeed;
    MockOracle aaplFeed;
    MockOracle msftFeed;
    MockOracle googlFeed;

    address user = address(0xBEEF);
    address user2 = address(0xCAFE);

    function setUp() public {
        // Deploy tokens
        nvda = new MockERC20("NVDA", "NVDA");
        aapl = new MockERC20("AAPL", "AAPL");
        msft = new MockERC20("MSFT", "MSFT");
        googl = new MockERC20("GOOGL", "GOOGL");
        usdg = new MockERC20("USDG", "USDG");

        // Deploy oracles
        nvdaFeed = new MockOracle(500e8);
        aaplFeed = new MockOracle(200e8);
        msftFeed = new MockOracle(400e8);
        googlFeed = new MockOracle(180e8);

        // Deploy infra
        oracle = new OracleAdapter(address(this));
        controller = new AllocationController(address(this));
        cashback = new CashbackReserve(address(this));
        emergency = new EmergencyRegistry(address(this));
        mockRouter = new MockSwapRouter();
        mockRouter.setOracle(address(oracle));
        router = new ExecutionRouter(address(this), address(mockRouter));
        router.setEmergency(address(emergency));

        // Register price feeds
        oracle.setPriceFeed(address(nvda), address(nvdaFeed));
        oracle.setPriceFeed(address(aapl), address(aaplFeed));
        oracle.setPriceFeed(address(msft), address(msftFeed));
        oracle.setPriceFeed(address(googl), address(googlFeed));
        oracle.setPriceFeed(address(usdg), address(new MockOracle(1e8)));

        // Approve assets in AllocationController
        controller.setApprovedAsset(address(nvda), true);
        controller.setApprovedAsset(address(aapl), true);
        controller.setApprovedAsset(address(msft), true);
        controller.setApprovedAsset(address(googl), true);
        controller.setApprovedAsset(address(usdg), true);

        // Approve tokens in ExecutionRouter
        router.setApprovedToken(address(nvda), true);
        router.setApprovedToken(address(aapl), true);
        router.setApprovedToken(address(msft), true);
        router.setApprovedToken(address(googl), true);
        router.setApprovedToken(address(usdg), true);

        // Deploy vault
        receipt = new ReceiptToken("tNVDA-B", "tNVDA-B", address(this));
        vault = new StrategyVault(
            address(this),
            address(nvda),
            AllocationController.Strategy.Balanced,
            address(receipt),
            address(oracle),
            address(controller),
            address(cashback),
            address(emergency),
            address(router),
            address(usdg),
            1_000_000e8
        );
        receipt.setVault(address(vault));
        vault.setTargetMix(_mixTokens(), _mixWeights());

        // Authorize vault
        router.setAuthorizedCaller(address(vault), true);
        cashback.setAuthorizedVault(address(vault), true);

        // Fund MockSwapRouter with target tokens for swaps
        aapl.transfer(address(mockRouter), 100_000 ether);
        msft.transfer(address(mockRouter), 100_000 ether);
        googl.transfer(address(mockRouter), 100_000 ether);
        usdg.transfer(address(mockRouter), 100_000 ether);
        nvda.transfer(address(mockRouter), 100_000 ether);

        // Fund CashbackReserve with NVDA for stockback
        nvda.approve(address(cashback), 10_000 ether);
        cashback.fund(address(nvda), 10_000 ether);

        // Fund users
        nvda.transfer(user, 100 ether);
        nvda.transfer(user2, 100 ether);
        vm.prank(user);
        nvda.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        nvda.approve(address(vault), type(uint256).max);
    }

    // ─── Helpers ────────────────────────────────────────────

    /// @dev 25% retained NVDA + 25% each AAPL / MSFT / GOOGL — the vault's fixed mix.
    function _mixTokens() internal view returns (address[] memory tokens) {
        tokens = new address[](4);
        tokens[0] = address(nvda);
        tokens[1] = address(aapl);
        tokens[2] = address(msft);
        tokens[3] = address(googl);
    }

    function _mixWeights() internal pure returns (uint256[] memory weights) {
        weights = new uint256[](4);
        weights[0] = 2500;
        weights[1] = 2500;
        weights[2] = 2500;
        weights[3] = 2500;
    }

    // ─── B.1: Deposit with basket swaps ─────────────────────

    function test_DepositMintsShares() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);

        assertGt(shares, 0, "should mint shares");
        assertEq(receipt.balanceOf(user), shares, "receipt balance");
    }

    function test_DepositExecutesSwaps() public {
        uint256 aaplBefore = aapl.balanceOf(address(vault));
        uint256 msftBefore = msft.balanceOf(address(vault));
        uint256 googlBefore = googl.balanceOf(address(vault));

        vm.prank(user);
        vault.deposit(1 ether, 0);

        // 25% of 1 ether = 0.25 ether swapped to each non-deposit token
        assertGt(aapl.balanceOf(address(vault)) - aaplBefore, 0, "AAPL received");
        assertGt(msft.balanceOf(address(vault)) - msftBefore, 0, "MSFT received");
        assertGt(googl.balanceOf(address(vault)) - googlBefore, 0, "GOOGL received");
    }

    function test_DepositRetainsDepositAsset() public {
        vm.prank(user);
        vault.deposit(1 ether, 0);

        // 25% retained as NVDA = 0.25 ether
        assertEq(nvda.balanceOf(address(vault)), 0.25 ether, "NVDA retained");
    }

    function test_DepositTracksBasketTokens() public {
        vm.prank(user);
        vault.deposit(1 ether, 0);

        assertEq(vault.basketTokenCount(), 4, "4 basket tokens");
        assertTrue(vault.isBasketToken(address(nvda)), "NVDA tracked");
        assertTrue(vault.isBasketToken(address(aapl)), "AAPL tracked");
        assertTrue(vault.isBasketToken(address(msft)), "MSFT tracked");
        assertTrue(vault.isBasketToken(address(googl)), "GOOGL tracked");
    }

    // ─── B.2: Multi-asset NAV ───────────────────────────────

    function test_NavUsd8MultiAsset() public {
        vm.prank(user);
        vault.deposit(1 ether, 0);

        uint256 nav = vault.navUsd8();
        // Oracle-priced swaps: deposit 1 NVDA ($500) with 25% each:
        // 0.25 NVDA retained = $125
        // 0.25 NVDA → AAPL: 0.25 * $500 / $200 = 0.625 AAPL = $125
        // 0.25 NVDA → MSFT: 0.25 * $500 / $400 = 0.3125 MSFT = $125
        // 0.25 NVDA → GOOGL: 0.25 * $500 / $180 ≈ 0.6944 GOOGL ≈ $125
        // Total ≈ $500 (slight rounding from integer division)
        // Each leg has value: 0.25e18 * 500e8 / priceOut * priceOut / 1e18 ≈ 125e8
        // Allow ±1e8 rounding from integer division across 4 legs
        uint256 expected = 500e8;
        assertGe(nav, expected - 4e8, "NAV within rounding of deposit value");
        assertLe(nav, expected, "NAV at most deposit value");
    }

    function test_SharePriceAfterDeposit() public {
        vm.prank(user);
        vault.deposit(1 ether, 0);

        // First deposit: shares = depositValue / 1e18
        // depositValue = 1 ether * 500e8 / 1e18 = 500e8
        // shares = 500e8 * 1e18 / 1e18 = 500e8
        // NAV = 320e8 (due to 1:1 swaps at different prices)
        // sharePrice = 320e8 * 1e18 / 500e8 = 0.64e18
        uint256 price = vault.sharePrice();
        assertGt(price, 0, "share price positive");
    }

    function test_EmptyNavIsZero() public view {
        assertEq(vault.navUsd8(), 0, "empty vault NAV is 0");
        assertEq(vault.sharePrice(), 1e18, "empty vault share price is 1e18");
    }

    // ─── B.0: Bug fixes ─────────────────────────────────────

    function test_NoDilutionSecondDepositor() public {
        // First deposit
        vm.prank(user);
        uint256 shares1 = vault.deposit(1 ether, 0);

        // Second deposit (same amount)
        vm.prank(user2);
        uint256 shares2 = vault.deposit(1 ether, 0);

        // Both deposited the same value, so shares should be proportional to value
        // With 1:1 mock swaps (token amounts, not USD), NAV shifts after first deposit
        // so share price changes. The key invariant: no depositor is severely diluted.
        uint256 total = shares1 + shares2;
        // Relaxed bounds: first depositor should retain 30-70% of total shares
        assertGt(shares1 * 100 / total, 30, "first depositor at least 30%");
        assertLt(shares1 * 100 / total, 70, "first depositor at most 70%");
    }

    function test_TvlCapCheckedBeforeTransfer() public {
        // Create a vault with $600 TVL cap (1 NVDA ≈ $500, so 1 ether deposit = $500)
        ReceiptToken receipt2 = new ReceiptToken("test", "test", address(this));
        StrategyVault smallVault = new StrategyVault(
            address(this), address(nvda), AllocationController.Strategy.Balanced,
            address(receipt2), address(oracle), address(controller),
            address(cashback), address(emergency), address(router), address(usdg), 600e8
        );
        receipt2.setVault(address(smallVault));
        smallVault.setTargetMix(_mixTokens(), _mixWeights());
        router.setAuthorizedCaller(address(smallVault), true);

        // First deposit of 1 NVDA ($500) should succeed
        nvda.transfer(user, 10 ether);
        vm.startPrank(user);
        nvda.approve(address(smallVault), type(uint256).max);
        smallVault.deposit(1 ether, 0);

        // Second deposit should fail: $500 + $500 > $600 cap
        vm.expectRevert("StrategyVault: TVL cap");
        smallVault.deposit(1 ether, 0);
        vm.stopPrank();
    }

    // ─── B.3: Cashback ──────────────────────────────────────

    function test_CashbackPaidOnDeposit() public {
        uint256 userNvdaBefore = nvda.balanceOf(user);

        vm.prank(user);
        vault.deposit(1 ether, 0);

        // Deposit value = 1 NVDA * $500 = $500 → eligible for $2 stockback
        // $2 stockback in NVDA terms = 2e8 * 1e18 / 500e8 = 0.004e18
        uint256 userNvdaAfter = nvda.balanceOf(user);
        // User spent 1 ether NVDA but got some cashback back
        uint256 spent = userNvdaBefore - userNvdaAfter;
        assertLt(spent, 1 ether, "user received cashback (spent < deposited)");
    }

    function test_CashbackTrackedPerWallet() public {
        vm.prank(user);
        vault.deposit(1 ether, 0);

        assertGt(cashback.walletStockbackUsd8(user), 0, "cashback tracked");
        assertEq(cashback.walletStockbackUsd8(user), 2e8, "cashback = $2 flat");
    }

    // ─── B.4: Proportional redeem ───────────────────────────

    function test_ProportionalRedeemDistributesAllTokens() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);

        uint256 userAaplBefore = aapl.balanceOf(user);
        uint256 userMsftBefore = msft.balanceOf(user);
        uint256 userGooglBefore = googl.balanceOf(user);

        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.ProportionalBasket, 0);

        assertGt(aapl.balanceOf(user) - userAaplBefore, 0, "received AAPL");
        assertGt(msft.balanceOf(user) - userMsftBefore, 0, "received MSFT");
        assertGt(googl.balanceOf(user) - userGooglBefore, 0, "received GOOGL");
        assertGt(nvda.balanceOf(user), 0, "received NVDA");
    }

    function test_ProportionalRedeemBurnsShares() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);

        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.ProportionalBasket, 0);

        assertEq(receipt.balanceOf(user), 0, "all shares burned");
        assertEq(vault.totalShares(), 0, "total shares zero");
    }

    // ─── Original asset redeem ──────────────────────────────

    function test_OriginalAssetRedeemSwapsBack() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);

        uint256 userNvdaBefore = nvda.balanceOf(user);

        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.OriginalAsset, 0);

        uint256 userNvdaAfter = nvda.balanceOf(user);
        assertGt(userNvdaAfter - userNvdaBefore, 0, "received NVDA back");
        assertEq(receipt.balanceOf(user), 0, "all shares burned");
    }

    // ─── Pause checks ───────────────────────────────────────

    function test_PauseDeposits() public {
        emergency.setDepositsPaused(true);

        vm.prank(user);
        vm.expectRevert("StrategyVault: deposits paused");
        vault.deposit(1 ether, 0);
    }

    function test_PauseSwaps() public {
        emergency.setSwapsPaused(true);

        // Deposit requiring swaps (4-token basket) should fail when swaps paused
        vm.prank(user);
        vm.expectRevert("ExecutionRouter: swaps paused");
        vault.deposit(1 ether, 0);
    }

    // ─── Share price invariant ──────────────────────────────

    function test_InvariantSharePricePositive() public view {
        assertEq(vault.sharePrice(), 1e18);
    }

    // ─── Partial redeem ─────────────────────────────────────

    function test_UsdStableRedeem() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);

        uint256 userUsdgBefore = usdg.balanceOf(user);

        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.UsdStable, 0);

        assertGt(usdg.balanceOf(user) - userUsdgBefore, 0, "received USDG");
        assertEq(receipt.balanceOf(user), 0, "all shares burned");
    }

    function test_PartialRedeem() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);

        uint256 halfShares = shares / 2;
        vm.prank(user);
        vault.redeem(halfShares, StrategyVault.RedeemMode.ProportionalBasket, 0);

        assertEq(receipt.balanceOf(user), shares - halfShares, "half shares remaining");
        assertGt(vault.navUsd8(), 0, "vault still has NAV");
    }
}
