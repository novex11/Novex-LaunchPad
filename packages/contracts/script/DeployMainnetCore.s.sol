// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PriceFeedUpdater} from "../src/PriceFeedUpdater.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairRouter} from "../src/PairRouter.sol";
import {ComposeCurve} from "../src/ComposeCurve.sol";
import {CurveRouter} from "../src/CurveRouter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @title DeployMainnetCore — Compose core stack on Robinhood Chain (4663)
/// @dev FRESH-CHAIN ONLY — NOT USED FOR THE CURRENT MAINNET. The launchpad
///      (oracle, feeds, PairFactory, PairRouter, curve) is already live on 4663
///      (see deployments-mainnet-launchpad.json). scripts/deploy-mainnet.sh runs
///      DeployMainnetBaskets → OnboardMainnetTokens → CreateMainnetVaults on top
///      of it instead. Keep this script for a from-scratch deployment on a new
///      chain; running it on mainnet would create a second, disconnected stack.
/// @notice Deploys the oracle with keeper-pushed price feeds for USDG and WETH,
///         the pair launchpad (PairFactory + PairDeployer, Uniswap v4 pool
///         seeding against USDG), PairRouter (ETH/USDG buy & sell through Uniswap
///         SwapRouter02), ComposeCurve + CurveRouter, and the basket stack
///         (AllocationController, CashbackReserve, UniswapV3SwapAdapter,
///         ExecutionRouter, VaultFactory). Stock tokens are onboarded afterwards
///         by OnboardMainnetTokens and CreateMainnetVaults. The deployer owns
///         every contract.
///
///   DEPLOYER_PRIVATE_KEY        broadcaster and owner
///   KEEPER_ADDRESS              optional extra price keeper (owner is always allowed)
///   TREASURY                    optional curve fee recipient (defaults to deployer)
///   CURVE_START_MCAP_USD8       optional, default $50 (same as DeployTestnetCurve)
///   MAINNET_ONBOARD_FILE        prices file from scripts/fetch-mainnet-prices.ts
///                               (default ./mainnet-onboard.json)
///   MAINNET_DEPLOYMENTS_DIR     where deployments-mainnet.json is written (default ".")
contract DeployMainnetCore is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant UNI_V3_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant V4_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    OracleAdapter public oracle;
    EmergencyRegistry public emergency;
    PriceFeedUpdater public updater;
    PushPriceFeed public usdgFeed;
    PushPriceFeed public wethFeed;
    PairDeployer public pairDeployer;
    PairFactory public factory;
    PairRouter public pairRouter;
    ComposeCurve public curve;
    CurveRouter public curveRouter;
    AllocationController public controller;
    CashbackReserve public cashback;
    UniswapV3SwapAdapter public swapAdapter;
    ExecutionRouter public execRouter;
    VaultFactory public vaultFactory;

    address public owner;
    address public treasury;
    address public keeper;
    uint256 public startMcapUsd8;

    function run() external {
        require(block.chainid == 4663, "DeployMainnetCore: wrong chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        owner = vm.addr(pk);
        treasury = vm.envOr("TREASURY", owner);
        keeper = vm.envOr("KEEPER_ADDRESS", address(0));
        startMcapUsd8 = vm.envOr("CURVE_START_MCAP_USD8", uint256(50e8));

        (int256 usdgPrice, int256 wethPrice) = _loadPrices();
        require(usdgPrice == 1e8, "DeployMainnetCore: USDG price must be 1e8");
        require(wethPrice > 0, "DeployMainnetCore: missing WETH price");

        vm.startBroadcast(pk);

        // ─── Oracle + keeper ───────────────────────────────
        oracle = new OracleAdapter(owner);
        emergency = new EmergencyRegistry(owner);
        updater = new PriceFeedUpdater(owner);
        if (keeper != address(0) && keeper != owner) {
            updater.setKeeper(keeper, true);
        }
        usdgFeed = new PushPriceFeed(owner, address(updater), "USDG / USD", usdgPrice);
        oracle.setPriceFeed(USDG, address(usdgFeed));
        wethFeed = new PushPriceFeed(owner, address(updater), "ETH / USD", wethPrice);
        oracle.setPriceFeed(WETH, address(wethFeed));

        // ─── Pair launchpad + bonding curve ────────────────
        pairDeployer = new PairDeployer();
        factory = new PairFactory(owner, address(oracle), address(emergency), WETH, address(pairDeployer));
        factory.setTokenListed(WETH, true); // USDG is the pool quote, not a launchable leg
        factory.setPoolConfig(V4_POSITION_MANAGER, PERMIT2, USDG);
        pairRouter = new PairRouter(address(factory), UNI_V3_ROUTER, USDG);
        curve = new ComposeCurve(owner, address(factory), treasury, startMcapUsd8);
        curveRouter = new CurveRouter(address(curve), address(pairRouter));

        // ─── Basket stack ──────────────────────────────────
        controller = new AllocationController(owner);
        cashback = new CashbackReserve(owner);
        swapAdapter = new UniswapV3SwapAdapter(owner, UNI_V3_ROUTER);
        execRouter = new ExecutionRouter(owner, address(swapAdapter));
        swapAdapter.setAuthorizedCaller(address(execRouter), true);
        vaultFactory = new VaultFactory(
            owner, address(oracle), address(controller), address(cashback), address(emergency), address(execRouter)
        );
        execRouter.setEmergency(address(emergency));
        vaultFactory.setUsdStableAsset(USDG);
        controller.setApprovedAsset(USDG, true);
        execRouter.setApprovedToken(USDG, true);
        controller.setApprovedAsset(WETH, true);
        execRouter.setApprovedToken(WETH, true);

        vm.stopBroadcast();

        _export();
    }

    /// @dev USDG / WETH opening prices from mainnet-onboard.json (parallel arrays).
    function _loadPrices() internal view returns (int256 usdgPrice, int256 wethPrice) {
        string memory path = vm.envOr("MAINNET_ONBOARD_FILE", string("./mainnet-onboard.json"));
        require(vm.exists(path), "DeployMainnetCore: run scripts/fetch-mainnet-prices.ts first");
        string memory json = vm.readFile(path);
        string[] memory tickers = vm.parseJsonStringArray(json, ".tickers");
        uint256[] memory prices = vm.parseJsonUintArray(json, ".prices");
        require(tickers.length == prices.length, "DeployMainnetCore: onboard arrays mismatch");
        for (uint256 i; i < tickers.length; ++i) {
            bytes32 h = keccak256(bytes(tickers[i]));
            if (h == keccak256("USDG")) usdgPrice = int256(prices[i]);
            else if (h == keccak256("WETH")) wethPrice = int256(prices[i]);
        }
    }

    function _export() internal {
        vm.serializeAddress("contracts", "oracle", address(oracle));
        vm.serializeAddress("contracts", "emergency", address(emergency));
        vm.serializeAddress("contracts", "priceFeedUpdater", address(updater));
        vm.serializeAddress("contracts", "pairDeployer", address(pairDeployer));
        vm.serializeAddress("contracts", "pairFactory", address(factory));
        vm.serializeAddress("contracts", "pairRouter", address(pairRouter));
        vm.serializeAddress("contracts", "swapRouter", UNI_V3_ROUTER);
        vm.serializeAddress("contracts", "usdg", USDG);
        vm.serializeAddress("contracts", "usdgFeed", address(usdgFeed));
        vm.serializeAddress("contracts", "weth", WETH);
        vm.serializeAddress("contracts", "composeCurve", address(curve));
        vm.serializeAddress("contracts", "curveRouter", address(curveRouter));
        vm.serializeAddress("contracts", "allocationController", address(controller));
        vm.serializeAddress("contracts", "cashbackReserve", address(cashback));
        vm.serializeAddress("contracts", "executionRouter", address(execRouter));
        vm.serializeAddress("contracts", "swapAdapter", address(swapAdapter));
        vm.serializeAddress("contracts", "vaultFactory", address(vaultFactory));
        vm.serializeAddress("contracts", "owner", owner);
        string memory contractsJson = vm.serializeAddress("contracts", "treasury", treasury);

        vm.serializeAddress("feeds", "USDG", address(usdgFeed));
        string memory feedsJson = vm.serializeAddress("feeds", "WETH", address(wethFeed));

        vm.serializeUint("root", "chainId", block.chainid);
        vm.serializeUint("root", "curveStartMarketCapUsd8", startMcapUsd8);
        vm.serializeAddress("root", "keeper", keeper);
        vm.serializeString("root", "feeds", feedsJson);
        string memory out = vm.serializeString("root", "contracts", contractsJson);

        string memory dir = vm.envOr("MAINNET_DEPLOYMENTS_DIR", string("."));
        vm.writeJson(out, string.concat(dir, "/deployments-mainnet.json"));

        console2.log("OracleAdapter:       ", address(oracle));
        console2.log("EmergencyRegistry:   ", address(emergency));
        console2.log("PriceFeedUpdater:    ", address(updater));
        console2.log("PairFactory:         ", address(factory));
        console2.log("PairRouter:          ", address(pairRouter));
        console2.log("ComposeCurve:          ", address(curve));
        console2.log("CurveRouter:         ", address(curveRouter));
        console2.log("AllocationController:", address(controller));
        console2.log("CashbackReserve:     ", address(cashback));
        console2.log("UniswapV3SwapAdapter:", address(swapAdapter));
        console2.log("ExecutionRouter:     ", address(execRouter));
        console2.log("VaultFactory:        ", address(vaultFactory));
        console2.log("Curve start mcap (USD8):", startMcapUsd8);
    }
}
