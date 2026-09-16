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

contract StockbackBandsTest is Test {

    OracleAdapter oracle;
    CashbackReserve cashback;
    MockERC20 nvda;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA201);

    AllocationController.Strategy constant DEF = AllocationController.Strategy.Defensive;
    AllocationController.Strategy constant BAL = AllocationController.Strategy.Balanced;
    AllocationController.Strategy constant AGG = AllocationController.Strategy.Aggressive;

    // NVDA at $500: $1 = 0.002 NVDA
    uint256 constant PER_USD = 0.002 ether;

    function setUp() public {
        nvda = new MockERC20("NVDA", "NVDA");
        oracle = new OracleAdapter(address(this));
        oracle.setPriceFeed(address(nvda), address(new MockOracle(500e8)));
        oracle.setStalenessThreshold(30 days); // tests warp past the 24h guard
        cashback = new CashbackReserve(address(this));
        cashback.setOracle(address(oracle), 100);
        nvda.approve(address(cashback), 10 ether);
        cashback.fund(address(nvda), 10 ether);
    }

    function _caller(AllocationController.Strategy s) internal returns (TierCaller c) {
        c = new TierCaller(cashback, s);
        cashback.setAuthorizedVault(address(c), true);
    }

    function test_DefaultBands() public view {
        uint256[5] memory deposits = [uint256(50e8), 150e8, 250e8, 500e8, 1_000e8];
        uint256[5] memory def = [uint256(0.77e8), 1.5e8, 2.5e8, 5e8, 10e8];
        uint256[5] memory bal = [uint256(2e8), 3e8, 4e8, 7e8, 12e8];
        uint256[5] memory agg = [uint256(0), 6e8, 8e8, 12e8, 20e8];
        for (uint256 i; i < 5; ++i) {
            assertEq(cashback.rewardUsd8For(DEF, deposits[i]), def[i], "defensive");
            assertEq(cashback.rewardUsd8For(BAL, deposits[i]), bal[i], "balanced");
            assertEq(cashback.rewardUsd8For(AGG, deposits[i]), agg[i], "aggressive");
        }
        assertEq(cashback.rewardBands(DEF).length, 5);
        assertEq(cashback.rewardBands(AGG).length, 4);
    }

    function test_RewardGrowsWithDeposit() public view {
        assertEq(cashback.rewardUsd8For(DEF, 49.99e8), 0, "below $50");
        assertEq(cashback.rewardUsd8For(DEF, 200e8), 1.5e8, "$200 defensive");
        assertEq(cashback.rewardUsd8For(DEF, 249.99e8), 1.5e8, "just under a band");
        assertEq(cashback.rewardUsd8For(DEF, 50_000e8), 10e8, "top band");
        assertEq(cashback.rewardUsd8For(AGG, 149.99e8), 0, "aggressive needs $150");
        assertEq(cashback.rewardUsd8For(AGG, 150e8), 6e8);
    }

    function test_DefensiveBandsPayInstantly() public {
        TierCaller c = _caller(DEF);
        // $0.77 at $50
        c.pay(alice, address(nvda), (77 * PER_USD) / 100, 50e8);
        assertEq(cashback.walletStockbackUsd8(alice), 0.77e8);
        // $1.50 at $200
        c.pay(bob, address(nvda), (3 * PER_USD) / 2, 200e8);
        assertEq(cashback.walletStockbackUsd8(bob), 1.5e8);
        assertEq(nvda.balanceOf(address(c)), (77 * PER_USD) / 100 + (3 * PER_USD) / 2, "paid out to the vault");
    }

    function test_CannotTakeHigherBand() public {
        TierCaller c = _caller(DEF);
        // $200 earns $1.50; asking for $2.50 of NVDA fails the oracle check
        vm.expectRevert(bytes("CashbackReserve: amount exceeds reward"));
        c.pay(alice, address(nvda), (5 * PER_USD) / 2, 200e8);
    }

    function test_AggressiveTopBand() public {
        TierCaller c = _caller(AGG);
        vm.expectRevert(bytes("CashbackReserve: ineligible"));
        c.pay(alice, address(nvda), 12 * PER_USD, 149.99e8);
        c.pay(alice, address(nvda), 20 * PER_USD, 1_000e8);
        assertEq(cashback.walletStockbackUsd8(alice), 20e8);
    }

    function test_WalletCapClampsReward() public {
        TierCaller c = _caller(AGG);
        c.pay(alice, address(nvda), 20 * PER_USD, 1_000e8);
        vm.warp(block.timestamp + 1 days);
        c.pay(alice, address(nvda), 20 * PER_USD, 1_000e8);
        vm.warp(block.timestamp + 1 days);
        assertEq(cashback.quoteReward(AGG, alice, 1_000e8), 10e8, "clamped to the $50 cap");
        vm.expectRevert(bytes("CashbackReserve: amount exceeds reward"));
        c.pay(alice, address(nvda), 20 * PER_USD, 1_000e8);
        c.pay(alice, address(nvda), 10 * PER_USD, 1_000e8);
        assertEq(cashback.walletStockbackUsd8(alice), 50e8);
        vm.warp(block.timestamp + 1 days);
        assertEq(cashback.quoteReward(AGG, alice, 1_000e8), 0, "cap reached");
    }

    function test_DuplicateGuard() public {
        TierCaller c = _caller(BAL);
        c.pay(alice, address(nvda), 2 * PER_USD, 50e8);
        assertEq(cashback.quoteReward(BAL, alice, 500e8), 0, "within 24h");
        vm.warp(block.timestamp + 1 days);
        assertEq(cashback.quoteReward(BAL, alice, 500e8), 7e8);
    }

    function test_SetRewardBands() public {
        CashbackReserve.RewardBand[] memory bands = new CashbackReserve.RewardBand[](2);
        bands[0] = CashbackReserve.RewardBand(100e8, 1e8);
        bands[1] = CashbackReserve.RewardBand(400e8, 5e8);
        cashback.setRewardBands(DEF, bands);
        assertEq(cashback.rewardUsd8For(DEF, 99e8), 0);
        assertEq(cashback.rewardUsd8For(DEF, 399e8), 1e8);
        assertEq(cashback.rewardUsd8For(DEF, 1_000e8), 5e8);
        assertEq(cashback.rewardBands(DEF).length, 2, "old bands replaced");

        bands[1].minDepositUsd8 = 100e8;
        vm.expectRevert(bytes("CashbackReserve: bands not ascending"));
        cashback.setRewardBands(DEF, bands);

        vm.prank(bob);
        vm.expectRevert();
        cashback.setRewardBands(DEF, bands);

        cashback.setRewardBands(AGG, new CashbackReserve.RewardBand[](0));
        assertEq(cashback.quoteReward(AGG, alice, 1_000e8), 0, "empty bands turn Stockback off");
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

/// @dev End-to-end: an Aggressive factory vault pays its band instantly, nothing below $150.
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

    function test_Deposit1000EarnsTwentyDollarsInstantly() public {
        uint256 before = nvda.balanceOf(user2);
        vm.prank(user2);
        vault.deposit(2 ether, 0); // $1,000
        // $20 of NVDA at $500 = 0.04 NVDA
        assertEq(nvda.balanceOf(user2), before - 2 ether + 0.04 ether, "top band forwarded");
        assertEq(cashback.walletStockbackUsd8(user2), 20e8);
    }

    /// Whatever gas limit a wallet picks, a deposit either reverts or pays its reward.
    function test_GasStarvedPayoutNeverSilentlySkipped() public {
        for (uint256 gasLimit = 300_000; gasLimit <= 1_500_000; gasLimit += 1_000) {
            uint256 snap = vm.snapshotState();
            vm.prank(user2);
            (bool ok,) = address(vault).call{gas: gasLimit}(abi.encodeCall(StrategyVault.deposit, (0.5 ether, 0)));
            if (ok) assertEq(cashback.walletStockbackUsd8(user2), 8e8, "succeeded without its reward");
            vm.revertToState(snap);
        }
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
