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
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultMixes} from "./VaultMixes.sol";

interface IUniswapV3FactoryView {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IPeripheryImmutableView {
    function factory() external view returns (address);
}

/// @title CreateMainnetVaults — one Balanced basket vault per onboarded stock
/// @notice Idempotent. For every stock in mainnet-onboard.json (category other
///         than "stable" / "crypto") with a feed on the live oracle it creates a
///         Balanced StrategyVault through the VaultFactory from deployments-
///         mainnet-baskets.json, authorizes it on the ExecutionRouter and
///         CashbackReserve, and merges vault + receipt addresses into
///         deployments-mainnet-vaults.json. Existing vaults are reused; only
///         missing authorizations are (re)applied. Every vault is created with
///         the fixed target mix from vault-mixes-4663.json (pnpm mixes:mainnet);
///         stocks without a mix are skipped. Robinhood stock tokens trade against
///         USDG on Uniswap v3, so every deposit ↔ mix-token swap is routed
///         stock → USDG → stock through each token's deepest USDG pool; routes
///         already set on the swap adapter are left alone.
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
    UniswapV3SwapAdapter adapterC;
    IUniswapV3FactoryView uniFactory;

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
        adapterC = UniswapV3SwapAdapter(swapAdapter);
        uniFactory = IUniswapV3FactoryView(IPeripheryImmutableView(swapRouter).factory());
        require(adapterC.owner() == owner, _err("launchpad owner does not own the swap adapter"));
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
        if (VaultMixes.has(mixesJson, ticker)) {
            (address[] memory mixTokens,) = VaultMixes.get(mixesJson, ticker);
            _ensureRoutes(asset, mixTokens);
        }
        _recordVault(ticker, vault, receipt);
    }

    // ─── Swap routes ────────────────────────────────────────

    function _ensureRoutes(address asset, address[] memory mixTokens) internal {
        uint24 assetFee = _deepestUsdgFee(asset);
        _ensurePath(asset, usdg, abi.encodePacked(asset, assetFee, usdg));
        _ensurePath(usdg, asset, abi.encodePacked(usdg, assetFee, asset));
        for (uint256 i; i < mixTokens.length; ++i) {
            address token = mixTokens[i];
            if (token == asset || token == usdg) continue;
            uint24 fee = _deepestUsdgFee(token);
            _ensurePath(asset, token, abi.encodePacked(asset, assetFee, usdg, fee, token));
            _ensurePath(token, asset, abi.encodePacked(token, fee, usdg, assetFee, asset));
            _ensurePath(token, usdg, abi.encodePacked(token, fee, usdg));
        }
    }

    function _ensurePath(address tokenIn, address tokenOut, bytes memory path) internal {
        if (adapterC.pairPath(keccak256(abi.encodePacked(tokenIn, tokenOut))).length != 0) return;
        adapterC.setPairPath(tokenIn, tokenOut, path);
    }

    /// @dev Fee tier of the token's USDG pool holding the most USDG.
    function _deepestUsdgFee(address token) internal view returns (uint24 best) {
        uint24[4] memory fees = [uint24(100), 500, 3000, 10000];
        uint256 depth;
        for (uint256 f; f < fees.length; ++f) {
            address pool = uniFactory.getPool(token, usdg, fees[f]);
            if (pool == address(0)) continue;
            uint256 d = IERC20(usdg).balanceOf(pool);
            if (d > depth) (depth, best) = (d, fees[f]);
        }
        require(best != 0, _err(string.concat("no Uniswap v3 USDG pool for ", vm.toString(token))));
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
