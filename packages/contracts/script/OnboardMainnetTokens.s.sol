// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {MainnetScriptBase} from "./MainnetScriptBase.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";

/// @title OnboardMainnetTokens — list tokenized stocks on the live Compose launchpad
/// @notice Idempotent. For every token in mainnet-onboard.json (except USDG and
///         WETH, which the launchpad and DeployMainnetBaskets already cover) it
///         deploys a keeper-updated PushPriceFeed at the fetched opening price,
///         registers it on the existing oracle, lists the token on the existing
///         PairFactory and approves it for baskets (when deployments-mainnet-
///         baskets.json exists). Tickers that already have a feed in
///         deployments-mainnet-launchpad.json are never redeployed; on-chain
///         state is re-checked for everything else, so reruns only fill gaps.
///
///         Feeds are merged into deployments-mainnet-feeds.json, seeded with the
///         launchpad feeds so the file is always complete.
///
///   DEPLOYER_PRIVATE_KEY / FORK_IMPERSONATE_OWNER  see MainnetScriptBase (owner-gated)
///   ONBOARD_TICKERS                optional comma list restricting the run (e.g. "NVDA,AAPL")
///   ONBOARD_OFFSET / ONBOARD_LIMIT optional batching window over the onboard list
///   MAINNET_ONBOARD_FILE, MAINNET_LAUNCHPAD_FILE, MAINNET_DEPLOYMENTS_DIR  see MainnetScriptBase
contract OnboardMainnetTokens is MainnetScriptBase {
    OracleAdapter oracleC;
    PairFactory factoryC;
    AllocationController controllerC;
    ExecutionRouter execRouterC;

    /// @dev Ordered ticker list for the feeds JSON (launchpad first, then file, then new).
    string[] feedTickers;
    mapping(string => address) feedOf;
    mapping(string => bool) hasFeedEntry;

    uint256 deployedFeeds;
    uint256 launchpadFeeds;
    uint256 existingFeeds;
    uint256 configured;

    function _tag() internal pure override returns (string memory) {
        return "OnboardMainnetTokens";
    }

    function run() external {
        _loadLaunchpad();
        oracleC = OracleAdapter(oracle);
        factoryC = PairFactory(pairFactory);
        require(oracleC.owner() == owner, _err("launchpad owner does not own the oracle"));
        require(factoryC.owner() == owner, _err("launchpad owner does not own the PairFactory"));

        if (_loadBaskets()) {
            controllerC = AllocationController(allocationController);
            execRouterC = ExecutionRouter(executionRouter);
            require(controllerC.owner() == owner, _err("launchpad owner does not own the AllocationController"));
        } else {
            console2.log("no deployments-mainnet-baskets.json: skipping basket approvals (run DeployMainnetBaskets first)");
        }

        _loadOnboard();
        for (uint256 i; i < launchpadFeedTickers.length; ++i) {
            _recordFeed(launchpadFeedTickers[i], launchpadFeed[launchpadFeedTickers[i]]);
        }
        string memory feedsPath = string.concat(_deploymentsDir(), "/deployments-mainnet-feeds.json");
        _loadExistingFeeds(feedsPath);

        (string[] memory only, bool filtered) = _tickerFilter("ONBOARD");
        (uint256 offset, uint256 end) = _window("ONBOARD");

        _startBroadcastAsOwner();
        for (uint256 i = offset; i < end; ++i) {
            address token = tokens[i];
            if (token == usdg || token == weth) continue;
            if (filtered && !_contains(only, tickers[i])) continue;
            _onboard(tickers[i], token, prices[i]);
        }
        vm.stopBroadcast();

        _exportFeeds(feedsPath);

        console2.log("feeds deployed:", deployedFeeds);
        console2.log("feeds from launchpad json (skipped):", launchpadFeeds);
        console2.log("feeds already on-chain:", existingFeeds);
        console2.log("tokens configured this run:", configured);
        console2.log("feeds in file:", feedTickers.length);
    }

    function _onboard(string memory ticker, address token, uint256 price) internal {
        address feed = launchpadFeed[ticker];
        if (feed != address(0)) {
            // Deployed by DeployMainnetLaunchpad; never redeploy, only fill wiring.
            ++launchpadFeeds;
        } else {
            feed = oracleC.priceFeeds(token);
            if (feed == address(0)) {
                require(price > 0, _err(string.concat("zero price for ", ticker)));
                feed = address(new PushPriceFeed(owner, priceFeedUpdater, string.concat(ticker, " / USD"), int256(price)));
                oracleC.setPriceFeed(token, feed);
                ++deployedFeeds;
            } else {
                ++existingFeeds;
            }
        }
        if (!factoryC.isListed(token)) factoryC.setTokenListed(token, true);
        if (hasBaskets) {
            if (!controllerC.approvedAssets(token)) controllerC.setApprovedAsset(token, true);
            if (!execRouterC.approvedTokens(token)) execRouterC.setApprovedToken(token, true);
        }
        ++configured;
        _recordFeed(ticker, feed);
    }

    // ─── Feeds file ─────────────────────────────────────────

    function _loadExistingFeeds(string memory path) internal {
        if (!vm.exists(path)) return;
        string memory json = vm.readFile(path);
        string[] memory keys = vm.parseJsonKeys(json, "$");
        for (uint256 i; i < keys.length; ++i) {
            address feed = vm.parseJsonAddress(json, string.concat("$.", keys[i]));
            // Launchpad entries are authoritative; the file only adds tickers.
            if (launchpadFeed[keys[i]] != address(0) || feed == address(0)) continue;
            _recordFeed(keys[i], feed);
        }
    }

    function _recordFeed(string memory ticker, address feed) internal {
        if (!hasFeedEntry[ticker]) {
            hasFeedEntry[ticker] = true;
            feedTickers.push(ticker);
        }
        feedOf[ticker] = feed;
    }

    function _exportFeeds(string memory path) internal {
        string memory out = "{}";
        for (uint256 i; i < feedTickers.length; ++i) {
            out = vm.serializeAddress("feeds", feedTickers[i], feedOf[feedTickers[i]]);
        }
        vm.writeJson(out, path);
    }
}
