// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {ReceiptToken} from "../src/ReceiptToken.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract InvariantsTest is Test {
    StrategyVault vault;
    ReceiptToken receipt;
    OracleAdapter oracle;
    AllocationController controller;
    CashbackReserve cashback;
    EmergencyRegistry emergency;
    ExecutionRouter router;
    MockSwapRouter mockRouter;

    MockERC20 nvda;
    MockERC20 aapl;
    MockERC20 msft;
    MockERC20 googl;
    MockERC20 usdg;

    address user = address(0xBEEF);

    function setUp() public {
        nvda = new MockERC20("NVDA", "NVDA");
        aapl = new MockERC20("AAPL", "AAPL");
        msft = new MockERC20("MSFT", "MSFT");
        googl = new MockERC20("GOOGL", "GOOGL");
        usdg = new MockERC20("USDG", "USDG");

        oracle = new OracleAdapter(address(this));
        controller = new AllocationController(address(this));
        cashback = new CashbackReserve(address(this));
        emergency = new EmergencyRegistry(address(this));
        mockRouter = new MockSwapRouter();
        router = new ExecutionRouter(address(this), address(mockRouter));

        oracle.setPriceFeed(address(nvda), address(new MockOracle(500e8)));
        oracle.setPriceFeed(address(aapl), address(new MockOracle(200e8)));
        oracle.setPriceFeed(address(msft), address(new MockOracle(400e8)));
        oracle.setPriceFeed(address(googl), address(new MockOracle(180e8)));
        oracle.setPriceFeed(address(usdg), address(new MockOracle(1e8)));

        controller.setApprovedAsset(address(nvda), true);
        controller.setApprovedAsset(address(aapl), true);
        controller.setApprovedAsset(address(msft), true);
        controller.setApprovedAsset(address(googl), true);
        controller.setApprovedAsset(address(usdg), true);

        router.setApprovedToken(address(nvda), true);
        router.setApprovedToken(address(aapl), true);
        router.setApprovedToken(address(msft), true);
        router.setApprovedToken(address(googl), true);
        router.setApprovedToken(address(usdg), true);

        receipt = new ReceiptToken("tNVDA-B", "tNVDA-B", address(this));
        vault = new StrategyVault(
            address(this),
            address(nvda),
            AllocationController.Strategy.Balanced,
            address(receipt),
            address(oracle),
            address(controller),
            address(cashback),
            address(emergency),
            address(router),
            address(usdg),
            1_000_000e8
        );
        receipt.setVault(address(vault));
        vault.setTargetMix(_mixTokens(), _mixWeights());
        router.setAuthorizedCaller(address(vault), true);

        // Fund mock swap router with all tokens
        aapl.transfer(address(mockRouter), 100_000 ether);
        msft.transfer(address(mockRouter), 100_000 ether);
        googl.transfer(address(mockRouter), 100_000 ether);
        nvda.transfer(address(mockRouter), 100_000 ether);

        // Fund user
        nvda.transfer(user, 100 ether);
        vm.prank(user);
        nvda.approve(address(vault), type(uint256).max);
    }

    function _mixTokens() internal view returns (address[] memory tokens) {
        tokens = new address[](4);
        tokens[0] = address(nvda);
        tokens[1] = address(aapl);
        tokens[2] = address(msft);
        tokens[3] = address(googl);
    }

    function _mixWeights() internal pure returns (uint256[] memory weights) {
        weights = new uint256[](4);
        weights[0] = 2500;
        weights[1] = 2500;
        weights[2] = 2500;
        weights[3] = 2500;
    }

    function test_SharePriceAlwaysPositive() public view {
        uint256 price = vault.sharePrice();
        assertGt(price, 0, "share price > 0");
    }

    function test_NavMatchesTokenBalances() public {
        vm.prank(user);
        vault.deposit(2 ether, 0);

        uint256 nav = vault.navUsd8();
        uint256 manual = oracle.getTokenValueUsd(address(nvda), nvda.balanceOf(address(vault)))
            + oracle.getTokenValueUsd(address(aapl), aapl.balanceOf(address(vault)))
            + oracle.getTokenValueUsd(address(msft), msft.balanceOf(address(vault)))
            + oracle.getTokenValueUsd(address(googl), googl.balanceOf(address(vault)));
        assertEq(nav, manual, "NAV matches manual calc");
    }

    function test_ReceiptTokenNonTransferable() public {
        vm.prank(user);
        vault.deposit(2 ether, 0);

        vm.prank(user);
        vm.expectRevert("ReceiptToken: non-transferable");
        receipt.transfer(address(0xDEAD), 1);
    }

    function test_FullCycleDepositAndRedeem() public {
        vm.prank(user);
        uint256 shares = vault.deposit(2 ether, 0);

        assertGt(shares, 0, "shares minted");
        assertGt(vault.navUsd8(), 0, "NAV > 0");

        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.ProportionalBasket, 0);

        assertEq(receipt.balanceOf(user), 0, "all shares burned");
        assertEq(vault.totalShares(), 0, "total shares = 0");
        assertEq(vault.navUsd8(), 0, "NAV = 0 after full redeem");
    }

    function test_NavZeroAfterOriginalRedeem() public {
        vm.prank(user);
        uint256 shares = vault.deposit(2 ether, 0);

        vm.prank(user);
        vault.redeem(shares, StrategyVault.RedeemMode.OriginalAsset, 0);

        assertEq(vault.totalShares(), 0, "total shares = 0");
        // Vault should have negligible dust at most
        assertLt(vault.navUsd8(), 1e8, "NAV near 0 after full original redeem");
    }
}
