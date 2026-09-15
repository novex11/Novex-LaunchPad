// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairVault} from "../src/PairVault.sol";
import {PairRouter} from "../src/PairRouter.sol";
import {ComposeCurve} from "../src/ComposeCurve.sol";
import {CurveRouter} from "../src/CurveRouter.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PriceFeedUpdater} from "../src/PriceFeedUpdater.sol";
import {OracleSwapRouter} from "../src/testnet/OracleSwapRouter.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";
import {FixedPriceFeed} from "../src/testnet/FixedPriceFeed.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWRHT} from "../src/mocks/MockWRHT.sol";

contract ComposeCurveTest is Test {
    uint24 constant POOL_FEE = 3000;
    uint256 constant START_MCAP_USD8 = 50e8; // $50 at $1/share -> Q0 = 50 shares
    uint256 constant SUPPLY = 1_000_000_000e18;

    PairFactory factory;
    OracleAdapter oracle;
    EmergencyRegistry emergency;
    PriceFeedUpdater updater;
    OracleSwapRouter swapRouter;
    PairRouter router;
    ComposeCurve curve;
    CurveRouter curveRouter;

    MockERC20 tsla; // $250
    MockERC20 amd; // $100
    MockWRHT weth; // $2,500
    TestUSDG usdg;

    PairVault pair;
    IERC20 share;

    address alice = address(0xA11CE); // pair creator
    address bob = address(0xB0B);
    address carol = address(0xCA201);
    address treasury = address(0x7EA5);

    function setUp() public {
        vm.warp(1_000);
        tsla = new MockERC20("Tesla", "TSLA");
        amd = new MockERC20("AMD", "AMD");
        weth = new MockWRHT();
        usdg = new TestUSDG(address(this));

        oracle = new OracleAdapter(address(this));
        emergency = new EmergencyRegistry(address(this));
        updater = new PriceFeedUpdater(address(this));
        oracle.setPriceFeed(address(tsla), address(new PushPriceFeed(address(this), address(updater), "TSLA / USD", 250e8)));
        oracle.setPriceFeed(address(amd), address(new PushPriceFeed(address(this), address(updater), "AMD / USD", 100e8)));
        oracle.setPriceFeed(address(weth), address(new PushPriceFeed(address(this), address(updater), "ETH / USD", 2_500e8)));
        oracle.setPriceFeed(address(usdg), address(new FixedPriceFeed("USDG / USD", 1e8)));

        factory = new PairFactory(address(this), address(oracle), address(emergency), address(weth), address(new PairDeployer()));
        factory.setTokenListed(address(tsla), true);
        factory.setTokenListed(address(amd), true);
        factory.setTokenListed(address(weth), true);

        swapRouter = new OracleSwapRouter(address(this), address(oracle));
        router = new PairRouter(address(factory), address(swapRouter), address(usdg));
        curve = new ComposeCurve(address(this), address(factory), treasury, START_MCAP_USD8);
        curveRouter = new CurveRouter(address(curve), address(router));

        tsla.mint(address(swapRouter), 10_000 ether);
        amd.mint(address(swapRouter), 10_000 ether);
        usdg.mint(address(swapRouter), 10_000_000e6);
        weth.mint(address(swapRouter), 1_000 ether);
        vm.deal(address(weth), 1_000 ether);

        tsla.mint(alice, 1_000 ether);
        amd.mint(alice, 1_000 ether);
        usdg.mint(bob, 100_000e6);
        vm.deal(bob, 100 ether);

        // Alice launches TSLA/AMD 60/40 with $1,000 -> 1,000 shares at $1.00
        vm.startPrank(alice);
        tsla.approve(address(factory), type(uint256).max);
        amd.approve(address(factory), type(uint256).max);
        (address p, , ) = factory.launchPair(
            PairFactory.LaunchParams({
                tokenA: address(tsla),
                tokenB: address(amd),
                weightABps: 6000,
                creatorFeeBps: 200,
                receiptName: "Tesla x AMD",
                receiptSymbol: "TSAMD",
                amountA: 2.4 ether,
                amountB: 4 ether,
                minShares: 0
            })
        );
        vm.stopPrank();
        pair = PairVault(p);
        share = IERC20(address(pair.receiptToken()));

        // Alice gives bob and carol some shares to trade with.
        vm.startPrank(alice);
        share.transfer(bob, 300e18);
        share.transfer(carol, 100e18);
        vm.stopPrank();
    }

    // ─── Helpers ────────────────────────────────────────────

    function _create(uint256 devBuyShares) internal returns (address token) {
        vm.startPrank(alice);
        share.approve(address(curve), devBuyShares);
        (token, ) = curve.createToken(address(pair), "Tesla AMD Meme", "TAM", devBuyShares, 0);
        vm.stopPrank();
    }

    function _state(address token)
        internal
        view
        returns (uint256 q, uint256 t, uint256 realQuote, uint256 gradQuote, bool graduated)
    {
        (, , , q, t, realQuote, gradQuote, , graduated) = curve.curves(token);
    }

    function _buy(address who, address token, uint256 shares) internal returns (uint256 out) {
        vm.startPrank(who);
        share.approve(address(curve), shares);
        out = curve.buy(token, shares, 0, who);
        vm.stopPrank();
    }

    function _sell(address who, address token, uint256 tokens) internal returns (uint256 out) {
        vm.startPrank(who);
        IERC20(token).approve(address(curve), tokens);
        out = curve.sell(token, tokens, 0, who);
        vm.stopPrank();
    }

    function _pastLaunch() internal {
        vm.warp(block.timestamp + curve.SNIPE_WINDOW());
    }

    function _path(address from, address to) internal pure returns (bytes memory) {
        return abi.encodePacked(from, POOL_FEE, to);
    }

    // ─── Launch ─────────────────────────────────────────────

    function test_CreateTokenStartsAtPonsShape() public {
        address token = _create(0);
        (uint256 q, uint256 t, uint256 realQuote, uint256 gradQuote, bool graduated) = _state(token);

        assertEq(q, 50e18, "virtual quote = $50 of shares at $1");
        assertEq(t, SUPPLY, "whole supply on the curve");
        assertEq(realQuote, 0);
        assertEq(gradQuote, 154.88e18, "graduates at 3.0976x Q0");
        assertFalse(graduated);
        assertEq(IERC20(token).balanceOf(address(curve)), SUPPLY);
        assertEq(curve.marketCapUsd8(token), 50e8);
        address[] memory onPair = curve.tokensOfPair(address(pair));
        assertEq(onPair.length, 1);
        assertEq(onPair[0], token);
        assertEq(curve.tokenCount(), 1);
    }

    function test_AnyWalletLaunchesManyTokensPerPair() public {
        vm.expectRevert("ComposeCurve: unknown pair");
        curve.createToken(address(0xDEAD), "X", "X", 0, 0);

        address first = _create(0);
        vm.prank(bob);
        (address second, ) = curve.createToken(address(pair), "Bob Meme", "BOB", 0, 0);
        vm.prank(carol);
        (address third, ) = curve.createToken(address(pair), "Carol Meme", "CAR", 0, 0);

        assertEq(curve.pairTokenCount(address(pair)), 3);
        address[] memory onPair = curve.tokensOfPair(address(pair));
        assertEq(onPair[0], first);
        assertEq(onPair[1], second);
        assertEq(onPair[2], third);
        (, , address creator, , , , , , ) = curve.curves(second);
        assertEq(creator, bob, "launcher owns the token");
        assertEq(curve.marketCapUsd8(third), 50e8, "every token starts at the same mcap");
    }

    // ─── Math & fees ────────────────────────────────────────

    function test_BuyMathAndFeeSplit() public {
        address token = _create(0);
        _pastLaunch();

        uint256 expected = SUPPLY - Math.mulDiv(50e18, SUPPLY, 50e18 + 9.9e18, Math.Rounding.Ceil);
        (uint256 quoted, uint256 quotedFee) = curve.quoteBuy(token, 10e18);
        uint256 out = _buy(bob, token, 10e18);

        assertEq(out, expected);
        assertEq(quoted, out);
        assertEq(quotedFee, 0.1e18);
        assertEq(curve.creatorFees(token), 0.06e18);
        assertEq(curve.pairCreatorFees(address(pair)), 0.01e18);
        assertEq(curve.protocolFees(address(share)), 0.03e18);
        (, , uint256 realQuote, , ) = _state(token);
        assertEq(realQuote, 9.9e18);
        assertEq(share.balanceOf(address(curve)), 10e18, "curve holds reserve + fees");
    }

    function test_RoundTripLosesOnlyFees() public {
        address token = _create(0);
        _pastLaunch();
        uint256 out = _buy(bob, token, 10e18);
        (uint256 quotedShares, ) = curve.quoteSell(token, out);
        uint256 back = _sell(bob, token, out);

        assertEq(back, quotedShares);
        assertLe(back, 9.801e18, "1% in + 1% out");
        assertGe(back, 9.8e18);
        (uint256 q, uint256 t, uint256 realQuote, , ) = _state(token);
        assertEq(t, SUPPLY);
        assertLe(realQuote, 1, "reserve back to ~zero");
        assertGe(q, 50e18);
        assertEq(share.balanceOf(address(curve)), realQuote + _fees(token));
    }

    function _fees(address token) internal view returns (uint256) {
        return curve.creatorFees(token) + curve.pairCreatorFees(address(pair)) + curve.protocolFees(address(share));
    }

    function testFuzz_BuySellNeverProfits(uint256 sharesIn) public {
        sharesIn = bound(sharesIn, 1e12, 290e18);
        address token = _create(0);
        _pastLaunch();
        uint256 out = _buy(bob, token, sharesIn);
        uint256 back = _sell(bob, token, out);
        assertLe(back, sharesIn);
    }

    function test_SolvencyWithManyTraders() public {
        address token = _create(0);
        _pastLaunch();
        uint256 b1 = _buy(bob, token, 40e18);
        uint256 c1 = _buy(carol, token, 60e18);
        uint256 b2 = _buy(bob, token, 25e18);
        _sell(carol, token, c1);
        _sell(bob, token, b1 + b2);

        (, uint256 t, uint256 realQuote, , ) = _state(token);
        assertEq(t, SUPPLY);
        assertEq(share.balanceOf(address(curve)), realQuote + _fees(token));
    }

    // ─── Graduation ─────────────────────────────────────────

    function test_GraduatesAtPonsMultipleAndKeepsTrading() public {
        address token = _create(0);
        _pastLaunch();
        assertEq(curve.progressBps(token), 0);

        uint256 half = _buy(bob, token, 78e18);
        assertApproxEqAbs(curve.progressBps(token), 4986, 5);

        _buy(bob, token, 80e18); // crosses 154.88 shares of real quote
        (, , uint256 realQuote, , bool graduated) = _state(token);
        assertTrue(graduated);
        assertGe(realQuote, 154.88e18);
        assertEq(curve.progressBps(token), 10_000);

        // Constant product: mcap = start × ((Q0 + R) / Q0)^2 for R real shares paired.
        uint256 expected = Math.mulDiv(50e8, (50e18 + realQuote) * (50e18 + realQuote), 50e18 * 50e18);
        assertApproxEqRel(curve.marketCapUsd8(token), expected, 0.0001e18);
        // At exactly the threshold that is (1 + 3.0976)^2 ≈ 16.79x the start, matching Pons.
        uint256 atThreshold = Math.mulDiv(50e8, (50e18 + 154.88e18) * (50e18 + 154.88e18), 50e18 * 50e18);
        assertApproxEqRel(atThreshold, 50e8 * 16.79, 0.001e18);

        uint256 back = _sell(bob, token, half);
        assertGt(back, 0, "trading continues after graduation");
        (, , , , graduated) = _state(token);
        assertTrue(graduated, "graduation is permanent");
    }

    // ─── Launch protections ─────────────────────────────────

    function test_LaunchSecondIsCreatorOnly() public {
        address token = _create(0);
        vm.startPrank(bob);
        share.approve(address(curve), 1e18);
        vm.expectRevert("ComposeCurve: launch block is creator-only");
        curve.buy(token, 1e18, 0, bob);
        vm.stopPrank();
    }

    function test_LaunchWindowCapsBuysAndWallets() public {
        address token = _create(0);
        vm.warp(block.timestamp + 1);

        vm.startPrank(bob);
        share.approve(address(curve), type(uint256).max);
        vm.expectRevert("ComposeCurve: max buy during launch");
        curve.buy(token, 3.3e18, 0, bob); // ~6% of supply

        curve.buy(token, 2.13e18, 0, bob); // ~4%
        vm.expectRevert("ComposeCurve: max wallet during launch");
        curve.buy(token, 2.13e18, 0, bob); // would exceed 5% per wallet
        vm.stopPrank();

        _pastLaunch();
        _buy(bob, token, 20e18); // unrestricted after the window
    }

    function test_DevBuyCappedAtFivePercent() public {
        address token = _create(2.1e18); // ~4% of supply
        assertGt(IERC20(token).balanceOf(alice), 0);
        assertLe(IERC20(token).balanceOf(alice), (SUPPLY * 5) / 100);

        // A fresh pair so the creator can try an oversized dev buy.
        vm.startPrank(alice);
        MockERC20 nflx = new MockERC20("Netflix", "NFLX");
        vm.stopPrank();
        oracle.setPriceFeed(address(nflx), address(new PushPriceFeed(address(this), address(updater), "NFLX / USD", 100e8)));
        factory.setTokenListed(address(nflx), true);
        nflx.mint(alice, 100 ether);
        vm.startPrank(alice);
        nflx.approve(address(factory), type(uint256).max);
        (address p2, , ) = factory.launchPair(
            PairFactory.LaunchParams({
                tokenA: address(nflx),
                tokenB: address(amd),
                weightABps: 5000,
                creatorFeeBps: 200,
                receiptName: "Netflix x AMD",
                receiptSymbol: "NXAMD",
                amountA: 5 ether,
                amountB: 5 ether,
                minShares: 0
            })
        );
        IERC20(address(PairVault(p2).receiptToken())).approve(address(curve), 10e18);
        vm.expectRevert();
        curve.createToken(p2, "Too Big", "BIG", 10e18, 0); // ~16% of supply
        vm.stopPrank();
    }

    function test_SlippageGuards() public {
        address token = _create(0);
        _pastLaunch();
        vm.startPrank(bob);
        share.approve(address(curve), 10e18);
        vm.expectRevert("ComposeCurve: slippage");
        curve.buy(token, 10e18, SUPPLY, bob);
        vm.stopPrank();
    }

    // ─── Fees ───────────────────────────────────────────────

    function test_ClaimCreatorAndProtocolFees() public {
        address token = _create(0);
        _pastLaunch();
        _buy(bob, token, 100e18);
        uint256 aliceBefore = share.balanceOf(alice);

        uint256 claimed = curve.claimCreatorFees(token); // anyone may trigger; pays the creator
        assertEq(claimed, 0.6e18);
        assertEq(share.balanceOf(alice) - aliceBefore, 0.6e18);

        curve.withdrawProtocolFees(address(share));
        assertEq(share.balanceOf(treasury), 0.3e18);

        vm.expectRevert("ComposeCurve: no fees");
        curve.claimCreatorFees(token);
    }

    function test_PairCreatorEarnsFromOtherLaunchersTokens() public {
        vm.prank(bob);
        (address bobToken, ) = curve.createToken(address(pair), "Bob Meme", "BOB", 0, 0);
        vm.prank(carol);
        (address carolToken, ) = curve.createToken(address(pair), "Carol Meme", "CAR", 0, 0);
        _pastLaunch();
        _buy(bob, carolToken, 50e18);
        _buy(carol, bobToken, 50e18);

        assertEq(curve.creatorFees(bobToken), 0.3e18);
        assertEq(curve.creatorFees(carolToken), 0.3e18);
        assertEq(curve.pairCreatorFees(address(pair)), 0.1e18, "10% of both tokens' fees");

        uint256 aliceBefore = share.balanceOf(alice);
        uint256 bobBefore = share.balanceOf(bob);
        vm.prank(carol); // anyone may trigger
        assertEq(curve.claimPairCreatorFees(address(pair)), 0.1e18);
        assertEq(share.balanceOf(alice) - aliceBefore, 0.1e18, "paid to the pair creator");

        curve.claimCreatorFees(bobToken);
        assertEq(share.balanceOf(bob) - bobBefore, 0.3e18, "paid to the token launcher");

        vm.expectRevert("ComposeCurve: no fees");
        curve.claimPairCreatorFees(address(pair));
    }

    // ─── CurveRouter (ETH / USDG) ───────────────────────────

    function test_RouterBuyWithUsdgSellForEth() public {
        address token = _create(0);
        _pastLaunch();

        CurveRouter.BuyParams memory buyParams = CurveRouter.BuyParams({
            token: token,
            payToken: address(usdg),
            amountIn: 20e6,
            pathA: _path(address(usdg), pair.tokenA()),
            pathB: _path(address(usdg), pair.tokenB()),
            minTokensOut: 0,
            maxSlippageBps: 100,
            deadline: block.timestamp + 1 hours
        });
        vm.startPrank(bob);
        usdg.approve(address(curveRouter), 20e6);
        uint256 tokensOut = curveRouter.buy(buyParams);
        vm.stopPrank();

        assertGt(tokensOut, 0);
        assertEq(IERC20(token).balanceOf(bob), tokensOut);
        (, , uint256 realQuote, , ) = _state(token);
        // $20 -> 0.3% swap fee -> 2% pair creator fee -> 1% curve fee
        assertApproxEqRel(realQuote, 19.34e18, 0.01e18);
        _assertRoutersEmpty(token);

        CurveRouter.SellParams memory sellParams = CurveRouter.SellParams({
            token: token,
            tokensIn: tokensOut,
            receiveToken: address(weth),
            pathA: _path(pair.tokenA(), address(weth)),
            pathB: _path(pair.tokenB(), address(weth)),
            minAmountOut: 0,
            maxSlippageBps: 100,
            unwrapEth: true,
            deadline: block.timestamp + 1 hours
        });
        uint256 ethBefore = bob.balance;
        vm.startPrank(bob);
        IERC20(token).approve(address(curveRouter), tokensOut);
        uint256 ethOut = curveRouter.sell(sellParams);
        vm.stopPrank();

        assertGt(ethOut, 0);
        assertEq(bob.balance - ethBefore, ethOut);
        assertEq(IERC20(token).balanceOf(bob), 0);
        _assertRoutersEmpty(token);
    }

    function test_RouterBuyWithEth() public {
        address token = _create(0);
        _pastLaunch();
        CurveRouter.BuyParams memory buyParams = CurveRouter.BuyParams({
            token: token,
            payToken: address(weth),
            amountIn: 0.008 ether,
            pathA: _path(address(weth), pair.tokenA()),
            pathB: _path(address(weth), pair.tokenB()),
            minTokensOut: 0,
            maxSlippageBps: 100,
            deadline: block.timestamp + 1 hours
        });
        vm.prank(bob);
        uint256 tokensOut = curveRouter.buy{value: 0.008 ether}(buyParams);
        assertEq(IERC20(token).balanceOf(bob), tokensOut);
        assertGt(tokensOut, 0);
        _assertRoutersEmpty(token);
    }

    function _assertRoutersEmpty(address token) internal view {
        address[2] memory holders = [address(curveRouter), address(router)];
        for (uint256 i; i < 2; ++i) {
            assertEq(tsla.balanceOf(holders[i]), 0, "TSLA");
            assertEq(amd.balanceOf(holders[i]), 0, "AMD");
            assertEq(usdg.balanceOf(holders[i]), 0, "USDG");
            assertEq(weth.balanceOf(holders[i]), 0, "WETH");
            assertEq(share.balanceOf(holders[i]), 0, "shares");
            assertEq(IERC20(token).balanceOf(holders[i]), 0, "token");
            assertEq(holders[i].balance, 0, "ETH");
        }
    }
}
