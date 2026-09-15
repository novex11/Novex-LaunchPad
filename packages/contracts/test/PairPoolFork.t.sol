// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
import {TestUSDG} from "../src/testnet/TestUSDG.sol";

interface IPositionManagerView {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getPositionLiquidity(uint256 tokenId) external view returns (uint128);
}

interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
    function getLiquidity(bytes32 poolId) external view returns (uint128);
}

/// @dev Runs against a Robinhood Chain fork (testnet or mainnet share the same
///      Uniswap v4 addresses). Skipped unless FORK_RPC_URL is set:
///        FORK_RPC_URL=https://rpc.testnet.chain.robinhood.com forge test --match-contract PairPoolFork -vv
contract PairPoolForkTest is Test {
    address constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address alice = address(0xA11CE);

    MockERC20 tsla;
    MockERC20 amd;
    TestUSDG usdg;
    OracleAdapter oracle;
    PairFactory factory;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);

        tsla = new MockERC20("Tesla", "TSLA");
        amd = new MockERC20("AMD", "AMD");
        MockWRHT weth = new MockWRHT();
        usdg = new TestUSDG(address(this));

        oracle = new OracleAdapter(address(this));
        EmergencyRegistry emergency = new EmergencyRegistry(address(this));
        PriceFeedUpdater updater = new PriceFeedUpdater(address(this));
        oracle.setPriceFeed(address(tsla), address(new PushPriceFeed(address(this), address(updater), "TSLA / USD", 250e8)));
        oracle.setPriceFeed(address(amd), address(new PushPriceFeed(address(this), address(updater), "AMD / USD", 100e8)));
        oracle.setPriceFeed(address(weth), address(new PushPriceFeed(address(this), address(updater), "ETH / USD", 2_500e8)));
        oracle.setPriceFeed(address(usdg), address(new PushPriceFeed(address(this), address(updater), "USDG / USD", 1e8)));

        PairDeployer deployer = new PairDeployer();
        factory = new PairFactory(address(this), address(oracle), address(emergency), address(weth), address(deployer));
        factory.setTokenListed(address(tsla), true);
        factory.setTokenListed(address(amd), true);
        factory.setPoolConfig(POSITION_MANAGER, PERMIT2, address(usdg));

        tsla.mint(alice, 1_000 ether);
        amd.mint(alice, 1_000 ether);
        usdg.mint(alice, 10_000e6);
        vm.startPrank(alice);
        tsla.approve(address(factory), type(uint256).max);
        amd.approve(address(factory), type(uint256).max);
        usdg.approve(address(factory), type(uint256).max);
        vm.stopPrank();
    }

    function test_Fork_LaunchWithPool_OnRealUniswapV4() public {
        if (address(factory) == address(0)) {
            emit log("FORK_RPC_URL not set; skipping");
            return;
        }
        PairFactory.LaunchParams memory p = PairFactory.LaunchParams({
            tokenA: address(tsla),
            tokenB: address(amd),
            weightABps: 5000,
            creatorFeeBps: 200,
            receiptName: "Tesla x AMD",
            receiptSymbol: "TSAMD",
            amountA: 2 ether, // $500
            amountB: 5 ether, // $500
            minShares: 0
        });

        vm.prank(alice);
        (address pair, address share, uint256 shares, bytes32 poolId) = factory.launchPairWithPool(
            p,
            PairFactory.PoolParams({poolShareBps: 2000, maxQuoteAmount: 200e6})
        );

        assertEq(shares, 1_000e18);
        // Creator keeps 80% of shares; the rest (minus dust) is in the pool.
        uint256 aliceShares = PairShareToken(share).balanceOf(alice);
        assertGe(aliceShares, 800e18);
        assertLt(aliceShares, 800e18 + 1e15, "at most rounding dust refunded");
        assertEq(PairShareToken(share).balanceOf(address(factory)), 0, "factory keeps nothing");
        assertEq(usdg.balanceOf(address(factory)), 0, "factory keeps no USDG");

        // Real v4 state: pool initialized at ~NAV and holding our liquidity.
        (uint160 sqrtP, , , uint24 lpFee) = IStateView(STATE_VIEW).getSlot0(poolId);
        assertGt(sqrtP, 0, "pool initialized");
        assertEq(lpFee, 3_000);
        uint128 liq = IStateView(STATE_VIEW).getLiquidity(poolId);
        assertGt(liq, 0, "pool has liquidity");

        uint256 positionId = factory.poolPositionOf(pair);
        assertEq(IPositionManagerView(POSITION_MANAGER).ownerOf(positionId), alice, "LP NFT to creator");
        assertEq(IPositionManagerView(POSITION_MANAGER).getPositionLiquidity(positionId), liq, "all pool liquidity is ours");

        // Price sanity: 1 share ≈ $1 => sqrtP^2/2^192 == amount1/amount0 within 0.1%
        (address c0, , , , ) = factory.poolKeyOf(pair);
        (uint256 a0, uint256 a1) = c0 == share ? (uint256(200e18), uint256(200e6)) : (uint256(200e6), uint256(200e18));
        uint256 sp = uint256(sqrtP);
        uint256 impliedA1 = (((sp * sp) >> 96) * a0) >> 96;
        assertApproxEqRel(impliedA1, a1, 1e15);

        // Vault unaffected; redemption still works for a share holder.
        assertEq(PairVault(pair).sharePrice(), 1e8);
        vm.prank(alice);
        PairVault(pair).redeem(100e18, 0, 0);
    }
}
