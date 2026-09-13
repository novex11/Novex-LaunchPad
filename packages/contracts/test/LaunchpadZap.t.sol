// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairVault} from "../src/PairVault.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {LaunchpadZap} from "../src/LaunchpadZap.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";
import {MockUniswapV3Router} from "../src/mocks/MockUniswapV3Router.sol";
import {MockWRHT} from "../src/mocks/MockWRHT.sol";

contract LaunchpadZapTest is Test {
    PairFactory factory;
    OracleAdapter oracle;
    AllocationController controller;
    EmergencyRegistry emergency;
    ExecutionRouter router;
    MockSwapRouter innerSwap;
    MockUniswapV3Router v3;
    MockWRHT wrht;
    LaunchpadZap zap;

    MockERC20 tsla;
    MockERC20 aapl;
    MockERC20 usdg;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        tsla = new MockERC20("Tesla", "TSLA");
        aapl = new MockERC20("Apple", "AAPL");
        usdg = new MockERC20("USDG", "USDG");
        wrht = new MockWRHT();

        // Mint extra so we can fund inner swap, v3 router, and both users
        usdg.mint(address(this), 2_000_000 ether);

        oracle = new OracleAdapter(address(this));
        controller = new AllocationController(address(this));
        emergency = new EmergencyRegistry(address(this));
        innerSwap = new MockSwapRouter();
        router = new ExecutionRouter(address(this), address(innerSwap));
        router.setEmergency(address(emergency));

        // Prices
        oracle.setPriceFeed(address(tsla), address(new MockOracle(250e8))); // $250
        oracle.setPriceFeed(address(aapl), address(new MockOracle(200e8))); // $200
        oracle.setPriceFeed(address(usdg), address(new MockOracle(1e8)));   // $1
        oracle.setPriceFeed(address(wrht), address(new MockOracle(3_000e8))); // $3,000 (native RHT)

        // Approvals
        controller.setApprovedAsset(address(tsla), true);
        controller.setApprovedAsset(address(aapl), true);
        controller.setApprovedAsset(address(usdg), true);
        router.setApprovedToken(address(tsla), true);
        router.setApprovedToken(address(aapl), true);
        router.setApprovedToken(address(usdg), true);

        // Fund the pair-vault's swap router
        tsla.transfer(address(innerSwap), 500_000 ether);
        aapl.transfer(address(innerSwap), 500_000 ether);
        usdg.transfer(address(innerSwap), 500_000 ether);

        // v3 router (used by the Zap): fund with USDG so it can pay out
        v3 = new MockUniswapV3Router(address(oracle));
        usdg.transfer(address(v3), 500_000 ether);

        // Pair factory
        factory = new PairFactory(
            address(this),
            address(controller),
            address(oracle),
            address(router),
            address(emergency),
            address(usdg)
        );
        router.transferOwnership(address(factory));

        // The Zap
        zap = new LaunchpadZap(address(v3), address(wrht), address(usdg));

        // User balances
        usdg.transfer(alice, 50_000 ether);
        usdg.transfer(bob, 50_000 ether);
        tsla.transfer(alice, 100 ether);   // $25,000 worth
        aapl.transfer(alice, 100 ether);   // $20,000 worth
        vm.deal(alice, 10 ether);          // 10 native RHT = ~$30,000
    }

    // ─── Helpers ────────────────────────────────────────────

    function _launch(address creator) internal returns (PairVault pair) {
        vm.prank(creator);
        (address pairAddr, ) = factory.launchPair(
            address(tsla),
            address(aapl),
            6000,
            200, // 2%
            "Novex TSLA-AAPL",
            "pTSLA-AAPL"
        );
        return PairVault(pairAddr);
    }

    // ─── Seed via USDG (pass-through) ───────────────────────

    function test_SeedWithUsdgPassThrough() public {
        PairVault pair = _launch(bob);

        vm.startPrank(alice);
        usdg.approve(address(zap), 1_000 ether);
        uint256 shares = zap.seedPair(address(pair), address(usdg), 1_000 ether, 0);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(pair.receiptToken().balanceOf(alice), shares);
        // Non-creator seed → 2% fee = 20 USDG
        assertEq(pair.creatorEarningsUsdg(), 20 ether);
    }

    // ─── Seed via a pair leg (stock) ────────────────────────

    function test_SeedWithTokenA() public {
        PairVault pair = _launch(bob);

        vm.startPrank(alice);
        tsla.approve(address(zap), 1 ether); // 1 TSLA = $250 = 250 USDG
        uint256 shares = zap.seedPair(address(pair), address(tsla), 1 ether, 0);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(pair.receiptToken().balanceOf(alice), shares);
        // 2% of 250 USDG = 5 USDG
        assertEq(pair.creatorEarningsUsdg(), 5 ether);
    }

    function test_SeedWithTokenB() public {
        PairVault pair = _launch(bob);

        vm.startPrank(alice);
        aapl.approve(address(zap), 5 ether); // 5 AAPL = $1000 = 1000 USDG
        uint256 shares = zap.seedPair(address(pair), address(aapl), 5 ether, 0);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(pair.receiptToken().balanceOf(alice), shares);
        assertEq(pair.creatorEarningsUsdg(), 20 ether);
    }

    // ─── Seed via native RHT ────────────────────────────────

    function test_SeedWithNativeRht() public {
        PairVault pair = _launch(bob);

        // 0.1 RHT = $300 = 300 USDG
        vm.prank(alice);
        uint256 shares = zap.seedPair{value: 0.1 ether}(
            address(pair),
            address(0),
            0,
            0
        );

        assertGt(shares, 0);
        assertEq(pair.receiptToken().balanceOf(alice), shares);
        assertEq(pair.creatorEarningsUsdg(), 6 ether); // 2% of 300
    }

    // ─── First-deposit fee waive via the Zap ────────────────

    function test_CreatorFirstSeedViaZapWaivesFee() public {
        PairVault pair = _launch(alice);

        // Alice (creator) seeds via TSLA — fee should be waived
        vm.startPrank(alice);
        tsla.approve(address(zap), 1 ether);
        uint256 shares = zap.seedPair(address(pair), address(tsla), 1 ether, 0);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(pair.creatorEarningsUsdg(), 0, "creator first seed via zap: no fee");
        assertTrue(pair.creatorDeposited());
    }

    function test_CreatorSecondSeedViaZapTakesFee() public {
        PairVault pair = _launch(alice);

        vm.startPrank(alice);
        tsla.approve(address(zap), 2 ether);
        zap.seedPair(address(pair), address(tsla), 1 ether, 0); // first: waived
        zap.seedPair(address(pair), address(tsla), 1 ether, 0); // second: 2% of 250 = 5
        vm.stopPrank();

        assertEq(pair.creatorEarningsUsdg(), 5 ether);
    }

    // ─── Slippage guard ─────────────────────────────────────

    function test_SlippageMinSharesRevert() public {
        PairVault pair = _launch(bob);

        vm.startPrank(alice);
        usdg.approve(address(zap), 100 ether);
        vm.expectRevert("PairVault: slippage");
        zap.seedPair(address(pair), address(usdg), 100 ether, 10_000 ether);
        vm.stopPrank();
    }

    // ─── Bad inputs ─────────────────────────────────────────

    function test_RejectsUnexpectedValueOnErc20Seed() public {
        PairVault pair = _launch(bob);

        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        usdg.approve(address(zap), 100 ether);
        vm.expectRevert("Zap: unexpected value");
        zap.seedPair{value: 0.01 ether}(address(pair), address(usdg), 100 ether, 0);
        vm.stopPrank();
    }

    function test_RejectsZeroValueNative() public {
        PairVault pair = _launch(bob);
        vm.prank(alice);
        vm.expectRevert("Zap: no value");
        zap.seedPair(address(pair), address(0), 0, 0);
    }

    function test_RejectsZeroPair() public {
        vm.startPrank(alice);
        usdg.approve(address(zap), 100 ether);
        vm.expectRevert("Zap: zero pair");
        zap.seedPair(address(0), address(usdg), 100 ether, 0);
        vm.stopPrank();
    }
}
