// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairVault} from "../src/PairVault.sol";
import {ReceiptToken} from "../src/ReceiptToken.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PriceFeedUpdater} from "../src/PriceFeedUpdater.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWRHT} from "../src/mocks/MockWRHT.sol";

contract PairLaunchpadTest is Test {
    PairFactory factory;
    OracleAdapter oracle;
    EmergencyRegistry emergency;
    PriceFeedUpdater updater;

    MockERC20 tsla;
    MockERC20 amd;
    MockWRHT weth;

    PushPriceFeed tslaFeed;
    PushPriceFeed amdFeed;
    PushPriceFeed wethFeed;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        tsla = new MockERC20("Tesla", "TSLA"); // $250
        amd = new MockERC20("AMD", "AMD"); // $100
        weth = new MockWRHT(); // $2,500

        oracle = new OracleAdapter(address(this));
        emergency = new EmergencyRegistry(address(this));
        updater = new PriceFeedUpdater(address(this));

        tslaFeed = new PushPriceFeed(address(this), address(updater), "TSLA / USD", 250e8);
        amdFeed = new PushPriceFeed(address(this), address(updater), "AMD / USD", 100e8);
        wethFeed = new PushPriceFeed(address(this), address(updater), "ETH / USD", 2_500e8);
        oracle.setPriceFeed(address(tsla), address(tslaFeed));
        oracle.setPriceFeed(address(amd), address(amdFeed));
        oracle.setPriceFeed(address(weth), address(wethFeed));

        factory = new PairFactory(address(this), address(oracle), address(emergency), address(weth), address(new PairDeployer()));
        factory.setTokenListed(address(tsla), true);
        factory.setTokenListed(address(amd), true);
        factory.setTokenListed(address(weth), true);

        tsla.mint(alice, 1_000 ether);
        amd.mint(alice, 1_000 ether);
        tsla.mint(bob, 1_000 ether);
        amd.mint(bob, 1_000 ether);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);

        vm.startPrank(alice);
        tsla.approve(address(factory), type(uint256).max);
        amd.approve(address(factory), type(uint256).max);
        vm.stopPrank();
    }

    // ─── Helpers ────────────────────────────────────────────

    function _params(uint256 amountTsla, uint256 amountAmd) internal view returns (PairFactory.LaunchParams memory) {
        return PairFactory.LaunchParams({
            tokenA: address(tsla),
            tokenB: address(amd),
            weightABps: 6000,
            creatorFeeBps: 200,
            receiptName: "Tesla x AMD",
            receiptSymbol: "TSAMD",
            amountA: amountTsla,
            amountB: amountAmd,
            minShares: 0
        });
    }

    /// 60/40 at $250/$100: 2.4 TSLA ($600) + 4 AMD ($400) = $1,000
    function _launch() internal returns (PairVault pair) {
        vm.prank(alice);
        (address p, , ) = factory.launchPair(_params(2.4 ether, 4 ether));
        return PairVault(p);
    }

    function _balances(PairVault pair) internal view returns (uint256 balTsla, uint256 balAmd) {
        (uint256 a, uint256 b) = pair.reserves();
        (balTsla, balAmd) = pair.tokenA() == address(tsla) ? (a, b) : (b, a);
    }

    function _ordered(PairVault pair, uint256 amountTsla, uint256 amountAmd) internal view returns (uint256, uint256) {
        return pair.tokenA() == address(tsla) ? (amountTsla, amountAmd) : (amountAmd, amountTsla);
    }

    // ─── Launch ─────────────────────────────────────────────

    function test_LaunchSeedsCreatorAtOneDollarPerShare() public {
        PairVault pair = _launch();
        ReceiptToken receipt = pair.receiptToken();

        assertEq(pair.creator(), alice);
        assertEq(factory.pairCount(), 1);
        assertEq(receipt.balanceOf(alice), 1_000e18, "$1,000 seed -> 1,000 shares");
        assertEq(pair.creatorFeeShares(), 0, "creator seed pays no fee");
        assertEq(pair.navUsd8(), 1_000e8);
        assertEq(pair.sharePrice(), 1e8);

        (uint256 balTsla, uint256 balAmd) = _balances(pair);
        assertEq(balTsla, 2.4 ether);
        assertEq(balAmd, 4 ether);
        assertEq(tsla.balanceOf(address(factory)), 0, "factory keeps nothing");
    }

    function test_LaunchWeightAppliesToCallerTokenA() public {
        PairVault pair = _launch();
        uint16 expected = pair.tokenA() == address(tsla) ? 6000 : 4000;
        assertEq(pair.weightABps(), expected);
    }

    function test_LaunchUniquenessReversedOrder() public {
        _launch();
        PairFactory.LaunchParams memory p = _params(4 ether, 2.4 ether);
        p.tokenA = address(amd);
        p.tokenB = address(tsla);
        p.weightABps = 4000;
        vm.prank(alice);
        vm.expectRevert("PairFactory: exists");
        factory.launchPair(p);
    }

    function test_LaunchRejectsWeightMismatch() public {
        vm.prank(alice);
        vm.expectRevert("PairVault: weight mismatch");
        factory.launchPair(_params(2.4 ether, 12 ether)); // 33/67 instead of 60/40
    }

    function test_LaunchRejectsUnlistedToken() public {
        MockERC20 wild = new MockERC20("Wild", "WILD");
        PairFactory.LaunchParams memory p = _params(1 ether, 1 ether);
        p.tokenB = address(wild);
        vm.prank(alice);
        vm.expectRevert("PairFactory: unlisted token");
        factory.launchPair(p);
    }

    function test_ListingRequiresPriceFeed() public {
        MockERC20 wild = new MockERC20("Wild", "WILD");
        vm.expectRevert("PairFactory: no price feed");
        factory.setTokenListed(address(wild), true);
    }

    function test_LaunchRejectsInvalidParams() public {
        PairFactory.LaunchParams memory p = _params(2.4 ether, 4 ether);
        p.weightABps = 500;
        vm.prank(alice);
        vm.expectRevert("PairFactory: invalid weight");
        factory.launchPair(p);

        p = _params(2.4 ether, 4 ether);
        p.creatorFeeBps = 600;
        vm.prank(alice);
        vm.expectRevert("PairFactory: invalid fee");
        factory.launchPair(p);

        p = _params(2.4 ether, 4 ether);
        p.receiptSymbol = "THIS-SYMBOL-IS-TOO-LONG";
        vm.prank(alice);
        vm.expectRevert("PairFactory: invalid symbol");
        factory.launchPair(p);

        p = _params(2.4 ether, 4 ether);
        p.tokenB = address(tsla);
        vm.prank(alice);
        vm.expectRevert("PairFactory: identical tokens");
        factory.launchPair(p);
    }

    function test_LaunchRejectsStalePrice() public {
        vm.warp(block.timestamp + 2 hours);
        vm.prank(alice);
        vm.expectRevert("OracleAdapter: stale");
        factory.launchPair(_params(2.4 ether, 4 ether));
    }

    function test_LaunchRejectsTinySeed() public {
        vm.prank(alice);
        vm.expectRevert("PairVault: seed too small");
        factory.launchPair(_params(0.0012 ether, 0.002 ether)); // $0.50
    }

    function test_LaunchRejectsEthWithoutWethLeg() public {
        vm.prank(alice);
        vm.expectRevert("PairFactory: ETH not accepted");
        factory.launchPair{value: 1 ether}(_params(2.4 ether, 4 ether));
    }

    function test_LaunchWithNativeEth() public {
        // TSLA/WETH 50/50: 4 TSLA ($1,000) + 0.4 ETH ($1,000)
        PairFactory.LaunchParams memory p = _params(4 ether, 0.4 ether);
        p.tokenB = address(weth);
        p.weightABps = 5000;
        vm.prank(alice);
        (address pairAddr, , uint256 shares) = factory.launchPair{value: 0.4 ether}(p);

        assertEq(shares, 2_000e18);
        assertEq(weth.balanceOf(pairAddr), 0.4 ether);
        assertEq(alice.balance, 99.6 ether);
    }

    function test_LaunchRejectsWrongEthAmount() public {
        PairFactory.LaunchParams memory p = _params(4 ether, 0.4 ether);
        p.tokenB = address(weth);
        p.weightABps = 5000;
        vm.prank(alice);
        vm.expectRevert("PairFactory: ETH amount mismatch");
        factory.launchPair{value: 0.5 ether}(p);
    }

    function test_CreatorCap() public {
        MockERC20[] memory tokens = new MockERC20[](11);
        for (uint256 i; i < 11; ++i) {
            tokens[i] = new MockERC20("S", "S");
            oracle.setPriceFeed(
                address(tokens[i]),
                address(new PushPriceFeed(address(this), address(updater), "S / USD", 100e8))
            );
            factory.setTokenListed(address(tokens[i]), true);
            tokens[i].mint(alice, 10 ether);
            vm.prank(alice);
            tokens[i].approve(address(factory), type(uint256).max);
        }

        PairFactory.LaunchParams memory p = _params(2 ether, 3 ether);
        p.tokenA = address(amd);
        p.weightABps = 4000; // 2 AMD ($200) vs 3 S ($300)
        for (uint256 i; i < 10; ++i) {
            p.tokenB = address(tokens[i]);
            vm.prank(alice);
            factory.launchPair(p);
        }
        p.tokenB = address(tokens[10]);
        vm.prank(alice);
        vm.expectRevert("PairFactory: creator cap");
        factory.launchPair(p);
    }

    // ─── Deposit ────────────────────────────────────────────

    function test_PublicDepositReverts() public {
        PairVault pair = _launch();
        (uint256 maxA, uint256 maxB) = _ordered(pair, 1.2 ether, 2 ether);
        vm.startPrank(bob);
        tsla.approve(address(pair), type(uint256).max);
        amd.approve(address(pair), type(uint256).max);
        vm.expectRevert("PairVault: creator only");
        pair.deposit(maxA, maxB, 0);
        vm.expectRevert("PairVault: creator only");
        pair.depositFor(bob, maxA, maxB, 0);
        vm.stopPrank();

        // Not even the creator can mint shares to a stranger.
        vm.startPrank(alice);
        tsla.approve(address(pair), type(uint256).max);
        amd.approve(address(pair), type(uint256).max);
        vm.expectRevert("PairVault: creator only");
        pair.depositFor(bob, maxA, maxB, 0);
        vm.stopPrank();
        assertEq(pair.creatorFeeShares(), 0);
    }

    function test_DepositForCreatorByAnyoneIsAllowed() public {
        PairVault pair = _launch();
        vm.startPrank(bob);
        tsla.approve(address(pair), type(uint256).max);
        amd.approve(address(pair), type(uint256).max);
        // Offer extra AMD; only the proportional amount is pulled.
        (uint256 maxA, uint256 maxB) = _ordered(pair, 1.2 ether, 10 ether);
        uint256 shares = pair.depositFor(alice, maxA, maxB, 0);
        vm.stopPrank();

        // 1.2 TSLA is half the TSLA reserve -> 500 shares, no fee, all to the creator
        assertEq(shares, 500e18);
        assertEq(pair.receiptToken().balanceOf(alice), 1_500e18);
        assertEq(pair.creatorFeeShares(), 0);
        (uint256 balTsla, uint256 balAmd) = _balances(pair);
        assertEq(balTsla, 3.6 ether);
        assertEq(balAmd, 6 ether, "only 2 AMD pulled");
        assertEq(amd.balanceOf(bob), 998 ether);
    }

    function test_CreatorDepositPaysNoFee() public {
        PairVault pair = _launch();
        vm.startPrank(alice);
        tsla.approve(address(pair), type(uint256).max);
        amd.approve(address(pair), type(uint256).max);
        (uint256 maxA, uint256 maxB) = _ordered(pair, 2.4 ether, 4 ether);
        uint256 shares = pair.deposit(maxA, maxB, 0);
        vm.stopPrank();
        assertEq(shares, 1_000e18);
        assertEq(pair.creatorFeeShares(), 0);
    }

    function test_DepositSlippageGuard() public {
        PairVault pair = _launch();
        vm.startPrank(alice);
        tsla.approve(address(pair), type(uint256).max);
        amd.approve(address(pair), type(uint256).max);
        (uint256 maxA, uint256 maxB) = _ordered(pair, 2.4 ether, 4 ether);
        // The creator's deposit mints exactly 1,000 shares; asking for one more must revert.
        vm.expectRevert("PairVault: slippage");
        pair.deposit(maxA, maxB, 1_000e18 + 1);
        vm.stopPrank();
    }

    function test_QuoteDepositMatchesDeposit() public {
        PairVault pair = _launch();
        (uint256 amountA, uint256 amountB, uint256 grossShares) = pair.quoteDeposit(250e8);
        vm.startPrank(alice);
        tsla.approve(address(pair), type(uint256).max);
        amd.approve(address(pair), type(uint256).max);
        uint256 shares = pair.deposit(amountA, amountB, 0);
        vm.stopPrank();
        assertApproxEqAbs(shares, grossShares, 1e6);
    }

    function test_DepositWorksWithStalePriceAfterLaunch() public {
        PairVault pair = _launch();
        vm.warp(block.timestamp + 1 days);
        vm.startPrank(alice);
        tsla.approve(address(pair), type(uint256).max);
        amd.approve(address(pair), type(uint256).max);
        (uint256 maxA, uint256 maxB) = _ordered(pair, 2.4 ether, 4 ether);
        uint256 shares = pair.deposit(maxA, maxB, 0);
        vm.stopPrank();
        assertEq(shares, 1_000e18);
    }

    function test_DepositPaused() public {
        PairVault pair = _launch();
        emergency.setDepositsPaused(true);
        vm.prank(bob);
        vm.expectRevert("PairVault: deposits paused");
        pair.deposit(1 ether, 1 ether, 0);
    }

    function test_NativeEthDepositRefundsExcess() public {
        PairFactory.LaunchParams memory p = _params(4 ether, 0.4 ether);
        p.tokenB = address(weth);
        p.weightABps = 5000;
        vm.prank(alice);
        (address pairAddr, , ) = factory.launchPair{value: 0.4 ether}(p);
        PairVault pair = PairVault(pairAddr);

        vm.startPrank(alice);
        tsla.approve(address(pair), type(uint256).max);
        bool wethIsA = pair.tokenA() == address(weth);
        (uint256 maxA, uint256 maxB) = wethIsA ? (uint256(1 ether), uint256(2 ether)) : (uint256(2 ether), uint256(1 ether));
        pair.deposit{value: 1 ether}(maxA, maxB, 0);
        vm.stopPrank();

        // 0.4 ETH went into the launch; 2 TSLA is half the TSLA reserve -> needs 0.2 ETH; 0.8 ETH refunded
        assertEq(alice.balance, 99.4 ether);
        assertEq(weth.balanceOf(pairAddr), 0.6 ether);
    }

    // ─── Redeem ─────────────────────────────────────────────

    function test_RedeemReturnsBothTokens() public {
        PairVault pair = _launch();
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pair.redeem(500e18, 0, 0);

        (uint256 outTsla, uint256 outAmd) = pair.tokenA() == address(tsla) ? (outA, outB) : (outB, outA);
        assertEq(outTsla, 1.2 ether);
        assertEq(outAmd, 2 ether);
        assertEq(pair.receiptToken().balanceOf(alice), 500e18);
        assertEq(tsla.balanceOf(alice), 1_000 ether - 1.2 ether);
    }

    function test_RedeemWorksWhenPausedAndStale() public {
        PairVault pair = _launch();
        emergency.setDepositsPaused(true);
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        pair.redeem(1_000e18, 0, 0);
        assertEq(pair.totalShares(), 0);
        (uint256 balA, uint256 balB) = pair.reserves();
        assertEq(balA + balB, 0);
    }

    function test_RedeemSlippageAndBalance() public {
        PairVault pair = _launch();
        vm.prank(alice);
        vm.expectRevert("PairVault: slippage");
        pair.redeem(500e18, 100 ether, 0);

        vm.prank(bob);
        vm.expectRevert();
        pair.redeem(1e18, 0, 0);
    }

    function test_SharesAreTransferable() public {
        PairVault pair = _launch();
        ReceiptToken receipt = pair.receiptToken();
        uint256 before = receipt.balanceOf(alice);
        vm.prank(alice);
        receipt.transfer(bob, 1e18);
        assertEq(receipt.balanceOf(bob), 1e18);
        assertEq(receipt.balanceOf(alice), before - 1e18);
    }

    function test_LaunchWithZeroFee() public {
        PairFactory.LaunchParams memory p = _params(2.4 ether, 4 ether);
        p.creatorFeeBps = 0;
        vm.prank(alice);
        (address pairAddr, , uint256 shares) = factory.launchPair(p);
        assertEq(shares, 1_000e18);
        assertEq(PairVault(pairAddr).creatorFeeBps(), 0);
    }

    /// Redeem stays open: a holder who received shares by transfer (e.g. a token seller) can exit.
    function test_TransferredHolderCanRedeem() public {
        PairVault pair = _launch();
        ReceiptToken receipt = pair.receiptToken();
        vm.prank(alice);
        receipt.transfer(bob, 100e18);
        uint256 tslaBefore = tsla.balanceOf(bob);
        uint256 amdBefore = amd.balanceOf(bob);
        vm.prank(bob);
        (uint256 outA, uint256 outB) = pair.redeem(100e18, 0, 0);
        assertGt(outA, 0);
        assertGt(outB, 0);
        (uint256 gotTsla, uint256 gotAmd) = pair.tokenA() == address(tsla) ? (outA, outB) : (outB, outA);
        assertEq(tsla.balanceOf(bob) - tslaBefore, gotTsla);
        assertEq(amd.balanceOf(bob) - amdBefore, gotAmd);
        assertEq(receipt.balanceOf(bob), 0);
    }

    // ─── Oracle feed + factory views ────────────────────────

    function test_PriceFeedUpdaterPushesPrices() public {
        address[] memory feeds = new address[](2);
        feeds[0] = address(tslaFeed);
        feeds[1] = address(amdFeed);
        int256[] memory answers = new int256[](2);
        answers[0] = 300e8;
        answers[1] = 120e8;
        updater.pushPrices(feeds, answers);
        assertEq(oracle.getPrice(address(tsla)), 300e8);
        assertEq(oracle.getPrice(address(amd)), 120e8);

        vm.prank(bob);
        vm.expectRevert("PriceFeedUpdater: not keeper");
        updater.pushPrices(feeds, answers);
    }

    function test_NavTracksPrices() public {
        PairVault pair = _launch();
        vm.prank(address(updater));
        tslaFeed.updateAnswer(500e8); // TSLA doubles
        assertEq(pair.navUsd8(), 1_600e8);
        assertEq(pair.sharePrice(), 1.6e8);
    }

    function test_FactoryViews() public {
        PairVault pair = _launch();
        (address found, address receipt) = factory.getPair(address(amd), address(tsla));
        assertEq(found, address(pair));
        assertEq(receipt, address(pair.receiptToken()));
        assertTrue(factory.isPair(address(pair)));
        assertEq(factory.listedTokens().length, 3);

        factory.setTokenListed(address(amd), false);
        assertEq(factory.listedTokens().length, 2);
    }
}
