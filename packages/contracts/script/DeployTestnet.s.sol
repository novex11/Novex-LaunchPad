// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PriceFeedUpdater} from "../src/PriceFeedUpdater.sol";

/// @title DeployTestnet — pair launchpad on Robinhood Chain Testnet (46630)
/// @notice Uses the real faucet Stock Tokens and canonical testnet WETH. No mock
///         tokens or routers. Opening prices come from env (fetched from live
///         market data by scripts/deploy-testnet.sh); the keeper keeps them fresh.
///
///   PRICE_TSLA, PRICE_AMZN, PRICE_AMD, PRICE_PLTR, PRICE_NFLX, PRICE_WETH
///   (USD with 8 decimals)
contract DeployTestnet is Script {
    address constant WETH = 0x7943e237c7F95DA44E0301572D358911207852Fa;
    address constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;
    address constant AMZN = 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02;
    address constant AMD = 0x71178BAc73cBeb415514eB542a8995b82669778d;
    address constant PLTR = 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0;
    address constant NFLX = 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93;

    OracleAdapter public oracle;
    EmergencyRegistry public emergency;
    PriceFeedUpdater public updater;
    PairFactory public factory;
    address[6] public feeds;

    function run() external {
        require(block.chainid == 46630, "DeployTestnet: wrong chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint256 startBlock = vm.getBlockNumber();

        string[6] memory symbols = ["TSLA", "AMZN", "AMD", "PLTR", "NFLX", "WETH"];
        address[6] memory tokens = [TSLA, AMZN, AMD, PLTR, NFLX, WETH];
        int256[6] memory prices;
        for (uint256 i; i < 6; ++i) {
            prices[i] = int256(vm.envUint(string.concat("PRICE_", symbols[i])));
            require(prices[i] > 0, "DeployTestnet: missing price");
        }

        vm.startBroadcast(pk);

        oracle = new OracleAdapter(deployer);
        emergency = new EmergencyRegistry(deployer);
        updater = new PriceFeedUpdater(deployer);
        updater.setKeeper(deployer, true);

        for (uint256 i; i < 6; ++i) {
            string memory label = i == 5 ? "ETH / USD" : string.concat(symbols[i], " / USD");
            feeds[i] = address(new PushPriceFeed(deployer, address(updater), label, prices[i]));
            oracle.setPriceFeed(tokens[i], feeds[i]);
        }

        factory = new PairFactory(deployer, address(oracle), address(emergency), WETH, address(new PairDeployer()));
        for (uint256 i; i < 6; ++i) {
            factory.setTokenListed(tokens[i], true);
        }

        vm.stopBroadcast();

        _export(symbols, tokens, startBlock);
    }

    function _export(string[6] memory symbols, address[6] memory tokens, uint256 startBlock) internal {
        string memory tokensJson;
        string memory feedsJson;
        for (uint256 i; i < 6; ++i) {
            tokensJson = vm.serializeAddress("tokens", symbols[i], tokens[i]);
            feedsJson = vm.serializeAddress("feeds", symbols[i], feeds[i]);
        }
        vm.serializeAddress("contracts", "oracle", address(oracle));
        vm.serializeAddress("contracts", "emergency", address(emergency));
        vm.serializeAddress("contracts", "priceFeedUpdater", address(updater));
        string memory contractsJson = vm.serializeAddress("contracts", "pairFactory", address(factory));

        vm.serializeUint("root", "chainId", block.chainid);
        vm.serializeUint("root", "startBlock", startBlock);
        vm.serializeString("root", "tokens", tokensJson);
        vm.serializeString("root", "feeds", feedsJson);
        string memory out = vm.serializeString("root", "contracts", contractsJson);
        vm.writeJson(out, "./deployments-testnet.json");

        console2.log("PairFactory:", address(factory));
        console2.log("OracleAdapter:", address(oracle));
        console2.log("PriceFeedUpdater:", address(updater));
        console2.log("Start block:", startBlock);
    }
}
