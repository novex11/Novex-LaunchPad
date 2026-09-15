// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {MainnetScriptBase} from "./MainnetScriptBase.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {VaultMixes} from "./VaultMixes.sol";

/// @title CreateMainnetVaults — one Balanced basket vault per onboarded stock
/// @notice Idempotent. For every stock in mainnet-onboard.json (category other
///         than "stable" / "crypto") with a feed on the live oracle it creates a
///         Balanced StrategyVault through the VaultFactory from deployments-
///         mainnet-baskets.json, authorizes it on the ExecutionRouter and
///         CashbackReserve, and merges vault + receipt addresses into
///         deployments-mainnet-vaults.json. Existing vaults are reused; only
///         missing authorizations are (re)applied. Every vault is created with
///         the fixed target mix from vault-mixes-4663.json (pnpm mixes:mainnet);
///         stocks without a mix are skipped.
///
///   DEPLOYER_PRIVATE_KEY / FORK_IMPERSONATE_OWNER  see MainnetScriptBase (owner-gated)
///   VAULT_TICKERS                optional comma list restricting the run
///   VAULT_OFFSET / VAULT_LIMIT   optional batching window over the onboard list
///   MAINNET_ONBOARD_FILE, MAINNET_LAUNCHPAD_FILE, MAINNET_DEPLOYMENTS_DIR  see MainnetScriptBase
contract CreateMainnetVaults is MainnetScriptBase {
    uint256 constant TVL_CAP_USD8 = 1_000_000e8;

    OracleAdapter oracleC;
    VaultFactory factoryC;
    ExecutionRouter execRouterC;
    CashbackReserve cashbackC;

    string[] vaultTickers;
    mapping(string => address) vaultOf;
    mapping(string => address) receiptOf;
    mapping(string => bool) hasVaultEntry;

    string mixesJson;

    uint256 created;
    uint256 existing;
    uint256 skippedNoFeed;
    uint256 skippedNoMix;

    function _tag() internal pure override returns (string memory) {
        return "CreateMainnetVaults";
    }

    function run() external {
        _loadLaunchpad();
        require(_loadBaskets(), _err("deployments-mainnet-baskets.json missing (run DeployMainnetBaskets first)"));
        oracleC = OracleAdapter(oracle);
        factoryC = VaultFactory(vaultFactory);
        execRouterC = ExecutionRouter(executionRouter);
        cashbackC = CashbackReserve(cashbackReserve);
        require(factoryC.owner() == owner, _err("launchpad owner does not own the VaultFactory"));
        require(address(factoryC.oracle()) == oracle, _err("VaultFactory oracle differs from the launchpad oracle"));

        _loadOnboard();
        mixesJson = VaultMixes.load(CHAIN_ID);
        string memory vaultsPath = string.concat(_deploymentsDir(), "/deployments-mainnet-vaults.json");
        _loadExistingVaults(vaultsPath);

        (string[] memory only, bool filtered) = _tickerFilter("VAULT");
        (uint256 offset, uint256 end) = _window("VAULT");

        _startBroadcastAsOwner();
        for (uint256 i = offset; i < end; ++i) {
            if (!_isStock(categories[i])) continue;
            if (filtered && !_contains(only, tickers[i])) continue;
            _ensureVault(tickers[i], tokens[i]);
        }
        vm.stopBroadcast();

        _exportVaults(vaultsPath);

        console2.log("vaults created:", created);
        console2.log("vaults already on-chain:", existing);
        console2.log("skipped (no price feed):", skippedNoFeed);
        console2.log("skipped (no target mix):", skippedNoMix);
        console2.log("vaults in file:", vaultTickers.length);
    }

    function _ensureVault(string memory ticker, address asset) internal {
        if (!oracleC.hasFeed(asset)) {
            console2.log("skip (no feed):", ticker);
            ++skippedNoFeed;
            return;
        }
        AllocationController.Strategy strategy = AllocationController.Strategy.Balanced;
        address vault = factoryC.vaultByKey(keccak256(abi.encode(asset, strategy)));
        address receipt;
        if (vault == address(0)) {
            if (!VaultMixes.has(mixesJson, ticker)) {
                console2.log("skip (no target mix):", ticker);
                ++skippedNoMix;
                return;
            }
            (address[] memory mixTokens, uint256[] memory mixWeights) = VaultMixes.get(mixesJson, ticker);
            (vault, receipt) = factoryC.createVault(
                VaultFactory.CreateParams({
                    depositAsset: asset,
                    strategy: strategy,
                    receiptName: string.concat("Compose ", ticker, " Balanced"),
                    receiptSymbol: string.concat("t", ticker, "-B"),
                    tvlCapUsd8: TVL_CAP_USD8,
                    targetTokens: mixTokens,
                    targetWeightsBps: mixWeights
                })
            );
            ++created;
        } else {
            receipt = address(StrategyVault(vault).receiptToken());
            ++existing;
        }
        if (!execRouterC.authorizedCallers(vault)) execRouterC.setAuthorizedCaller(vault, true);
        if (!cashbackC.authorizedVaults(vault)) cashbackC.setAuthorizedVault(vault, true);
        _recordVault(ticker, vault, receipt);
    }

    // ─── Vaults file ────────────────────────────────────────

    function _loadExistingVaults(string memory path) internal {
        if (!vm.exists(path)) return;
        string memory json = vm.readFile(path);
        string[] memory keys = vm.parseJsonKeys(json, "$");
        for (uint256 i; i < keys.length; ++i) {
            _recordVault(
                keys[i],
                vm.parseJsonAddress(json, string.concat("$.", keys[i], ".vault")),
                vm.parseJsonAddress(json, string.concat("$.", keys[i], ".receipt"))
            );
        }
    }

    function _recordVault(string memory ticker, address vault, address receipt) internal {
        if (!hasVaultEntry[ticker]) {
            hasVaultEntry[ticker] = true;
            vaultTickers.push(ticker);
        }
        vaultOf[ticker] = vault;
        receiptOf[ticker] = receipt;
    }

    function _exportVaults(string memory path) internal {
        string memory out = "{}";
        for (uint256 i; i < vaultTickers.length; ++i) {
            string memory ticker = vaultTickers[i];
            string memory objKey = string.concat("vault:", ticker);
            vm.serializeAddress(objKey, "vault", vaultOf[ticker]);
            string memory obj = vm.serializeAddress(objKey, "receipt", receiptOf[ticker]);
            out = vm.serializeString("vaults", ticker, obj);
        }
        vm.writeJson(out, path);
    }

    function _isStock(string memory category) internal pure returns (bool) {
        return !_same(category, "stable") && !_same(category, "crypto");
    }
}
