// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// @title MainnetScriptBase — shared plumbing for the Robinhood Chain (4663) scripts
/// @notice The launchpad (oracle, feeds, PairFactory, PairRouter, curve) is already
///         live on mainnet and owned by `owner`. Every script here reuses it: the
///         addresses come from deployments-mainnet-launchpad.json, the basket
///         stack from deployments-mainnet-baskets.json, and all transactions are
///         sent from the launchpad owner.
///
///   Inputs (env):
///     MAINNET_LAUNCHPAD_FILE   default ./deployments-mainnet-launchpad.json (read-only, authoritative)
///     MAINNET_DEPLOYMENTS_DIR  default "." — where baskets/feeds/vaults json are read and written
///     MAINNET_ONBOARD_FILE     default ./mainnet-onboard.json (scripts/fetch-mainnet-prices.ts)
///
///   Broadcaster (exactly one):
///     DEPLOYER_PRIVATE_KEY     real mainnet; must derive to the launchpad owner
///     FORK_IMPERSONATE_OWNER=1 anvil rehearsal: `vm.startBroadcast(owner)` — needs
///                              `anvil --auto-impersonate` and `forge script --unlocked
///                              --sender <owner>`; the owner must be funded on the fork.
abstract contract MainnetScriptBase is Script {
    uint256 constant CHAIN_ID = 4663;
    address constant USDG_FALLBACK = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH_FALLBACK = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    // ─── Launchpad (existing mainnet deployment) ─────────────
    address owner;
    address oracle;
    address emergency;
    address pairFactory;
    address priceFeedUpdater;
    address swapRouter;
    address usdg;
    address weth;
    string[] launchpadFeedTickers;
    mapping(string => address) launchpadFeed;

    // ─── Baskets (deployments-mainnet-baskets.json) ──────────
    bool hasBaskets;
    address allocationController;
    address cashbackReserve;
    address swapAdapter;
    address executionRouter;
    address vaultFactory;

    // ─── Onboard list (mainnet-onboard.json) ─────────────────
    string[] tickers;
    address[] tokens;
    uint256[] prices;
    string[] categories;

    function _tag() internal pure virtual returns (string memory);

    function _err(string memory msg_) internal pure returns (string memory) {
        return string.concat(_tag(), ": ", msg_);
    }

    function _deploymentsDir() internal view returns (string memory) {
        return vm.envOr("MAINNET_DEPLOYMENTS_DIR", string("."));
    }

    function _basketsPath() internal view returns (string memory) {
        return string.concat(_deploymentsDir(), "/deployments-mainnet-baskets.json");
    }

    // ─── Launchpad json ──────────────────────────────────────

    function _loadLaunchpad() internal {
        require(block.chainid == CHAIN_ID, _err("wrong chain"));
        string memory path = vm.envOr("MAINNET_LAUNCHPAD_FILE", string("./deployments-mainnet-launchpad.json"));
        require(vm.exists(path), _err(string.concat("launchpad json missing: ", path)));
        string memory json = vm.readFile(path);
        require(vm.parseJsonUint(json, ".chainId") == CHAIN_ID, _err("launchpad json is not chain 4663"));

        owner = vm.parseJsonAddress(json, ".contracts.owner");
        oracle = vm.parseJsonAddress(json, ".contracts.oracle");
        emergency = vm.parseJsonAddress(json, ".contracts.emergency");
        pairFactory = vm.parseJsonAddress(json, ".contracts.pairFactory");
        priceFeedUpdater = vm.parseJsonAddress(json, ".contracts.priceFeedUpdater");
        swapRouter = vm.parseJsonAddress(json, ".contracts.swapRouter");
        usdg = _addressOr(json, ".contracts.usdg", USDG_FALLBACK);
        weth = _addressOr(json, ".tokens.WETH", WETH_FALLBACK);
        require(owner != address(0) && oracle != address(0) && emergency != address(0), _err("launchpad json incomplete"));
        require(pairFactory != address(0) && priceFeedUpdater != address(0), _err("launchpad json incomplete"));
        require(swapRouter != address(0), _err("launchpad json has no swapRouter"));

        if (vm.keyExistsJson(json, ".feeds")) {
            string[] memory keys = vm.parseJsonKeys(json, ".feeds");
            for (uint256 i; i < keys.length; ++i) {
                address feed = vm.parseJsonAddress(json, string.concat(".feeds.", keys[i]));
                if (feed == address(0)) continue;
                launchpadFeedTickers.push(keys[i]);
                launchpadFeed[keys[i]] = feed;
            }
        }
    }

    // ─── Baskets json ────────────────────────────────────────

    /// @dev Returns false (and leaves the addresses zero) when the file is absent.
    function _loadBaskets() internal returns (bool) {
        string memory path = _basketsPath();
        if (!vm.exists(path)) return false;
        string memory json = vm.readFile(path);
        if (!vm.keyExistsJson(json, ".contracts.vaultFactory")) return false;
        allocationController = vm.parseJsonAddress(json, ".contracts.allocationController");
        cashbackReserve = vm.parseJsonAddress(json, ".contracts.cashbackReserve");
        swapAdapter = vm.parseJsonAddress(json, ".contracts.swapAdapter");
        executionRouter = vm.parseJsonAddress(json, ".contracts.executionRouter");
        vaultFactory = vm.parseJsonAddress(json, ".contracts.vaultFactory");
        hasBaskets = vaultFactory != address(0);
        return hasBaskets;
    }

    // ─── Broadcaster ─────────────────────────────────────────

    /// @dev Starts broadcasting as the launchpad owner, or reverts with the reason.
    function _startBroadcastAsOwner() internal {
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (pk != 0) {
            address deployer = vm.addr(pk);
            require(
                deployer == owner,
                _err(
                    string.concat(
                        "DEPLOYER_PRIVATE_KEY derives to ",
                        vm.toString(deployer),
                        " but the launchpad owner is ",
                        vm.toString(owner)
                    )
                )
            );
            vm.startBroadcast(pk);
            return;
        }
        require(
            vm.envOr("FORK_IMPERSONATE_OWNER", false),
            _err(
                "set DEPLOYER_PRIVATE_KEY (the launchpad owner) or, on an anvil --auto-impersonate fork, FORK_IMPERSONATE_OWNER=1 with forge --unlocked --sender <owner>"
            )
        );
        console2.log("impersonating launchpad owner on fork:", owner);
        vm.startBroadcast(owner);
    }

    // ─── Onboard list ────────────────────────────────────────

    function _loadOnboard() internal {
        string memory path = vm.envOr("MAINNET_ONBOARD_FILE", string("./mainnet-onboard.json"));
        require(vm.exists(path), _err("run scripts/fetch-mainnet-prices.ts first"));
        string memory json = vm.readFile(path);
        tickers = vm.parseJsonStringArray(json, ".tickers");
        tokens = vm.parseJsonAddressArray(json, ".addresses");
        prices = vm.parseJsonUintArray(json, ".prices");
        categories = vm.parseJsonStringArray(json, ".categories");
        require(
            tickers.length == tokens.length && tokens.length == prices.length && prices.length == categories.length,
            _err("onboard arrays mismatch")
        );
    }

    /// @dev [offset, end) window over the onboard list from <PREFIX>_OFFSET / <PREFIX>_LIMIT.
    function _window(string memory prefix) internal view returns (uint256 offset, uint256 end) {
        offset = vm.envOr(string.concat(prefix, "_OFFSET"), uint256(0));
        uint256 limit = vm.envOr(string.concat(prefix, "_LIMIT"), type(uint256).max);
        end = tokens.length;
        if (limit < tokens.length && offset + limit < tokens.length) end = offset + limit;
    }

    /// @dev Comma list from <PREFIX>_TICKERS; empty or "all" means "no filter".
    function _tickerFilter(string memory prefix) internal view returns (string[] memory only, bool filtered) {
        only = vm.envOr(string.concat(prefix, "_TICKERS"), ",", new string[](0));
        if (only.length == 1 && (_same(only[0], "all") || _same(only[0], "ALL"))) return (only, false);
        for (uint256 i; i < only.length; ++i) {
            if (bytes(only[i]).length != 0) return (only, true);
        }
        return (only, false);
    }

    // ─── Helpers ─────────────────────────────────────────────

    function _addressOr(string memory json, string memory key, address fallback_) internal view returns (address) {
        if (!vm.keyExistsJson(json, key)) return fallback_;
        address v = vm.parseJsonAddress(json, key);
        return v == address(0) ? fallback_ : v;
    }

    function _contains(string[] memory list, string memory needle) internal pure returns (bool) {
        bytes32 h = keccak256(bytes(needle));
        for (uint256 i; i < list.length; ++i) {
            if (keccak256(bytes(list[i])) == h) return true;
        }
        return false;
    }

    function _same(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
