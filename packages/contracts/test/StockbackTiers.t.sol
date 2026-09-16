// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockUniswapV3Router} from "../src/mocks/MockUniswapV3Router.sol";

/// @dev Stands in for a strategy vault: reports a strategy and asks the reserve for payouts.
contract TierCaller {
    AllocationController.Strategy public strategy;
    CashbackReserve reserve;

    constructor(CashbackReserve reserve_, AllocationController.Strategy strategy_) {
        reserve = reserve_;
        strategy = strategy_;
    }

    function pay(address wallet, address token, uint256 amount, uint256 depositUsd8) external {
        reserve.payDepositStockback(wallet, token, amount, depositUsd8);
    }
}

contract StockbackTiersTest is Test {

    OracleAdapter oracle;
    CashbackReserve cashback;
    MockERC20 nvda;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    AllocationController.Strategy constant DEF = AllocationController.Strategy.Defensive;
    AllocationController.Strategy constant BAL = AllocationController.Strategy.Balanced;
    AllocationController.Strategy constant AGG = AllocationController.Strategy.Aggressive;

    function setUp() public {
        nvda = new MockERC20("NVDA", "NVDA");
        oracle = new OracleAdapter(address(this));
        oracle.setPriceFeed(address(nvda), address(new MockOracle(500e8)));
        cashback = new CashbackReserve(address(this));
        cashback.setOracle(address(oracle), 100);
        nvda.approve(address(cashback), 10 ether);
        cashback.fund(address(nvda), 10 ether);
    }

    function _caller(AllocationController.Strategy s) internal returns (TierCaller c) {
        c = new TierCaller(cashback, s);
        cashback.setAuthorizedVault(address(c), true);
    }

    function test_DefaultTiers() public view {
        (uint256 dMin, uint256 dReward) = cashback.rewardTiers(DEF);
        (uint256 bMin, uint256 bReward) = cashback.rewardTiers(BAL);
        (uint256 aMin, uint256 aReward) = cashback.rewardTiers(AGG);
        assertEq(dMin, 50e8);
        assertEq(dReward, 0.77e8);
        assertEq(bMin, 50e8);
        assertEq(bReward, 2e8);
        assertEq(aMin, 150e8);
        assertEq(aReward, 6e8);
    }

    function test_DefensivePays77Cents() public {
        TierCaller c = _caller(DEF);
        // $0.77 of NVDA at $500 = 0.00154 NVDA
        c.pay(alice, address(nvda), 0.00154 ether, 50e8);
        assertEq(cashback.walletStockbackUsd8(alice), 0.77e8);
        assertEq(nvda.balanceOf(address(c)), 0.00154 ether);
    }

    function test_DefensiveCannotTakeBalancedReward() public {
        TierCaller c = _caller(DEF);
        vm.expectRevert(bytes("CashbackReserve: amount exceeds reward"));
        c.pay(alice, address(nvda), 0.004 ether, 500e8);
    }

    function test_BalancedPaysTwoDollars() public {
        TierCaller c = _caller(BAL);
        c.pay(alice, address(nvda), 0.004 ether, 50e8);
        assertEq(cashback.walletStockbackUsd8(alice), 2e8);
    }

    function test_AggressiveStrictlyNeeds150() public {
        TierCaller c = _caller(AGG);
        assertFalse(cashback.canReward(AGG, alice, 149.99999999e8), "below $150");
        vm.expectRevert(bytes("CashbackReserve: ineligible"));
        c.pay(alice, address(nvda), 0.012 ether, 149.99999999e8);

        assertTrue(cashback.canReward(AGG, alice, 150e8));
        c.pay(alice, address(nvda), 0.012 ether, 150e8);
        assertEq(cashback.walletStockbackUsd8(alice), 6e8);
    }

    function test_DefensiveAndBalancedBelow50Ineligible() public view {
        assertFalse(cashback.canReward(DEF, alice, 49.99e8));
        assertFalse(cashback.canReward(BAL, alice, 49.99e8));
        assertTrue(cashback.canReward(DEF, alice, 50e8));
    }

    function test_ZeroRewardTierDisabled() public {
        cashback.setRewardTier(DEF, 50e8, 0);
        assertFalse(cashback.canReward(DEF, alice, 1_000e8));
    }

    function test_WithdrawRecoversInventory() public {
        uint256 bal = nvda.balanceOf(address(cashback));
        cashback.withdraw(address(nvda), carol, bal);
        assertEq(nvda.balanceOf(carol), bal);
        assertEq(nvda.balanceOf(address(cashback)), 0);

        vm.prank(bob);
        vm.expectRevert();
        cashback.withdraw(address(nvda), bob, 1);
    }
}

