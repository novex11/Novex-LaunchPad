// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairVault} from "../src/PairVault.sol";
import {PairRouter} from "../src/PairRouter.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PriceFeedUpdater} from "../src/PriceFeedUpdater.sol";
import {OracleSwapRouter} from "../src/testnet/OracleSwapRouter.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";
import {FixedPriceFeed} from "../src/testnet/FixedPriceFeed.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWRHT} from "../src/mocks/MockWRHT.sol";

contract PairRouterTest is Test {
    uint24 constant FEE = 3000; // 0.3% pool fee
    uint16 constant SLIPPAGE = 100; // 1%

    PairFactory factory;
    OracleAdapter oracle;
    EmergencyRegistry emergency;
    PriceFeedUpdater updater;
    OracleSwapRouter swapRouter;
    PairRouter router;

    MockERC20 tsla; // $250
    MockERC20 amd; // $100
    MockWRHT weth; // $2,500
    TestUSDG usdg; // $1, 6 decimals

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

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

        // Swap inventory; minted WETH is backed by ETH so unwraps succeed.
        tsla.mint(address(swapRouter), 10_000 ether);
        amd.mint(address(swapRouter), 10_000 ether);
        usdg.mint(address(swapRouter), 10_000_000e6);
        weth.mint(address(swapRouter), 1_000 ether);
        vm.deal(address(weth), 1_000 ether);

        tsla.mint(alice, 1_000 ether);
        amd.mint(alice, 1_000 ether);
        vm.deal(alice, 100 ether);
        usdg.mint(bob, 100_000e6);
        vm.deal(bob, 100 ether);

        vm.startPrank(alice);
        tsla.approve(address(factory), type(uint256).max);
        amd.approve(address(factory), type(uint256).max);
        vm.stopPrank();
    }

    // ─── Helpers ────────────────────────────────────────────

    /// TSLA/AMD 60/40 seeded with $1,000 -> 1,000 shares to alice (2% creator fee)
    function _launch() internal returns (PairVault) {
        vm.prank(alice);
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
        return PairVault(p);
    }

    function _path(address from, address to) internal pure returns (bytes memory) {
        return abi.encodePacked(from, FEE, to);
    }

    function _buyParams(PairVault pair, address payToken, uint256 amountIn)
        internal
        view
        returns (PairRouter.BuyParams memory)
    {
        return PairRouter.BuyParams({
            pair: address(pair),
            payToken: payToken,
            amountIn: amountIn,
            pathA: _path(payToken, pair.tokenA()),
            pathB: _path(payToken, pair.tokenB()),
            minShares: 0,
            maxSlippageBps: SLIPPAGE,
            deadline: block.timestamp + 1 hours
        });
    }

    function _sellParams(PairVault pair, address receiveToken, uint256 shares, bool unwrapEth)
        internal
        view
        returns (PairRouter.SellParams memory)
    {
        return PairRouter.SellParams({
            pair: address(pair),
            receiveToken: receiveToken,
            shares: shares,
            pathA: _path(pair.tokenA(), receiveToken),
            pathB: _path(pair.tokenB(), receiveToken),
            minAmountOut: 0,
            maxSlippageBps: SLIPPAGE,
            unwrapEth: unwrapEth,
            deadline: block.timestamp + 1 hours
        });
    }

    function _assertRouterEmpty() internal view {
        assertEq(tsla.balanceOf(address(router)), 0, "router TSLA");
        assertEq(amd.balanceOf(address(router)), 0, "router AMD");
        assertEq(weth.balanceOf(address(router)), 0, "router WETH");
        assertEq(usdg.balanceOf(address(router)), 0, "router USDG");
        assertEq(address(router).balance, 0, "router ETH");
    }

    // ─── Buy ────────────────────────────────────────────────

    function test_BuyWithUsdg() public {
        PairVault pair = _launch();
        vm.startPrank(bob);
        usdg.approve(address(router), 1_000e6);
        uint256 shares = router.buy(_buyParams(pair, address(usdg), 1_000e6));
        vm.stopPrank();

        // $1,000 -> $997 of stock after the 0.3% pool fee -> 997 gross, minus 2% creator fee
        assertApproxEqRel(shares, 977.06e18, 0.002e18);
        assertEq(pair.receiptToken().balanceOf(bob), shares);
        assertEq(usdg.balanceOf(bob), 99_000e6);
        _assertRouterEmpty();
    }

    function test_BuyWithEth() public {
        PairVault pair = _launch();
        PairRouter.BuyParams memory params = _buyParams(pair, address(weth), 0.4 ether);
        vm.prank(bob);
        uint256 shares = router.buy{value: 0.4 ether}(params);

        assertApproxEqRel(shares, 977.06e18, 0.002e18);
        assertEq(pair.receiptToken().balanceOf(bob), shares);
        assertGe(bob.balance, 99.6 ether, "any unused ETH is refunded");
        assertLe(bob.balance, 99.601 ether, "only dust comes back");
        _assertRouterEmpty();
    }

    function test_BuyWethLegWithEthSkipsSwapAndRefundsDust() public {
        vm.prank(alice);
        (address p, , ) = factory.launchPair{value: 0.4 ether}(
            PairFactory.LaunchParams({
                tokenA: address(tsla),
                tokenB: address(weth),
                weightABps: 5000,
                creatorFeeBps: 200,
                receiptName: "Tesla x ETH",
                receiptSymbol: "TSETH",
                amountA: 4 ether,
                amountB: 0.4 ether,
                minShares: 0
            })
        );
        PairVault pair = PairVault(p);

        PairRouter.BuyParams memory params = _buyParams(pair, address(weth), 0.2 ether);
        vm.prank(bob);
        uint256 shares = router.buy{value: 0.2 ether}(params);
        assertEq(pair.receiptToken().balanceOf(bob), shares);

        // 0.1 WETH deposited as-is, 0.1 WETH -> 0.997 TSLA; TSLA leg limits -> 498.5 gross shares
        assertApproxEqRel(shares, 488.53e18, 0.002e18);
        assertApproxEqAbs(bob.balance, 100 ether - 0.1997 ether, 0.0001 ether);
        _assertRouterEmpty();
    }

    function test_BuyRevertsBelowOracleFloor() public {
        PairVault pair = _launch();
        PairRouter.BuyParams memory params = _buyParams(pair, address(usdg), 1_000e6);
        params.pathA = abi.encodePacked(address(usdg), uint24(50_000), pair.tokenA()); // 5% pool fee
        vm.startPrank(bob);
        usdg.approve(address(router), 1_000e6);
        vm.expectRevert("OracleSwapRouter: too little received");
        router.buy(params);
        vm.stopPrank();
    }

    function test_BuyRejectsBadParams() public {
        PairVault pair = _launch();
        vm.startPrank(bob);
        usdg.approve(address(router), type(uint256).max);

        PairRouter.BuyParams memory params = _buyParams(pair, address(usdg), 1_000e6);
        params.pair = address(0xDEAD);
        vm.expectRevert("PairRouter: unknown pair");
        router.buy(params);

        params = _buyParams(pair, address(usdg), 1_000e6);
        params.deadline = block.timestamp - 1;
        vm.expectRevert("PairRouter: expired");
        router.buy(params);

        params = _buyParams(pair, address(usdg), 1_000e6);
        params.maxSlippageBps = 301;
        vm.expectRevert("PairRouter: slippage too high");
        router.buy(params);

        params = _buyParams(pair, address(tsla), 1 ether);
        vm.expectRevert("PairRouter: unsupported token");
        router.buy(params);

        params = _buyParams(pair, address(usdg), 1_000e6);
        params.pathA = _path(address(weth), pair.tokenA());
        vm.expectRevert("PairRouter: path start");
        router.buy(params);
        vm.stopPrank();
    }

    function test_BuyRevertsOnStalePrice() public {
        PairVault pair = _launch();
        PairRouter.BuyParams memory params = _buyParams(pair, address(usdg), 1_000e6);
        vm.warp(block.timestamp + 2 hours);
        params.deadline = block.timestamp + 1 hours;
        vm.startPrank(bob);
        usdg.approve(address(router), 1_000e6);
        vm.expectRevert("OracleAdapter: stale");
        router.buy(params);
        vm.stopPrank();
    }

    function test_BuyMinSharesGuard() public {
        PairVault pair = _launch();
        PairRouter.BuyParams memory params = _buyParams(pair, address(usdg), 1_000e6);
        params.minShares = 1_000e18;
        vm.startPrank(bob);
        usdg.approve(address(router), 1_000e6);
        vm.expectRevert("PairVault: slippage");
        router.buy(params);
        vm.stopPrank();
    }

    // ─── Sell ───────────────────────────────────────────────

    function test_SellForEth() public {
        PairVault pair = _launch();
        uint256 before = alice.balance;
        vm.startPrank(alice);
        pair.setOperator(address(router), true);
        uint256 out = router.sell(_sellParams(pair, address(weth), 500e18, true));
        vm.stopPrank();

        // $500 of stock -> $498.50 after the pool fee -> 0.1994 ETH at $2,500
        assertApproxEqRel(out, 0.1994 ether, 0.001e18);
        assertEq(alice.balance - before, out);
        assertEq(pair.receiptToken().balanceOf(alice), 500e18);
        _assertRouterEmpty();
    }

    function test_SellForUsdg() public {
        PairVault pair = _launch();
        vm.startPrank(alice);
        pair.setOperator(address(router), true);
        uint256 out = router.sell(_sellParams(pair, address(usdg), 500e18, false));
        vm.stopPrank();

        assertApproxEqRel(out, 498.5e6, 0.001e18);
        assertEq(usdg.balanceOf(alice), out);
        _assertRouterEmpty();
    }

    function test_SellRequiresOperatorAndRespectsRevoke() public {
        PairVault pair = _launch();
        PairRouter.SellParams memory params = _sellParams(pair, address(weth), 100e18, true);

        vm.prank(alice);
        vm.expectRevert("PairVault: not operator");
        router.sell(params);

        vm.startPrank(alice);
        pair.setOperator(address(router), true);
        pair.setOperator(address(router), false);
        vm.expectRevert("PairVault: not operator");
        router.sell(params);
        vm.stopPrank();
    }

    function test_SellMinAmountOutGuard() public {
        PairVault pair = _launch();
        PairRouter.SellParams memory params = _sellParams(pair, address(usdg), 500e18, false);
        params.minAmountOut = 500e6;
        vm.startPrank(alice);
        pair.setOperator(address(router), true);
        vm.expectRevert("PairRouter: slippage");
        router.sell(params);
        vm.stopPrank();
    }

    function test_SellUnwrapRequiresWeth() public {
        PairVault pair = _launch();
        PairRouter.SellParams memory params = _sellParams(pair, address(usdg), 100e18, true);
        vm.startPrank(alice);
        pair.setOperator(address(router), true);
        vm.expectRevert("PairRouter: unwrap needs WETH");
        router.sell(params);
        vm.stopPrank();
    }

    // ─── Vault operator redeem ──────────────────────────────

    function test_RedeemFromOwnerToRecipient() public {
        PairVault pair = _launch();
        vm.prank(alice);
        pair.redeemFrom(alice, 500e18, 0, 0, bob);

        assertEq(tsla.balanceOf(bob), 1.2 ether);
        assertEq(amd.balanceOf(bob), 2 ether);
        assertEq(pair.receiptToken().balanceOf(alice), 500e18);
    }

    function test_RedeemFromRejectsStrangers() public {
        PairVault pair = _launch();
        vm.prank(bob);
        vm.expectRevert("PairVault: not operator");
        pair.redeemFrom(alice, 1e18, 0, 0, bob);
    }

    // ─── Testnet helpers ────────────────────────────────────

    function test_SwapRouterQuoteMatchesFill() public {
        bytes memory path = _path(address(usdg), address(tsla));
        uint256 quoted = swapRouter.quoteExactInput(path, 250e6);
        assertEq(quoted, 0.997 ether);
    }

    function test_TestUsdgFaucetCooldown() public {
        vm.startPrank(bob);
        usdg.faucet();
        assertEq(usdg.balanceOf(bob), 100_000e6 + 1_000e6);
        vm.expectRevert("TestUSDG: cooldown");
        usdg.faucet();
        vm.warp(block.timestamp + 1 hours);
        usdg.faucet();
        vm.stopPrank();
    }
}
