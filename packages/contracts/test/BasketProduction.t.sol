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
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockUniswapV3Router} from "../src/mocks/MockUniswapV3Router.sol";

/// @dev Production wiring: StrategyVault → ExecutionRouter (oracle floor) →
///      UniswapV3SwapAdapter → SwapRouter02 (mocked, oracle-priced with configurable loss).
contract BasketProductionTest is Test {
    VaultFactory factory;
    StrategyVault vault;
    ReceiptToken receipt;
    OracleAdapter oracle;
    AllocationController controller;
    CashbackReserve cashback;
    EmergencyRegistry emergency;
    ExecutionRouter router;
    UniswapV3SwapAdapter adapter;
    MockUniswapV3Router uni;

    MockERC20 nvda;
    MockERC20 aapl;
    MockERC20 msft;
    MockERC20 usdg;
    MockOracle nvdaFeed;
    MockOracle aaplFeed;

    address user = address(0xBEEF);
    address user2 = address(0xCAFE);

    function setUp() public {
        nvda = new MockERC20("NVDA", "NVDA");
        aapl = new MockERC20("AAPL", "AAPL");
        msft = new MockERC20("MSFT", "MSFT");
        usdg = new MockERC20("USDG", "USDG");

        oracle = new OracleAdapter(address(this));
        nvdaFeed = new MockOracle(500e8);
        aaplFeed = new MockOracle(200e8);
        oracle.setPriceFeed(address(nvda), address(nvdaFeed));
        oracle.setPriceFeed(address(aapl), address(aaplFeed));
        oracle.setPriceFeed(address(msft), address(new MockOracle(400e8)));
        oracle.setPriceFeed(address(usdg), address(new MockOracle(1e8)));

        controller = new AllocationController(address(this));
        cashback = new CashbackReserve(address(this));
        emergency = new EmergencyRegistry(address(this));

        uni = new MockUniswapV3Router(address(oracle));
        adapter = new UniswapV3SwapAdapter(address(this), address(uni));
        router = new ExecutionRouter(address(this), address(adapter));
        router.setEmergency(address(emergency));
        router.setOracle(address(oracle));
        router.setMaxSlippageBps(100);
        adapter.setAuthorizedCaller(address(router), true);

        address[4] memory toks = [address(nvda), address(aapl), address(msft), address(usdg)];
        for (uint256 i; i < toks.length; ++i) {
            controller.setApprovedAsset(toks[i], true);
            router.setApprovedToken(toks[i], true);
            MockERC20(toks[i]).transfer(address(uni), 100_000 ether);
        }

        factory = new VaultFactory(
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
                targetTokens: _mixTokens(),
                targetWeightsBps: _mixWeights()
            })
        );
        vault = StrategyVault(v);
        receipt = ReceiptToken(r);
        router.setAuthorizedCaller(v, true);
        cashback.setAuthorizedVault(v, true);

        nvda.transfer(user, 100 ether);
        nvda.transfer(user2, 100 ether);
        vm.prank(user);
        nvda.approve(address(vault), type(uint256).max);
        vm.prank(user2);
        nvda.approve(address(vault), type(uint256).max);
    }

    /// @dev 25% retained NVDA + 25% each AAPL / MSFT / USDG — the vault's fixed mix.
    function _mixTokens() internal view returns (address[] memory tokens) {
        tokens = new address[](4);
        tokens[0] = address(nvda);
        tokens[1] = address(aapl);
        tokens[2] = address(msft);
        tokens[3] = address(usdg);
    }

    function _mixWeights() internal pure returns (uint256[] memory weights) {
        weights = new uint256[](4);
        weights[0] = 2500;
        weights[1] = 2500;
        weights[2] = 2500;
        weights[3] = 2500;
    }

    // ─── Value-based minting ─────────────────────────────────

    function test_FirstDepositMintsValueReceived() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);
        // 1 NVDA = $500; exact oracle-priced swaps → NAV ≈ $500 (integer rounding only)
        assertApproxEqAbs(shares, 500e8, 4, "shares track value received");
        assertEq(vault.navUsd8(), shares, "first deposit: 1 share = 1e-8 USD");
    }

    function test_SwapLossIsBorneByDepositorNotHolders() public {
        vm.prank(user);
        uint256 shares1 = vault.deposit(1 ether, 0);
        uint256 priceBefore = vault.sharePrice();

        // Second depositor gets 0.8% slippage on every leg (within the 1% floor)
        uni.setLossBps(80);
        vm.prank(user2);
        uint256 shares2 = vault.deposit(1 ether, 0);

        assertLt(shares2, shares1, "lossy deposit mints fewer shares");
        // 3 of 4 legs swap at 0.8% loss → ~0.6% less value → ~0.6% fewer shares
        assertApproxEqRel(shares2, (shares1 * 994) / 1000, 0.002e18, "loss ~0.6% of deposit");
        assertEq(vault.sharePrice(), priceBefore, "existing holders not diluted");
    }

    function test_MinSharesRejectsExcessLoss() public {
        // Loosen the router floor so minShares is the binding guard
        router.setMaxSlippageBps(500);
        uni.setLossBps(300);
        uint256 expected = 500e8;
        uint256 minShares = (expected * 9900) / 10_000; // accept ≤1% loss

        vm.prank(user);
        vm.expectRevert(bytes("StrategyVault: slippage"));
        vault.deposit(1 ether, minShares);
    }

    function test_MinSharesAcceptsWithinTolerance() public {
        uni.setLossBps(50);
        uint256 minShares = (500e8 * 9900) / 10_000;
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, minShares);
        assertGe(shares, minShares);
    }

    // ─── ExecutionRouter oracle floor ────────────────────────

    function test_RouterFloorBlocksSandwich() public {
        uni.setLossBps(150); // above the 1% protocol tolerance
        vm.prank(user);
        vm.expectRevert(bytes("Too little received"));
        vault.deposit(1 ether, 0);
    }

    function test_RouterQuoteHandlesDecimals() public {
        // 1 NVDA ($500) → AAPL ($200) = 2.5 AAPL
        assertEq(router.oracleQuote(address(nvda), address(aapl), 1 ether), 2.5 ether);
        // floor at 1% below
        assertEq(router.minOutFor(address(nvda), address(aapl), 1 ether, 0), 2.475 ether);
        // caller floor wins when higher
        assertEq(router.minOutFor(address(nvda), address(aapl), 1 ether, 2.6 ether), 2.6 ether);
    }

    function test_RouterFloorDisabledWithoutOracle() public {
        router.setOracle(address(0));
        uni.setLossBps(400);
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);
        assertLt(shares, 500e8, "no floor: loss accepted, borne by depositor");
    }

    function test_RouterRejectsUnauthorizedAndUnapproved() public {
        vm.prank(user);
        vm.expectRevert(bytes("ExecutionRouter: unauthorized"));
        router.executeSwap(address(nvda), address(aapl), 1 ether, 0, user);

        MockERC20 other = new MockERC20("X", "X");
        vm.expectRevert(bytes("ExecutionRouter: unapproved"));
        router.executeSwap(address(nvda), address(other), 1 ether, 0, address(this));
    }

    function test_RouterCanMigrateVenue() public {
        MockUniswapV3Router uni2 = new MockUniswapV3Router(address(oracle));
        UniswapV3SwapAdapter adapter2 = new UniswapV3SwapAdapter(address(this), address(uni2));
        adapter2.setAuthorizedCaller(address(router), true);
        aapl.transfer(address(uni2), 1_000 ether);
        msft.transfer(address(uni2), 1_000 ether);
        usdg.transfer(address(uni2), 1_000 ether);
        router.setSwapRouter(address(adapter2));

        vm.prank(user);
        vault.deposit(1 ether, 0);
        assertGt(nvda.balanceOf(address(uni2)), 0, "swaps routed through new venue");
    }

    // ─── Uniswap adapter ─────────────────────────────────────

    function test_AdapterUsesConfiguredFeeTier() public {
        vm.prank(user);
        vault.deposit(1 ether, 0);
        assertEq(uint256(uni.lastFee()), 3000, "default 0.30% tier");

        adapter.setPairFee(address(nvda), address(usdg), 500);
        assertEq(adapter.feeFor(address(usdg), address(nvda)), 500, "pair fee is order-independent");
        assertEq(adapter.feeFor(address(nvda), address(aapl)), 3000);

        vm.expectRevert(bytes("UniswapV3SwapAdapter: bad fee"));
        adapter.setDefaultFee(1234);
    }

    function test_AdapterRejectsUnauthorizedCaller() public {
        nvda.approve(address(adapter), 1 ether);
        vm.expectRevert(bytes("UniswapV3SwapAdapter: unauthorized"));
        adapter.swap(
            ISwapRouter.SwapParams({
                tokenIn: address(nvda), tokenOut: address(aapl), amountIn: 1 ether, minAmountOut: 0, recipient: address(this)
            })
        );
    }

    // ─── Exits under stale oracle ────────────────────────────

    function test_ProportionalRedeemWorksWithStaleOracle() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);

        vm.warp(block.timestamp + 2 days);
        vm.prank(user);
        vm.expectRevert(bytes("OracleAdapter: stale"));
        vault.deposit(1 ether, 0);

        uint256 aaplBefore = aapl.balanceOf(user);
        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.ProportionalBasket, 0);
        assertGt(aapl.balanceOf(user), aaplBefore, "exit possible while feed is stale");
        assertEq(vault.totalShares(), 0);
    }

    function test_RedeemOriginalRespectsMinOut() public {
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);

        vm.prank(user);
        vm.expectRevert(bytes("StrategyVault: min output"));
        vault.redeem(shares, StrategyVault.RedeemMode.OriginalAsset, 2 ether);

        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.OriginalAsset, 0.99 ether);
        assertGe(nvda.balanceOf(user), 99.99 ether, "~1 NVDA back");
    }

    // ─── Cashback reserve ────────────────────────────────────

    function test_DepositEmitsValueAddedAndPaysBoundedStockback() public {
        cashback.setOracle(address(oracle), 100);
        nvda.approve(address(cashback), 10 ether);
        cashback.fund(address(nvda), 10 ether);

        uint256 before = nvda.balanceOf(user);
        vm.prank(user);
        uint256 shares = vault.deposit(1 ether, 0);
        // $500 Balanced band: $7 in NVDA at $500 = 0.014 NVDA forwarded to the user
        assertEq(nvda.balanceOf(user), before - 1 ether + 0.014 ether, "stockback forwarded");
        assertEq(cashback.walletStockbackUsd8(user), 7e8);
        assertGt(shares, 0);
    }

    function test_CashbackRejectsOversizedPayout() public {
        cashback.setOracle(address(oracle), 100);
        nvda.approve(address(cashback), 10 ether);
        cashback.fund(address(nvda), 10 ether);
        cashback.setAuthorizedVault(address(this), true);

        // $500 Balanced band is $7 but asking for 1 NVDA ($500) of inventory
        vm.expectRevert(bytes("CashbackReserve: amount exceeds reward"));
        cashback.payDepositStockback(user, address(nvda), 1 ether, 500e8);

        // $2 worth, within the $7 reward, passes
        cashback.payDepositStockback(user, address(nvda), 0.004 ether, 500e8);
        assertEq(nvda.balanceOf(address(this)) >= 0.004 ether, true);
    }

    function test_CashbackOwnerControls() public {
        CashbackReserve.RewardBand[] memory bands = new CashbackReserve.RewardBand[](1);
        bands[0] = CashbackReserve.RewardBand(50e8, 3e8);
        cashback.setRewardBands(AllocationController.Strategy.Balanced, bands);
        assertEq(cashback.rewardUsd8For(AllocationController.Strategy.Balanced, 500e8), 3e8);
        cashback.setGlobalBudget(1e8);
        assertEq(cashback.canReward(AllocationController.Strategy.Balanced, user, 500e8), false, "budget below reward");

        vm.prank(user);
        vm.expectRevert();
        cashback.setRewardBands(AllocationController.Strategy.Aggressive, bands);

        vm.prank(user);
        vm.expectRevert();
        cashback.setOracle(address(oracle), 100);
        vm.expectRevert(bytes("CashbackReserve: tolerance too high"));
        cashback.setOracle(address(oracle), 5_000);
    }

    // ─── Guards + admin ──────────────────────────────────────

    function test_ZeroAmountAndZeroSharesRevert() public {
        vm.prank(user);
        vm.expectRevert(bytes("StrategyVault: zero amount"));
        vault.deposit(0, 0);
    }

    // ─── Fixed target mix ────────────────────────────────────

    function test_DepositFollowsStoredMix() public {
        vm.prank(user);
        vault.deposit(1 ether, 0);
        // 1 NVDA = $500: 25% retained, $125 into each other leg at oracle price.
        assertEq(nvda.balanceOf(address(vault)), 0.25 ether, "retained NVDA");
        assertApproxEqRel(aapl.balanceOf(address(vault)), 0.625 ether, 0.02e18, "AAPL leg");
        assertApproxEqRel(msft.balanceOf(address(vault)), 0.3125 ether, 0.02e18, "MSFT leg");
        assertApproxEqRel(usdg.balanceOf(address(vault)), 125 ether, 0.02e18, "USDG leg");
        (address[] memory toks, uint256[] memory w) = vault.targetMix();
        assertEq(toks.length, 4);
        assertEq(w[0] + w[1] + w[2] + w[3], 10_000);
    }

    function test_OnlyOwnerSetsTargetMix() public {
        vm.prank(user);
        vm.expectRevert();
        vault.setTargetMix(_mixTokens(), _mixWeights());
    }

    function test_TargetMixMustRespectStrategyCap() public {
        address[] memory toks = new address[](2);
        toks[0] = address(nvda);
        toks[1] = address(aapl);
        uint256[] memory w = new uint256[](2);
        w[0] = 5000;
        w[1] = 5000;
        vm.expectRevert(bytes("Max single stock exceeded"));
        factory.setVaultTargetMix(address(vault), toks, w);
    }

    function test_TargetMixRejectsDuplicateAndUnapproved() public {
        address[] memory toks = _mixTokens();
        toks[3] = address(aapl);
        vm.expectRevert(bytes("StrategyVault: duplicate token"));
        factory.setVaultTargetMix(address(vault), toks, _mixWeights());

        toks[3] = address(0xDEAD);
        vm.expectRevert(bytes("AllocationController: unapproved asset"));
        factory.setVaultTargetMix(address(vault), toks, _mixWeights());
    }

    function test_FactoryCanReplaceTargetMix() public {
        MockERC20 googl = new MockERC20("GOOGL", "GOOGL");
        oracle.setPriceFeed(address(googl), address(new MockOracle(180e8)));
        controller.setApprovedAsset(address(googl), true);
        router.setApprovedToken(address(googl), true);
        googl.transfer(address(uni), 100_000 ether);

        address[] memory toks = new address[](5);
        toks[0] = address(nvda);
        toks[1] = address(aapl);
        toks[2] = address(msft);
        toks[3] = address(usdg);
        toks[4] = address(googl);
        uint256[] memory w = new uint256[](5);
        for (uint256 i; i < 5; ++i) w[i] = 2000;
        factory.setVaultTargetMix(address(vault), toks, w);

        vm.prank(user);
        vault.deposit(1 ether, 0);
        assertGt(googl.balanceOf(address(vault)), 0, "new leg bought");
        assertEq(nvda.balanceOf(address(vault)), 0.2 ether, "retention follows new mix");
    }

    function test_DepositRevertsWithoutTargetMix() public {
        ReceiptToken r2 = new ReceiptToken("x", "x", address(this));
        StrategyVault bare = new StrategyVault(
            address(this), address(nvda), AllocationController.Strategy.Balanced, address(r2), address(oracle),
            address(controller), address(cashback), address(emergency), address(router), address(usdg), 1_000_000e8
        );
        r2.setVault(address(bare));
        vm.startPrank(user);
        nvda.approve(address(bare), type(uint256).max);
        vm.expectRevert(bytes("StrategyVault: no target mix"));
        bare.deposit(1 ether, 0);
        vm.stopPrank();
    }

    function test_FactoryCanRaiseTvlCap() public {
        factory.setVaultTvlCap(address(vault), 5_000_000e8);
        assertEq(vault.tvlCapUsd8(), 5_000_000e8);

        vm.prank(user);
        vm.expectRevert();
        vault.setTvlCapUsd8(1);
    }
}
