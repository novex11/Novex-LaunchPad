// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairVault} from "../src/PairVault.sol";
import {ReceiptToken} from "../src/ReceiptToken.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

contract PairLaunchpadTest is Test {
    PairFactory factory;
    OracleAdapter oracle;
    AllocationController controller;
    EmergencyRegistry emergency;
    ExecutionRouter router;
    MockSwapRouter mockRouter;

    MockERC20 tsla;
    MockERC20 aapl;
    MockERC20 usdg;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCAFE);

    function setUp() public {
        // Tokens
        tsla = new MockERC20("Tesla", "TSLA");
        aapl = new MockERC20("Apple", "AAPL");
        usdg = new MockERC20("USDG", "USDG");

        // Infra
        oracle = new OracleAdapter(address(this));
        controller = new AllocationController(address(this));
        emergency = new EmergencyRegistry(address(this));
        mockRouter = new MockSwapRouter();
        router = new ExecutionRouter(address(this), address(mockRouter));
        router.setEmergency(address(emergency));

        // Price feeds
        oracle.setPriceFeed(address(tsla), address(new MockOracle(250e8)));
        oracle.setPriceFeed(address(aapl), address(new MockOracle(200e8)));
        oracle.setPriceFeed(address(usdg), address(new MockOracle(1e8)));

        // Approvals
        controller.setApprovedAsset(address(tsla), true);
        controller.setApprovedAsset(address(aapl), true);
        controller.setApprovedAsset(address(usdg), true);
        router.setApprovedToken(address(tsla), true);
        router.setApprovedToken(address(aapl), true);
        router.setApprovedToken(address(usdg), true);

        // Fund the mock swap router so it can pay out target tokens
        tsla.transfer(address(mockRouter), 500_000 ether);
        aapl.transfer(address(mockRouter), 500_000 ether);
        usdg.transfer(address(mockRouter), 500_000 ether);

        // Factory
        factory = new PairFactory(
            address(this),
            address(controller),
            address(oracle),
            address(router),
            address(emergency),
            address(usdg)
        );

        // Router must recognize factory as owner-caller to auto-authorize
        // launched pairs. We transfer router ownership to the factory so
        // its internal `_tryAuthorizeSwap` succeeds.
        router.transferOwnership(address(factory));

        // Fund test users with USDG
        usdg.transfer(alice, 100_000 ether);
        usdg.transfer(bob, 100_000 ether);
        usdg.transfer(carol, 100_000 ether);
    }

    // ─── Helpers ────────────────────────────────────────────

    function _launchTslaAapl(address creator, uint16 weightABps, uint16 feeBps)
        internal
        returns (PairVault pair)
    {
        vm.prank(creator);
        (address pairAddr, ) = factory.launchPair(
            address(tsla),
            address(aapl),
            weightABps,
            feeBps,
            "Novex TSLA-AAPL",
            "pTSLA-AAPL"
        );
        return PairVault(pairAddr);
    }

    // ─── Launch tests ───────────────────────────────────────

    function test_LaunchCreatesPair() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200);
        assertEq(pair.creator(), alice);
        assertEq(pair.creatorFeeBps(), 200);
        assertEq(factory.pairCount(), 1);
    }

    function test_LaunchUniquenessSortedTokens() public {
        _launchTslaAapl(alice, 6000, 200);

        // Try again with reversed order — should revert
        vm.prank(bob);
        vm.expectRevert("PairFactory: exists");
        factory.launchPair(
            address(aapl),
            address(tsla),
            4000,
            300,
            "reverse",
            "pAAPL-TSLA"
        );
    }

    function test_LaunchRejectsIdenticalTokens() public {
        vm.prank(alice);
        vm.expectRevert("PairFactory: identical tokens");
        factory.launchPair(
            address(tsla),
            address(tsla),
            5000,
            200,
            "bad",
            "pBAD"
        );
    }

    function test_LaunchRejectsUnapprovedToken() public {
        MockERC20 wild = new MockERC20("Wild", "WILD");
        vm.prank(alice);
        vm.expectRevert("PairFactory: unapproved token");
        factory.launchPair(
            address(tsla),
            address(wild),
            5000,
            200,
            "wild",
            "pTSLA-WILD"
        );
    }

    function test_LaunchRejectsInvalidWeight() public {
        vm.prank(alice);
        vm.expectRevert("PairFactory: invalid weight");
        factory.launchPair(
            address(tsla),
            address(aapl),
            500, // below min
            200,
            "bad",
            "pBAD"
        );
    }

    function test_LaunchRejectsInvalidFee() public {
        vm.prank(alice);
        vm.expectRevert("PairFactory: invalid fee");
        factory.launchPair(
            address(tsla),
            address(aapl),
            5000,
            50, // below min
            "bad",
            "pBAD"
        );
    }

    function test_LaunchPermissionlessAnyoneCanLaunch() public {
        // Bob (not owner) launches successfully
        vm.prank(bob);
        (address p, ) = factory.launchPair(
            address(tsla),
            address(aapl),
            7000,
            300,
            "Bob's pair",
            "pTSLA-AAPL"
        );
        assertTrue(p != address(0));
        assertEq(PairVault(p).creator(), bob);
    }

    function test_LaunchCreatorCap() public {
        // Pre-create tokens and approve them before router ownership constraints
        MockERC20 gogl = new MockERC20("Google", "GOOGL");
        controller.setApprovedAsset(address(gogl), true);
        oracle.setPriceFeed(address(gogl), address(new MockOracle(180e8)));

        MockERC20[] memory stocks = new MockERC20[](11);
        for (uint256 i; i < 11; ++i) {
            stocks[i] = new MockERC20("S", "S");
            controller.setApprovedAsset(address(stocks[i]), true);
            oracle.setPriceFeed(address(stocks[i]), address(new MockOracle(100e8)));
        }

        // Approve tokens on router — factory owns router, so use its owner()
        // Router still uses the test contract as its original owner until the
        // factory was set as owner in setUp. Prank as factory to authorize.
        vm.startPrank(address(factory));
        router.setApprovedToken(address(gogl), true);
        for (uint256 i; i < 11; ++i) {
            router.setApprovedToken(address(stocks[i]), true);
        }
        vm.stopPrank();

        // 10 pairs is the cap
        for (uint256 i; i < 10; ++i) {
            vm.prank(alice);
            factory.launchPair(
                address(gogl),
                address(stocks[i]),
                5000,
                200,
                "n",
                "pS"
            );
        }

        // 11th should fail
        vm.prank(alice);
        vm.expectRevert("PairFactory: creator cap");
        factory.launchPair(
            address(gogl),
            address(stocks[10]),
            5000,
            200,
            "n",
            "pX"
        );
    }

    // ─── Deposit tests ──────────────────────────────────────

    function test_CreatorFirstDepositNoFee() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 300);

        vm.startPrank(alice);
        usdg.approve(address(pair), 1_000 ether);
        uint256 shares = pair.deposit(1_000 ether, 0);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(pair.creatorEarningsUsdg(), 0, "no fee on creator first deposit");
        assertTrue(pair.creatorDeposited());
    }

    function test_CreatorSecondDepositTakesFee() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 300);

        vm.startPrank(alice);
        usdg.approve(address(pair), 2_000 ether);
        pair.deposit(1_000 ether, 0); // first deposit, no fee
        pair.deposit(1_000 ether, 0); // second deposit, takes fee
        vm.stopPrank();

        // 3% of 1000 = 30 USDG
        assertEq(pair.creatorEarningsUsdg(), 30 ether);
    }

    function test_NonCreatorDepositPaysFee() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200); // 2% fee

        vm.startPrank(bob);
        usdg.approve(address(pair), 500 ether);
        pair.deposit(500 ether, 0);
        vm.stopPrank();

        // 2% of 500 = 10 USDG
        assertEq(pair.creatorEarningsUsdg(), 10 ether);
    }

    function test_DepositMintsShares() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200);

        vm.startPrank(bob);
        usdg.approve(address(pair), 100 ether);
        uint256 shares = pair.deposit(100 ether, 0);
        vm.stopPrank();

        assertGt(shares, 0);
        assertEq(pair.receiptToken().balanceOf(bob), shares);
        assertEq(pair.totalShares(), shares);
    }

    function test_DepositSwapsIntoBothTokens() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200);

        vm.startPrank(bob);
        usdg.approve(address(pair), 1_000 ether);
        pair.deposit(1_000 ether, 0);
        vm.stopPrank();

        // Fee = 20 USDG, swap amount = 980 USDG
        // 60% -> TSLA leg = 588 USDG (mock 1:1 swap → 588 TSLA)
        // 40% -> AAPL leg = 392 USDG (mock 1:1 swap → 392 AAPL)
        // With sorted addresses, weightABps applies to the lower-address token
        // so we just check both legs got positive balances.
        assertGt(tsla.balanceOf(address(pair)), 0);
        assertGt(aapl.balanceOf(address(pair)), 0);
    }

    function test_DepositPausedRevert() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200);
        emergency.setDepositsPaused(true);

        vm.startPrank(bob);
        usdg.approve(address(pair), 100 ether);
        vm.expectRevert("PairVault: deposits paused");
        pair.deposit(100 ether, 0);
        vm.stopPrank();
    }

    // ─── Redeem tests ───────────────────────────────────────

    function test_RedeemReturnsUsdg() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200);

        // Bob deposits, then redeems
        vm.startPrank(bob);
        usdg.approve(address(pair), 500 ether);
        uint256 shares = pair.deposit(500 ether, 0);

        uint256 usdgBefore = usdg.balanceOf(bob);
        uint256 usdgOut = pair.redeem(shares, 0);
        uint256 usdgAfter = usdg.balanceOf(bob);
        vm.stopPrank();

        assertGt(usdgOut, 0);
        assertEq(usdgAfter - usdgBefore, usdgOut);
        assertEq(pair.receiptToken().balanceOf(bob), 0);
    }

    function test_RedeemBurnsShares() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200);

        vm.startPrank(bob);
        usdg.approve(address(pair), 500 ether);
        uint256 shares = pair.deposit(500 ether, 0);
        pair.redeem(shares, 0);
        vm.stopPrank();

        assertEq(pair.totalShares(), 0);
    }

    function test_RedeemDoesNotTouchCreatorFees() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200); // 2% fee

        // Bob deposits 500 (fee = 10 USDG) then redeems
        vm.startPrank(bob);
        usdg.approve(address(pair), 500 ether);
        uint256 shares = pair.deposit(500 ether, 0);
        pair.redeem(shares, 0);
        vm.stopPrank();

        // Creator fees preserved
        assertEq(pair.creatorEarningsUsdg(), 10 ether);
    }

    // ─── Creator fees claim ─────────────────────────────────

    function test_ClaimCreatorFees() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 300); // 3%

        vm.startPrank(bob);
        usdg.approve(address(pair), 1_000 ether);
        pair.deposit(1_000 ether, 0);
        vm.stopPrank();

        assertEq(pair.creatorEarningsUsdg(), 30 ether);

        uint256 aliceBefore = usdg.balanceOf(alice);
        vm.prank(alice);
        uint256 claimed = pair.claimCreatorFees();

        assertEq(claimed, 30 ether);
        assertEq(usdg.balanceOf(alice) - aliceBefore, 30 ether);
        assertEq(pair.creatorEarningsUsdg(), 0);
    }

    function test_ClaimCreatorFeesRejectsNonCreator() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 300);

        vm.startPrank(bob);
        usdg.approve(address(pair), 100 ether);
        pair.deposit(100 ether, 0);
        vm.stopPrank();

        vm.prank(bob);
        vm.expectRevert("PairVault: not creator");
        pair.claimCreatorFees();
    }

    function test_ClaimZeroFeesReverts() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200);

        vm.prank(alice);
        vm.expectRevert("PairVault: no fees");
        pair.claimCreatorFees();
    }

    // ─── Factory lookups ────────────────────────────────────

    function test_GetPairLookup() public {
        PairVault pair = _launchTslaAapl(alice, 6000, 200);

        (address found, address rcpt) = factory.getPair(address(tsla), address(aapl));
        assertEq(found, address(pair));
        assertEq(rcpt, address(pair.receiptToken()));

        // Reversed order also works
        (address found2, ) = factory.getPair(address(aapl), address(tsla));
        assertEq(found2, address(pair));
    }

    function test_ComputePairKeyOrderIndependent() public view {
        bytes32 k1 = factory.computePairKey(address(tsla), address(aapl));
        bytes32 k2 = factory.computePairKey(address(aapl), address(tsla));
        assertEq(k1, k2);
    }

    function test_PairsCreatedByTracked() public {
        _launchTslaAapl(alice, 6000, 200);
        assertEq(factory.pairsCreatedBy(alice), 1);
        assertEq(factory.pairsCreatedBy(bob), 0);
    }
}
