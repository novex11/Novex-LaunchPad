// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {PairFactory} from "../src/PairFactory.sol";

/// @title RegisterFeeds — post-deploy wiring for mainnet
/// @notice DeployMainnet leaves price feeds unset. Run this once the Chainlink
///         (or equivalent) feed addresses are known. For every ticker with a
///         `FEED_<TICKER>` env var it registers the feed and lists the token on
///         the launchpad; tickers without a feed are skipped and reported.
///         Optionally enables launch-time pool seeding.
///
///   ORACLE_ADAPTER                     deployed OracleAdapter
///   PAIR_FACTORY                       deployed PairFactory
///   FEED_NVDA, FEED_AAPL, ...          feed address per ticker (optional each)
///   FEED_USDG                          required if pools are enabled
///   UNISWAP_V4_POSITION_MANAGER        optional; with FEED_USDG enables pool seeding
///   PERMIT2                            optional; defaults to the canonical Permit2
contract RegisterFeeds is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    string[11] symbols = ["NVDA", "AAPL", "MSFT", "SPY", "QQQ", "GOOGL", "AMZN", "TSLA", "SNDK", "USDG", "WETH"];
    address[11] tokens = [
        0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,
        0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9,
        0xe93237C50D904957Cf27E7B1133b510C669c2e74,
        0x117cc2133c37B721F49dE2A7a74833232B3B4C0C,
        0xD5f3879160bc7c32ebb4dC785F8a4F505888de68,
        0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3,
        0x12f190a9F9d7D37a250758b26824B97CE941bF54,
        0x322F0929c4625eD5bAd873c95208D54E1c003b2d,
        0xB90A19fF0Af67f7779afF50A882A9CfF42446400,
        USDG,
        WETH
    ];

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        OracleAdapter oracle = OracleAdapter(vm.envAddress("ORACLE_ADAPTER"));
        PairFactory factory = PairFactory(vm.envAddress("PAIR_FACTORY"));
        address positionManager = vm.envOr("UNISWAP_V4_POSITION_MANAGER", address(0));
        address permit2 = vm.envOr("PERMIT2", 0x000000000022D473030F116dDEE9F6B43aC78BA3);

        vm.startBroadcast(pk);

        uint256 registered;
        for (uint256 i; i < tokens.length; ++i) {
            address feed = vm.envOr(string.concat("FEED_", symbols[i]), address(0));
            if (feed == address(0)) {
                console2.log("skip (no FEED_ env):", symbols[i]);
                continue;
            }
            oracle.setPriceFeed(tokens[i], feed);
            // USDG is the quote asset, not a launchable leg.
            if (tokens[i] != USDG) factory.setTokenListed(tokens[i], true);
            registered += 1;
            console2.log("registered", symbols[i], feed);
        }

        if (positionManager != address(0)) {
            require(oracle.hasFeed(USDG), "RegisterFeeds: FEED_USDG required for pools");
            factory.setPoolConfig(positionManager, permit2, USDG);
            console2.log("pool seeding enabled via", positionManager);
        }

        vm.stopBroadcast();
        console2.log("feeds registered:", registered);
    }
}
