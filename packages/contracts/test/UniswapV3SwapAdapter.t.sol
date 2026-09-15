// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {ISwapRouter} from "../src/interfaces/ISwapRouter.sol";
import {MockSwapRouter02} from "../src/mocks/MockSwapRouter02.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";

contract UniswapV3SwapAdapterTest is Test {
    uint24 constant FEE_LOW = 500;
    uint24 constant FEE_MED = 3000;

    MockSwapRouter02 uni;
    UniswapV3SwapAdapter adapter;
    ExecutionRouter execRouter;

    MockERC20 nvda; // $100
    MockERC20 aapl; // $200
    TestUSDG usdg; // $1, 6 decimals

    address owner = address(this);
    address caller = address(0xCA11);
    address recipient = address(0xBEEF);
    address stranger = address(0xBAD);

    function setUp() public {
        nvda = new MockERC20("Nvidia", "NVDA");
        aapl = new MockERC20("Apple", "AAPL");
        usdg = new TestUSDG(owner);

        uni = new MockSwapRouter02();
        // 1 NVDA (1e18) → 100 USDG (100e6); 1 AAPL → 200 USDG; NVDA → AAPL at 1:2
        uni.setRate(address(nvda), address(usdg), 100e6, 1e18);
        uni.setRate(address(usdg), address(aapl), 1e18, 200e6);
        uni.setRate(address(nvda), address(aapl), 1, 2);
        aapl.mint(address(uni), 1_000_000 ether);
        usdg.mint(address(uni), 100_000_000e6);

        adapter = new UniswapV3SwapAdapter(owner, address(uni));
        adapter.setAuthorizedCaller(caller, true);

        execRouter = new ExecutionRouter(owner, address(adapter));
        execRouter.setApprovedToken(address(nvda), true);
        execRouter.setApprovedToken(address(aapl), true);
        execRouter.setApprovedToken(address(usdg), true);
        adapter.setAuthorizedCaller(address(execRouter), true);

        nvda.mint(caller, 1_000 ether);
        vm.prank(caller);
        nvda.approve(address(adapter), type(uint256).max);
    }

    function _params(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        view
        returns (ISwapRouter.SwapParams memory)
    {
        return ISwapRouter.SwapParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minOut,
            recipient: recipient
        });
    }

    // ─── Single hop ─────────────────────────────────────────

    function test_singleHopUsesDefaultFee() public {
        vm.prank(caller);
        uint256 out = adapter.swap(_params(address(nvda), address(usdg), 1 ether, 0));

        // 100 USDG minus 0.30%
        assertEq(out, 99_700_000);
        assertEq(usdg.balanceOf(recipient), out);
        assertEq(nvda.balanceOf(address(uni)), 1 ether);
        assertEq(uni.lastPath(), abi.encodePacked(address(nvda), FEE_MED, address(usdg)));
        assertEq(uni.lastRecipient(), recipient);
        assertEq(uni.lastAmountIn(), 1 ether);
        assertEq(nvda.allowance(address(adapter), address(uni)), 0);
    }

    function test_pairFeeOverrideAppliesBothDirections() public {
        adapter.setPairFee(address(usdg), address(nvda), FEE_LOW);
        assertEq(adapter.feeFor(address(nvda), address(usdg)), FEE_LOW);
        assertEq(adapter.feeFor(address(usdg), address(nvda)), FEE_LOW);
        assertEq(adapter.feeFor(address(nvda), address(aapl)), FEE_MED);

        vm.prank(caller);
        uint256 out = adapter.swap(_params(address(nvda), address(usdg), 1 ether, 0));
        assertEq(out, 99_950_000); // 100 USDG minus 0.05%
        assertEq(uni.lastPath(), abi.encodePacked(address(nvda), FEE_LOW, address(usdg)));

        adapter.setPairFee(address(nvda), address(usdg), 0);
        assertEq(adapter.feeFor(address(nvda), address(usdg)), FEE_MED);
    }

    function test_setDefaultFee() public {
        adapter.setDefaultFee(FEE_LOW);
        assertEq(adapter.defaultFee(), FEE_LOW);
        assertEq(adapter.pathFor(address(nvda), address(usdg)), abi.encodePacked(address(nvda), FEE_LOW, address(usdg)));

        vm.expectRevert("UniswapV3SwapAdapter: bad fee");
        adapter.setDefaultFee(1234);
    }

    // ─── Path override (multi-hop) ──────────────────────────

    function test_pathOverrideRoutesThroughUsdg() public {
        bytes memory path = abi.encodePacked(address(nvda), FEE_MED, address(usdg), FEE_LOW, address(aapl));
        adapter.setPairPath(address(nvda), address(aapl), path);
        assertEq(adapter.pathFor(address(nvda), address(aapl)), path);
        // Reverse direction is not affected.
        assertEq(adapter.pathFor(address(aapl), address(nvda)), abi.encodePacked(address(aapl), FEE_MED, address(nvda)));

        vm.prank(caller);
        uint256 out = adapter.swap(_params(address(nvda), address(aapl), 1 ether, 0));

        // 1 NVDA → 99.7 USDG → 0.4985 AAPL minus 0.05%
        uint256 expected = (uint256(99_700_000) * 1e18) / 200e6;
        expected = (expected * (1_000_000 - FEE_LOW)) / 1_000_000;
        assertEq(out, expected);
        assertEq(aapl.balanceOf(recipient), out);
        assertEq(uni.lastPath(), path);
    }

    function test_clearPathOverrideFallsBackToSingleHop() public {
        bytes memory path = abi.encodePacked(address(nvda), FEE_MED, address(usdg), FEE_LOW, address(aapl));
        adapter.setPairPath(address(nvda), address(aapl), path);
        adapter.setPairPath(address(nvda), address(aapl), "");
        assertEq(adapter.pathFor(address(nvda), address(aapl)), abi.encodePacked(address(nvda), FEE_MED, address(aapl)));

        vm.prank(caller);
        uint256 out = adapter.swap(_params(address(nvda), address(aapl), 1 ether, 0));
        assertEq(out, (uint256(0.5 ether) * (1_000_000 - uint256(FEE_MED))) / 1_000_000);
    }

    function test_setPairPathValidatesEndpointsAndFees() public {
        vm.expectRevert("UniswapV3SwapAdapter: path tokenIn");
        adapter.setPairPath(address(nvda), address(aapl), abi.encodePacked(address(usdg), FEE_MED, address(aapl)));

        vm.expectRevert("UniswapV3SwapAdapter: path tokenOut");
        adapter.setPairPath(address(nvda), address(aapl), abi.encodePacked(address(nvda), FEE_MED, address(usdg)));

        vm.expectRevert("UniswapV3SwapAdapter: path fee");
        adapter.setPairPath(address(nvda), address(aapl), abi.encodePacked(address(nvda), uint24(1234), address(aapl)));

        vm.expectRevert("UniswapV3SwapAdapter: bad path");
        adapter.setPairPath(address(nvda), address(aapl), abi.encodePacked(address(nvda), address(aapl)));
    }

    // ─── Access control ─────────────────────────────────────

    function test_unauthorizedCallerReverts() public {
        nvda.mint(stranger, 1 ether);
        vm.startPrank(stranger);
        nvda.approve(address(adapter), 1 ether);
        vm.expectRevert("UniswapV3SwapAdapter: unauthorized");
        adapter.swap(_params(address(nvda), address(usdg), 1 ether, 0));
        vm.stopPrank();

        adapter.setAuthorizedCaller(caller, false);
        vm.prank(caller);
        vm.expectRevert("UniswapV3SwapAdapter: unauthorized");
        adapter.swap(_params(address(nvda), address(usdg), 1 ether, 0));
    }

    function test_onlyOwnerConfigures() public {
        vm.startPrank(stranger);
        vm.expectRevert();
        adapter.setAuthorizedCaller(stranger, true);
        vm.expectRevert();
        adapter.setDefaultFee(FEE_LOW);
        vm.expectRevert();
        adapter.setPairFee(address(nvda), address(usdg), FEE_LOW);
        vm.expectRevert();
        adapter.setPairPath(address(nvda), address(usdg), abi.encodePacked(address(nvda), FEE_MED, address(usdg)));
        vm.stopPrank();
    }

    // ─── Slippage ───────────────────────────────────────────

    function test_slippageRevertsAtRouter() public {
        vm.prank(caller);
        vm.expectRevert("Too little received");
        adapter.swap(_params(address(nvda), address(usdg), 1 ether, 99_700_001));
    }

    function test_slippageRevertsAtAdapterWhenRouterIsLenient() public {
        uni.setEnforceMin(false);
        vm.prank(caller);
        vm.expectRevert("UniswapV3SwapAdapter: slippage");
        adapter.swap(_params(address(nvda), address(usdg), 1 ether, 99_700_001));

        // Exactly the minimum passes.
        vm.prank(caller);
        assertEq(adapter.swap(_params(address(nvda), address(usdg), 1 ether, 99_700_000)), 99_700_000);
    }

    function test_rejectsBadParams() public {
        vm.startPrank(caller);
        vm.expectRevert("UniswapV3SwapAdapter: zero recipient");
        adapter.swap(ISwapRouter.SwapParams(address(nvda), address(usdg), 1 ether, 0, address(0)));
        vm.expectRevert("UniswapV3SwapAdapter: same token");
        adapter.swap(_params(address(nvda), address(nvda), 1 ether, 0));
        vm.expectRevert("UniswapV3SwapAdapter: zero amount");
        adapter.swap(_params(address(nvda), address(usdg), 0, 0));
        vm.stopPrank();
    }

    // ─── Through the ExecutionRouter ────────────────────────

    function test_executionRouterSwapsThroughAdapter() public {
        nvda.approve(address(execRouter), 2 ether);
        uint256 out = execRouter.executeSwap(address(nvda), address(usdg), 2 ether, 199_000_000, recipient);
        assertEq(out, 199_400_000);
        assertEq(usdg.balanceOf(recipient), out);
        assertEq(nvda.balanceOf(address(uni)), 2 ether);
    }
}
