// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairRouter} from "../src/PairRouter.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {OracleSwapRouter} from "../src/testnet/OracleSwapRouter.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";
import {FixedPriceFeed} from "../src/testnet/FixedPriceFeed.sol";

/// @title DeployTestnetRouter — USDG/ETH buy & sell for the testnet launchpad
/// @notice Reuses the live OracleAdapter, price feeds and keeper from
///         DeployTestnet. Deploys a new PairFactory (vaults with operator
///         redeem), TestUSDG with a fixed $1 feed, the oracle-priced testnet swap
///         router (stand-in for Uniswap) funded from the deployer's faucet
///         balances, and PairRouter.
///
///   TESTNET_ORACLE, TESTNET_EMERGENCY  existing deployment
///   WETH_INVENTORY_WEI                 ETH to wrap into swap inventory (optional)
contract DeployTestnetRouter is Script {
    address constant WETH = 0x7943e237c7F95DA44E0301572D358911207852Fa;
    address constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;
    address constant AMZN = 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02;
    address constant AMD = 0x71178BAc73cBeb415514eB542a8995b82669778d;
    address constant PLTR = 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0;
    address constant NFLX = 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93;

    /// @dev Stock inventory per token; leaves the rest of the faucet balance for launching.
    uint256 constant STOCK_INVENTORY = 10 ether;
    uint256 constant USDG_INVENTORY = 1_000_000e6;
    uint256 constant USDG_TO_DEPLOYER = 10_000e6;

    PairFactory public factory;
    TestUSDG public usdg;
    FixedPriceFeed public usdgFeed;
    OracleSwapRouter public swapRouter;
    PairRouter public router;

    function run() external {
        require(block.chainid == 46630, "DeployTestnetRouter: wrong chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        OracleAdapter oracle = OracleAdapter(vm.envAddress("TESTNET_ORACLE"));
        address emergency = vm.envAddress("TESTNET_EMERGENCY");
        uint256 wethInventory = vm.envOr("WETH_INVENTORY_WEI", uint256(0));

        address[5] memory stocks = [TSLA, AMZN, AMD, PLTR, NFLX];

        vm.startBroadcast(pk);

        usdg = new TestUSDG(deployer);
        usdgFeed = new FixedPriceFeed("USDG / USD", 1e8);
        oracle.setPriceFeed(address(usdg), address(usdgFeed));

        factory = new PairFactory(deployer, address(oracle), emergency, WETH, address(new PairDeployer()));
        for (uint256 i; i < stocks.length; ++i) {
            factory.setTokenListed(stocks[i], true);
        }
        factory.setTokenListed(WETH, true);

        swapRouter = new OracleSwapRouter(deployer, address(oracle));
        router = new PairRouter(address(factory), address(swapRouter), address(usdg));

        usdg.mint(address(swapRouter), USDG_INVENTORY);
        usdg.mint(deployer, USDG_TO_DEPLOYER);
        for (uint256 i; i < stocks.length; ++i) {
            uint256 bal = IERC20(stocks[i]).balanceOf(deployer);
            uint256 amount = bal > STOCK_INVENTORY ? STOCK_INVENTORY : bal / 2;
            if (amount > 0) {
                require(IERC20(stocks[i]).transfer(address(swapRouter), amount), "stock transfer failed");
            }
        }
        if (wethInventory > 0) {
            IWETH(WETH).deposit{value: wethInventory}();
            require(IERC20(WETH).transfer(address(swapRouter), wethInventory), "WETH transfer failed");
        }

        vm.stopBroadcast();

        vm.serializeAddress("router", "pairFactory", address(factory));
        vm.serializeAddress("router", "pairRouter", address(router));
        vm.serializeAddress("router", "swapRouter", address(swapRouter));
        vm.serializeAddress("router", "usdgFeed", address(usdgFeed));
        string memory out = vm.serializeAddress("router", "usdg", address(usdg));
        vm.writeJson(out, "./deployments-testnet-router.json");

        console2.log("PairFactory:", address(factory));
        console2.log("PairRouter:", address(router));
        console2.log("OracleSwapRouter:", address(swapRouter));
        console2.log("TestUSDG:", address(usdg));
    }
}
