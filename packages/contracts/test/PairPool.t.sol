// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairVault} from "../src/PairVault.sol";
import {PairShareToken} from "../src/PairShareToken.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PriceFeedUpdater} from "../src/PriceFeedUpdater.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWRHT} from "../src/mocks/MockWRHT.sol";
import {MockPermit2, MockV4PositionManager} from "../src/mocks/MockV4.sol";
import {PoolKey} from "../src/interfaces/IUniswapV4.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";

/// @dev Launching with a DEX pool: shares are transferable, the pool is
///      initialized at NAV, and the creator keeps the rest of the seed.
contract PairPoolTest is Test {
    MockERC20 tsla;
    MockERC20 amd;
    MockWRHT weth;
    TestUSDG usdg;
    OracleAdapter oracle;
    EmergencyRegistry emergency;
    PriceFeedUpdater updater;
    PairFactory factory;
    MockPermit2 permit2;
    MockV4PositionManager pm;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        tsla = new MockERC20("Tesla", "TSLA"); // $250
        amd = new MockERC20("AMD", "AMD"); // $100
        weth = new MockWRHT();
        usdg = new TestUSDG(address(this)); // 6 decimals, $1

        oracle = new OracleAdapter(address(this));
        emergency = new EmergencyRegistry(address(this));
        updater = new PriceFeedUpdater(address(this));
        oracle.setPriceFeed(address(tsla), address(new PushPriceFeed(address(this), address(updater), "TSLA / USD", 250e8)));
        oracle.setPriceFeed(address(amd), address(new PushPriceFeed(address(this), address(updater), "AMD / USD", 100e8)));
        oracle.setPriceFeed(address(weth), address(new PushPriceFeed(address(this), address(updater), "ETH / USD", 2_500e8)));
        oracle.setPriceFeed(address(usdg), address(new PushPriceFeed(address(this), address(updater), "USDG / USD", 1e8)));

        factory = new PairFactory(address(this), address(oracle), address(emergency), address(weth), address(new PairDeployer()));
        factory.setTokenListed(address(tsla), true);
        factory.setTokenListed(address(amd), true);

        permit2 = new MockPermit2();
        pm = new MockV4PositionManager(permit2);
        factory.setPoolConfig(address(pm), address(permit2), address(usdg));

        tsla.mint(alice, 1_000 ether);
        amd.mint(alice, 1_000 ether);
        usdg.mint(alice, 10_000e6);
        vm.startPrank(alice);
        tsla.approve(address(factory), type(uint256).max);
        amd.approve(address(factory), type(uint256).max);
        usdg.approve(address(factory), type(uint256).max);
        vm.stopPrank();
    }

    /// 50/50 at $250/$100: 2 TSLA ($500) + 5 AMD ($500) = $1,000 -> 1,000e18 shares
    function _params() internal view returns (PairFactory.LaunchParams memory) {
        return PairFactory.LaunchParams({
            tokenA: address(tsla),
            tokenB: address(amd),
            weightABps: 5000,
            creatorFeeBps: 200,
            receiptName: "Tesla x AMD",
            receiptSymbol: "TSAMD",
            amountA: 2 ether,
            amountB: 5 ether,
            minShares: 0
        });
    }

    function test_LaunchWithPool_SeedsPoolAtNav() public {
        vm.prank(alice);
        (address pair, address share, uint256 shares, bytes32 poolId) = factory.launchPairWithPool(
            _params(),
            PairFactory.PoolParams({poolShareBps: 2000, maxQuoteAmount: 200e6})
        );
        address pool = pm.holdingOf(poolId);

        assertEq(shares, 1_000e18, "no creator fee on the launch seed");
        assertEq(PairShareToken(share).balanceOf(alice), 800e18, "creator keeps 80%");
        assertEq(PairShareToken(share).balanceOf(pool), 200e18, "20% of shares in pool");
        assertEq(usdg.balanceOf(pool), 200e6, "$200 of USDG in pool");
        assertEq(usdg.balanceOf(alice), 10_000e6 - 200e6);
        assertEq(factory.poolIdOf(pair), poolId);
        assertEq(pm.ownerOf(factory.poolPositionOf(pair)), alice, "LP NFT goes to creator");
        assertEq(PairVault(pair).sharePrice(), 1e8, "vault NAV unchanged by pooling");
        assertGt(pm.liquidityOf(factory.poolPositionOf(pair)), 0, "position has liquidity");

        // Pool key: sorted currencies, 0.30% fee, spacing 60, no hook
        (address c0, address c1, uint24 fee, int24 spacing, address hooks) = factory.poolKeyOf(pair);
        assertTrue(c0 < c1, "sorted currencies");
        assertEq(fee, 3_000);
        assertEq(spacing, 60);
        assertEq(hooks, address(0));
        assertEq(poolId, keccak256(abi.encode(PoolKey(c0, c1, fee, spacing, hooks))));

        // Initial price encodes $1 per share: sqrtP^2 / 2^192 == amount1 / amount0
        (uint256 a0, uint256 a1) = c0 == share ? (uint256(200e18), uint256(200e6)) : (uint256(200e6), uint256(200e18));
        uint256 p = uint256(pm.sqrtPriceOf(poolId));
        uint256 impliedA1 = Math.mulDiv(Math.mulDiv(p, p, 2 ** 96), a0, 2 ** 96);
        assertApproxEqRel(impliedA1, a1, 1e15, "pool initialized at NAV"); // 0.1%
    }

    function test_LaunchWithPool_SharesTradeAndRedeem() public {
        vm.prank(alice);
        (address pair, address share, , ) = factory.launchPairWithPool(
            _params(),
            PairFactory.PoolParams({poolShareBps: 1000, maxQuoteAmount: 100e6})
        );
        // Shares move wallet to wallet, and the holder can redeem in kind.
        vm.prank(alice);
        PairShareToken(share).transfer(bob, 100e18);
        vm.prank(bob);
        (uint256 outA, uint256 outB) = PairVault(pair).redeem(100e18, 0, 0);
        // 10% of reserves (2 TSLA / 5 AMD); the vault orders legs by address.
        (uint256 outTsla, uint256 outAmd) = PairVault(pair).tokenA() == address(tsla) ? (outA, outB) : (outB, outA);
        assertEq(outTsla, 0.2 ether);
        assertEq(outAmd, 0.5 ether);
    }

    function test_LaunchWithPool_RevertsWhenQuoteCapTooLow() public {
        vm.prank(alice);
        vm.expectRevert("PairFactory: quote amount");
        factory.launchPairWithPool(_params(), PairFactory.PoolParams({poolShareBps: 2000, maxQuoteAmount: 199e6}));
    }

    function test_LaunchWithPool_RevertsOnBadShare() public {
        vm.startPrank(alice);
        vm.expectRevert("PairFactory: invalid pool share");
        factory.launchPairWithPool(_params(), PairFactory.PoolParams({poolShareBps: 0, maxQuoteAmount: 1e9}));
        vm.expectRevert("PairFactory: invalid pool share");
        factory.launchPairWithPool(_params(), PairFactory.PoolParams({poolShareBps: 5001, maxQuoteAmount: 1e9}));
        vm.stopPrank();
    }

    function test_LaunchWithPool_RevertsWhenDisabled() public {
        factory.setPoolConfig(address(0), address(0), address(0));
        vm.prank(alice);
        vm.expectRevert("PairFactory: pool disabled");
        factory.launchPairWithPool(_params(), PairFactory.PoolParams({poolShareBps: 2000, maxQuoteAmount: 1e9}));
    }

    function test_PoolConfig_RequiresQuoteFeed() public {
        MockERC20 noFeed = new MockERC20("X", "X");
        vm.expectRevert("PairFactory: no quote feed");
        factory.setPoolConfig(address(pm), address(permit2), address(noFeed));
        vm.expectRevert("PairFactory: pool config");
        factory.setPoolConfig(address(pm), address(0), address(usdg));
    }

    function test_PlainLaunchStillWorksWithoutPool() public {
        vm.prank(alice);
        (address pair, address share, uint256 shares) = factory.launchPair(_params());
        assertEq(shares, 1_000e18);
        assertEq(PairShareToken(share).balanceOf(alice), 1_000e18);
        assertEq(factory.poolIdOf(pair), bytes32(0));
    }

    function test_DepositBlockedWhilePairKeyExists() public {
        vm.prank(alice);
        factory.launchPairWithPool(_params(), PairFactory.PoolParams({poolShareBps: 2000, maxQuoteAmount: 200e6}));
        vm.prank(alice);
        vm.expectRevert("PairFactory: exists");
        factory.launchPair(_params());
    }
}
