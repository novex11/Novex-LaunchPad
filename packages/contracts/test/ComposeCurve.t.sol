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
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
        (token, ) = curve.createToken(address(pair), devBuyShares, 0);
        vm.stopPrank();
    }

    /// @dev A second NFLX/AMD pair created by `creator`, seeded with $1,000 at $1/share.
    function _secondPair(address creator) internal returns (PairVault p2, IERC20 share2) {
        MockERC20 nflx = new MockERC20("Netflix", "NFLX");
        oracle.setPriceFeed(address(nflx), address(new PushPriceFeed(address(this), address(updater), "NFLX / USD", 100e8)));
        factory.setTokenListed(address(nflx), true);
        nflx.mint(creator, 100 ether);
        amd.mint(creator, 100 ether);
        vm.startPrank(creator);
        nflx.approve(address(factory), type(uint256).max);
        amd.approve(address(factory), type(uint256).max);
        (address addr, , ) = factory.launchPair(
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
        vm.stopPrank();
        p2 = PairVault(addr);
        share2 = IERC20(address(p2.receiptToken()));
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

    function test_UnknownPairReverts() public {
        vm.prank(alice);
        vm.expectRevert("ComposeCurve: unknown pair");
        curve.createToken(address(0xDEAD), 0, 0);
    }

    function test_OneTokenPerPair() public {
        address token = _create(0);
        assertEq(curve.tokenOfPair(address(pair)), token);
        assertEq(curve.pairTokenCount(address(pair)), 1);

        vm.prank(alice);
        vm.expectRevert("ComposeCurve: pair already has a token");
        curve.createToken(address(pair), 0, 0);
        assertEq(curve.pairTokenCount(address(pair)), 1, "still one token");
    }

    function test_OnlyPairCreatorLaunches() public {
        vm.prank(bob);
        vm.expectRevert("ComposeCurve: only pair creator");
        curve.createToken(address(pair), 0, 0);
        vm.prank(carol);
        vm.expectRevert("ComposeCurve: only pair creator");
        curve.createToken(address(pair), 0, 0);
        assertEq(curve.tokenOfPair(address(pair)), address(0), "nothing launched");

        address token = _create(0);
        (, , address creator, , , , , , ) = curve.curves(token);
        assertEq(creator, alice, "pair creator owns the token");
    }

    function test_TokenInheritsPairIdentity() public {
        address token = _create(0);
        assertEq(IERC20Metadata(token).name(), IERC20Metadata(address(share)).name());
        assertEq(IERC20Metadata(token).symbol(), IERC20Metadata(address(share)).symbol());
        assertEq(IERC20Metadata(token).name(), "Tesla x AMD");
        assertEq(IERC20Metadata(token).symbol(), "TSAMD");
    }

    function test_CreatorGetsNoSupplyWithoutDevBuy() public {
        address token = _create(0);
        assertEq(IERC20(token).totalSupply(), SUPPLY);
        assertEq(IERC20(token).balanceOf(alice), 0, "creator receives nothing at launch");
        assertEq(IERC20(token).balanceOf(address(curve)), SUPPLY, "whole supply on the curve");
        (, uint256 t, , , ) = _state(token);
        assertEq(t, SUPPLY);
    }

    function test_DevBuyComesOutOfTheCurve() public {
        address token = _create(2.1e18); // ~4% of supply
        uint256 dev = IERC20(token).balanceOf(alice);
        assertGt(dev, 0);
        assertLe(dev, (SUPPLY * 5) / 100, "dev buy capped at 5%");
        assertEq(IERC20(token).balanceOf(address(curve)), SUPPLY - dev, "curve holds the rest");
        (, uint256 t, uint256 realQuote, , ) = _state(token);
        assertEq(t, SUPPLY - dev);
        assertEq(realQuote, 2.1e18 - 0.021e18, "dev buy paid the 1% fee like any buy");
    }

    function test_TokenOfPairEmptyBeforeLaunch() public {
        assertEq(curve.tokenOfPair(address(pair)), address(0));
        address[] memory none = curve.tokensOfPair(address(pair));
        assertEq(none.length, 0);
        (PairVault p2, ) = _secondPair(carol);
        assertEq(curve.tokenOfPair(address(p2)), address(0));
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
        assertEq(curve.creatorFees(token), 0.07e18, "70% creator");
        assertEq(curve.protocolFees(address(share)), 0.03e18, "30% protocol");
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
        return curve.creatorFees(token) + curve.protocolFees(address(share));
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

        // A fresh pair so its creator can try an oversized dev buy.
        (PairVault p2, IERC20 share2) = _secondPair(carol);
        vm.startPrank(carol);
        share2.approve(address(curve), 10e18);
        vm.expectRevert();
        curve.createToken(address(p2), 10e18, 0); // ~16% of supply
        vm.stopPrank();
        assertEq(curve.tokenOfPair(address(p2)), address(0), "reverted launch leaves no token");
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
        assertEq(claimed, 0.7e18);
        assertEq(share.balanceOf(alice) - aliceBefore, 0.7e18);

        curve.withdrawProtocolFees(address(share));
        assertEq(share.balanceOf(treasury), 0.3e18);

        vm.expectRevert("ComposeCurve: no fees");
        curve.claimCreatorFees(token);
    }

    function test_FeesAccrueSeparatelyPerToken() public {
        address aliceToken = _create(0);
        (PairVault p2, IERC20 share2) = _secondPair(carol);
        vm.prank(carol);
        (address carolToken, ) = curve.createToken(address(p2), 0, 0);
        _pastLaunch();

        _buy(bob, aliceToken, 50e18);
        vm.startPrank(carol);
        share2.approve(address(curve), 50e18);
        curve.buy(carolToken, 50e18, 0, carol);
        vm.stopPrank();

        assertEq(curve.creatorFees(aliceToken), 0.35e18, "70% of the 1% fee");
        assertEq(curve.creatorFees(carolToken), 0.35e18);
        assertEq(curve.protocolFees(address(share)), 0.15e18);
        assertEq(curve.protocolFees(address(share2)), 0.15e18);

        uint256 carolBefore = share2.balanceOf(carol);
        vm.prank(bob); // anyone may trigger
        curve.claimCreatorFees(carolToken);
        assertEq(share2.balanceOf(carol) - carolBefore, 0.35e18, "paid in that pair's shares");
    }

    // ─── Pair deposit fee exemption ─────────────────────────

    function test_SetFeeExemptIsOwnerOnlyAndEmits() public {
        vm.prank(bob);
        vm.expectRevert();
        factory.setFeeExempt(address(curveRouter), true);

        vm.expectRevert("PairFactory: zero recipient");
        factory.setFeeExempt(address(0), true);

        vm.expectEmit(true, false, false, true, address(factory));
        emit PairFactory.FeeExemptSet(address(curveRouter), true);
        factory.setFeeExempt(address(curveRouter), true);
        assertTrue(factory.feeExemptRecipients(address(curveRouter)));
        factory.setFeeExempt(address(curveRouter), false);
        assertFalse(factory.feeExemptRecipients(address(curveRouter)));
    }

    function test_RouterBuysPayPairFeeWithoutExemption() public {
        address token = _create(0);
        _pastLaunch();
        uint256 feeBefore = pair.creatorFeeShares();
        _buyWithStocks(token);
        assertGt(pair.creatorFeeShares(), feeBefore, "2% pair fee charged on the router's deposit");
    }

    function test_ExemptRouterSkipsPairFeeButUsersStillPay() public {
        factory.setFeeExempt(address(curveRouter), true);
        address token = _create(0);
        _pastLaunch();
        uint256 feeBefore = pair.creatorFeeShares();
        uint256 supplyBefore = share.totalSupply();

        // Stocks path: recipient of the deposit is CurveRouter -> no pair fee.
        tsla.mint(bob, 10 ether);
        amd.mint(bob, 10 ether);
        (uint256 balA, uint256 balB) = pair.reserves();
        (uint256 grossShares, , ) = pair.previewDeposit(balA / 10, balB / 5);
        (uint256 quoted, ) = curve.quoteBuy(token, grossShares);
        vm.startPrank(bob);
        IERC20(pair.tokenA()).approve(address(curveRouter), balA / 10);
        IERC20(pair.tokenB()).approve(address(curveRouter), balB / 5);
        uint256 tokensOut = curveRouter.buyWithStocks(token, balA / 10, balB / 5, quoted);
        vm.stopPrank();
        assertEq(tokensOut, quoted, "the full gross shares reach the curve");
        assertEq(pair.creatorFeeShares(), feeBefore, "no pair fee");
        assertEq(share.totalSupply() - supplyBefore, grossShares, "only the curve's shares were minted");
        (, , uint256 realQuote, , ) = _state(token);
        assertEq(realQuote, grossShares - grossShares / 100, "only the 1% curve fee");

        // ETH path: PairRouter deposits with CurveRouter as recipient -> still no pair fee.
        supplyBefore = share.totalSupply();
        uint256 curveShares = share.balanceOf(address(curve));
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
        curveRouter.buy{value: 0.008 ether}(buyParams);
        assertEq(pair.creatorFeeShares(), feeBefore, "no pair fee on the ETH path either");
        assertEq(share.totalSupply() - supplyBefore, share.balanceOf(address(curve)) - curveShares, "every minted share went to the curve");

        // A plain pair buy by a normal wallet still pays the creator fee.
        PairRouter.BuyParams memory pairBuy = PairRouter.BuyParams({
            pair: address(pair),
            payToken: address(weth),
            amountIn: 0.008 ether,
            pathA: _path(address(weth), pair.tokenA()),
            pathB: _path(address(weth), pair.tokenB()),
            minShares: 0,
            maxSlippageBps: 100,
            deadline: block.timestamp + 1 hours
        });
        vm.prank(bob);
        router.buy{value: 0.008 ether}(pairBuy);
        assertGt(pair.creatorFeeShares(), feeBefore, "regular depositors still pay the pair fee");
        _assertRoutersEmpty(token);
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

    // ─── CurveRouter (stocks, no swap) ──────────────────────

    function _buyWithStocks(address token) internal returns (uint256 tokensOut, uint256 netShares) {
        tsla.mint(bob, 10 ether);
        amd.mint(bob, 10 ether);
        // 10% of the reserves ($100); offer twice the needed B so only the proportional amount is pulled.
        (uint256 balA, uint256 balB) = pair.reserves();
        (uint256 grossShares, uint256 usedA, uint256 usedB) = pair.previewDeposit(balA / 10, balB / 5);
        assertEq(usedA, balA / 10);
        assertEq(usedB, balB / 10, "proportional B leg");
        netShares = grossShares - (grossShares * 200) / 10_000; // 2% pair creator fee
        (uint256 quoted, ) = curve.quoteBuy(token, netShares);

        vm.startPrank(bob);
        IERC20(pair.tokenA()).approve(address(curveRouter), balA / 10);
        IERC20(pair.tokenB()).approve(address(curveRouter), balB / 5);
        tokensOut = curveRouter.buyWithStocks(token, balA / 10, balB / 5, quoted);
        vm.stopPrank();
        assertEq(tokensOut, quoted);
    }

    function test_RouterBuyWithStocks() public {
        address token = _create(0);
        _pastLaunch();
        (uint256 balA, uint256 balB) = pair.reserves();
        (uint256 tokensOut, uint256 netShares) = _buyWithStocks(token);

        assertEq(IERC20(token).balanceOf(bob), tokensOut);
        assertEq(IERC20(pair.tokenA()).balanceOf(bob), 10 ether - balA / 10);
        assertEq(IERC20(pair.tokenB()).balanceOf(bob), 10 ether - balB / 10, "unused B never left the wallet");
        (, , uint256 realQuote, , ) = _state(token);
        assertEq(realQuote, netShares - netShares / 100, "$100 of stock -> 2% pair fee -> 1% curve fee");
        assertApproxEqRel(realQuote, 97.02e18, 0.001e18);
        _assertRoutersEmpty(token);
    }

    function test_RouterSellForStocks() public {
        address token = _create(0);
        _pastLaunch();
        (uint256 tokensOut, ) = _buyWithStocks(token);
        IERC20 a = IERC20(pair.tokenA());
        IERC20 b = IERC20(pair.tokenB());

        (uint256 sharesBack, ) = curve.quoteSell(token, tokensOut);
        (uint256 expectA, uint256 expectB, ) = pair.quoteRedeem(sharesBack);
        uint256 aBefore = a.balanceOf(bob);
        uint256 bBefore = b.balanceOf(bob);
        vm.startPrank(bob);
        IERC20(token).approve(address(curveRouter), tokensOut);
        (uint256 outA, uint256 outB) = curveRouter.sellForStocks(token, tokensOut, expectA, expectB);
        vm.stopPrank();

        assertEq(outA, expectA);
        assertEq(outB, expectB);
        assertEq(a.balanceOf(bob) - aBefore, outA);
        assertEq(b.balanceOf(bob) - bBefore, outB);
        assertEq(IERC20(token).balanceOf(bob), 0);
        // Round trip: 2% pair fee in, 1% curve fee each way -> ~96% of the stock comes back.
        (uint256 balA, ) = pair.reserves();
        assertLt(outA, balA / 10);
        assertGt(outA, (balA / 10) * 95 / 100, "round trip loses only fees");
        _assertRoutersEmpty(token);
    }

    function test_RouterStockMinOutGuards() public {
        address token = _create(0);
        _pastLaunch();
        tsla.mint(bob, 1 ether);
        amd.mint(bob, 1 ether);

        vm.startPrank(bob);
        tsla.approve(address(curveRouter), 1 ether);
        amd.approve(address(curveRouter), 1 ether);
        vm.expectRevert("ComposeCurve: slippage");
        curveRouter.buyWithStocks(token, 0.24 ether, 0.24 ether, SUPPLY);
        vm.expectRevert("CurveRouter: zero amount");
        curveRouter.buyWithStocks(token, 0, 0, 0);

        uint256 tokensOut = curveRouter.buyWithStocks(token, 0.24 ether, 0.24 ether, 0);
        IERC20(token).approve(address(curveRouter), tokensOut);
        vm.expectRevert("PairVault: slippage");
        curveRouter.sellForStocks(token, tokensOut, 1 ether, 0);
        vm.expectRevert("CurveRouter: zero amount");
        curveRouter.sellForStocks(token, 0, 0, 0);
        vm.stopPrank();
        assertEq(IERC20(token).balanceOf(bob), tokensOut, "failed sells keep the tokens");
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