/// @dev End-to-end: an Aggressive factory vault pays $6 only from $150.
contract AggressiveVaultStockbackTest is Test {
    MockERC20 nvda;
    MockERC20 aapl;
    MockERC20 msft;
    MockERC20 usdg;
    OracleAdapter oracle;
    CashbackReserve cashback;
    StrategyVault vault;
    address user = address(0xBEEF);
    address user2 = address(0xCAFE);

    function setUp() public {
        nvda = new MockERC20("NVDA", "NVDA");
        aapl = new MockERC20("AAPL", "AAPL");
        msft = new MockERC20("MSFT", "MSFT");
        usdg = new MockERC20("USDG", "USDG");
        oracle = new OracleAdapter(address(this));
        oracle.setPriceFeed(address(nvda), address(new MockOracle(500e8)));
        oracle.setPriceFeed(address(aapl), address(new MockOracle(200e8)));
        oracle.setPriceFeed(address(msft), address(new MockOracle(400e8)));
        oracle.setPriceFeed(address(usdg), address(new MockOracle(1e8)));

        AllocationController controller = new AllocationController(address(this));
        cashback = new CashbackReserve(address(this));
        cashback.setOracle(address(oracle), 100);
        EmergencyRegistry emergency = new EmergencyRegistry(address(this));
        MockUniswapV3Router uni = new MockUniswapV3Router(address(oracle));
        UniswapV3SwapAdapter adapter = new UniswapV3SwapAdapter(address(this), address(uni));
        ExecutionRouter router = new ExecutionRouter(address(this), address(adapter));
        router.setEmergency(address(emergency));
        router.setOracle(address(oracle));
        router.setMaxSlippageBps(100);
        adapter.setAuthorizedCaller(address(router), true);

        address[] memory toks = new address[](4);
        (toks[0], toks[1], toks[2], toks[3]) = (address(nvda), address(aapl), address(msft), address(usdg));
        uint256[] memory w = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            controller.setApprovedAsset(toks[i], true);
            router.setApprovedToken(toks[i], true);
            MockERC20(toks[i]).transfer(address(uni), 100_000 ether);
            w[i] = 2500;
        }

        VaultFactory factory = new VaultFactory(
            address(this), address(oracle), address(controller), address(cashback), address(emergency), address(router)
        );
        factory.setUsdStableAsset(address(usdg));
        (address v,) = factory.createVault(
            VaultFactory.CreateParams({
                depositAsset: address(nvda),
                strategy: AllocationController.Strategy.Aggressive,
                receiptName: "Compose NVDA Aggressive",
                receiptSymbol: "tNVDA-A",
                tvlCapUsd8: 1_000_000e8,
                targetTokens: toks,
                targetWeightsBps: w
            })
        );
        vault = StrategyVault(v);
        router.setAuthorizedCaller(v, true);
        cashback.setAuthorizedVault(v, true);
        nvda.approve(address(cashback), 10 ether);
        cashback.fund(address(nvda), 10 ether);

        nvda.transfer(user, 10 ether);
        nvda.transfer(user2, 10 ether);
        vm.prank(user);
        nvda.approve(v, type(uint256).max);
        vm.prank(user2);
        nvda.approve(v, type(uint256).max);
    }

    function test_Deposit149EarnsNothing() public {
        uint256 before = nvda.balanceOf(user);
        vm.prank(user);
        vault.deposit(0.298 ether, 0); // $149
        assertEq(nvda.balanceOf(user), before - 0.298 ether, "no reward under $150");
        assertEq(cashback.walletStockbackUsd8(user), 0);
    }

    function test_Deposit150EarnsSixDollars() public {
        uint256 before = nvda.balanceOf(user2);
        vm.prank(user2);
        vault.deposit(0.3 ether, 0); // $150
        // $6 of NVDA at $500 = 0.012 NVDA
        assertEq(nvda.balanceOf(user2), before - 0.3 ether + 0.012 ether, "aggressive reward forwarded");
        assertEq(cashback.walletStockbackUsd8(user2), 6e8);
    }
}
