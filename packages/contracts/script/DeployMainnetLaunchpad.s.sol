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

/// @title DeployMainnetLaunchpad — Compose launchpad + bonding curve on Robinhood Chain (4663)
/// @notice Deploys the oracle with keeper-pushed price feeds, the pair launchpad
///         (PairFactory + PairDeployer, Uniswap v4 pool seeding against USDG),
///         PairRouter (ETH/USDG buy & sell through Uniswap SwapRouter02) and
///         ComposeCurve + CurveRouter. The deployer owns every contract and receives
///         protocol fees. Basket vaults are intentionally NOT deployed.
///
///   DEPLOYER_PRIVATE_KEY
///   PRICE_NVDA … PRICE_SNDK, PRICE_WETH   opening prices, USD with 8 decimals
///   CURVE_START_MCAP_USD8                 optional, default $3,450 (Pons launch market cap)
contract DeployMainnetLaunchpad is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant UNISWAP_SWAP_ROUTER02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant V4_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;
    address constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address constant AMZN = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant SNDK = 0xB90A19fF0Af67f7779afF50A882A9CfF42446400;

    uint256 constant FEED_COUNT = 11;

    OracleAdapter public oracle;
    EmergencyRegistry public emergency;
    PriceFeedUpdater public updater;
    PairDeployer public pairDeployer;
    PairFactory public factory;
    PairRouter public pairRouter;
    ComposeCurve public curve;
    CurveRouter public curveRouter;
    address[FEED_COUNT] public feeds;

    function run() external {
        require(block.chainid == 4663, "DeployMainnetLaunchpad: wrong chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 startMcapUsd8 = vm.envOr("CURVE_START_MCAP_USD8", uint256(3_450e8));

        string[FEED_COUNT] memory symbols =
            ["NVDA", "AAPL", "MSFT", "SPY", "QQQ", "GOOGL", "AMZN", "TSLA", "SNDK", "WETH", "USDG"];
        address[FEED_COUNT] memory tokens = [NVDA, AAPL, MSFT, SPY, QQQ, GOOGL, AMZN, TSLA, SNDK, WETH, USDG];
        int256[FEED_COUNT] memory prices;
        for (uint256 i; i < FEED_COUNT - 1; ++i) {
            prices[i] = int256(vm.envUint(string.concat("PRICE_", symbols[i])));
            require(prices[i] > 0, "DeployMainnetLaunchpad: missing price");
        }
        prices[FEED_COUNT - 1] = 1e8; // USDG

        vm.startBroadcast(pk);

        oracle = new OracleAdapter(deployer);
        emergency = new EmergencyRegistry(deployer);
        updater = new PriceFeedUpdater(deployer);
        updater.setKeeper(deployer, true);
        for (uint256 i; i < FEED_COUNT; ++i) {
            string memory label = string.concat(symbols[i], " / USD");
            feeds[i] = address(new PushPriceFeed(deployer, address(updater), label, prices[i]));
            oracle.setPriceFeed(tokens[i], feeds[i]);
        }

        pairDeployer = new PairDeployer();
        factory = new PairFactory(deployer, address(oracle), address(emergency), WETH, address(pairDeployer));
        for (uint256 i; i < FEED_COUNT - 1; ++i) {
            factory.setTokenListed(tokens[i], true); // 9 stocks + WETH (USDG is the pool quote, not a leg)
        }
        factory.setPoolConfig(V4_POSITION_MANAGER, PERMIT2, USDG);

        pairRouter = new PairRouter(address(factory), UNISWAP_SWAP_ROUTER02, USDG);
        curve = new ComposeCurve(deployer, address(factory), deployer, startMcapUsd8);
        curveRouter = new CurveRouter(address(curve), address(pairRouter));

        vm.stopBroadcast();

        _export(symbols, tokens, deployer, startMcapUsd8);
    }

    function _export(
        string[FEED_COUNT] memory symbols,
        address[FEED_COUNT] memory tokens,
        address deployer,
        uint256 startMcapUsd8
    ) internal {
        string memory tokensJson;
        string memory feedsJson;
        for (uint256 i; i < FEED_COUNT; ++i) {
            tokensJson = vm.serializeAddress("tokens", symbols[i], tokens[i]);
            feedsJson = vm.serializeAddress("feeds", symbols[i], feeds[i]);
        }
        vm.serializeAddress("contracts", "oracle", address(oracle));
        vm.serializeAddress("contracts", "emergency", address(emergency));
        vm.serializeAddress("contracts", "priceFeedUpdater", address(updater));
        vm.serializeAddress("contracts", "pairDeployer", address(pairDeployer));
        vm.serializeAddress("contracts", "pairFactory", address(factory));
        vm.serializeAddress("contracts", "pairRouter", address(pairRouter));
        vm.serializeAddress("contracts", "composeCurve", address(curve));
        vm.serializeAddress("contracts", "curveRouter", address(curveRouter));
        vm.serializeAddress("contracts", "swapRouter", UNISWAP_SWAP_ROUTER02);
        vm.serializeAddress("contracts", "usdg", USDG);
        string memory contractsJson = vm.serializeAddress("contracts", "owner", deployer);

        vm.serializeUint("root", "chainId", block.chainid);
        vm.serializeUint("root", "curveStartMarketCapUsd8", startMcapUsd8);
        vm.serializeString("root", "tokens", tokensJson);
        vm.serializeString("root", "feeds", feedsJson);
        string memory out = vm.serializeString("root", "contracts", contractsJson);
        vm.writeJson(out, "./deployments-mainnet-launchpad.json");

        console2.log("OracleAdapter:   ", address(oracle));
        console2.log("PriceFeedUpdater:", address(updater));
        console2.log("PairFactory:     ", address(factory));
        console2.log("PairRouter:      ", address(pairRouter));
        console2.log("ComposeCurve:      ", address(curve));
        console2.log("CurveRouter:     ", address(curveRouter));
    }
}
