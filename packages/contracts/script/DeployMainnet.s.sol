// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";

/// @title DeployMainnet — deploys Novex protocol against real Robinhood Chain tokens
/// @notice No mocks. Token addresses are the real ERC-8056 contracts on chainId 4663
///         (mirrors `packages/config/src/tokens.ts`). USDG is the Paxos Global Dollar
///         at 6 decimals. WETH and Uniswap V3 SwapRouter02 are the canonical deployments.
///
/// Environment:
///   DEPLOYER_PRIVATE_KEY     required
///   FEED_<TICKER>            Chainlink feed per token (FEED_NVDA, FEED_USDG, ...).
///                            Required unless ALLOW_MISSING_FEEDS=true — a vault whose
///                            deposit asset or basket line has no feed reverts on use.
///   SWAP_VENUE_ROUTER        optional ISwapRouter venue (e.g. a Rialto adapter). When
///                            unset, a UniswapV3SwapAdapter over SwapRouter02 is deployed.
///   MAX_SWAP_SLIPPAGE_BPS    oracle floor for every basket swap (default 100 = 1%)
///   VAULT_TVL_CAP_USD        per-vault TVL cap in whole USD (default 1,000,000)
contract DeployMainnet is Script {
    // ─── Canonical Robinhood Chain addresses ────────────────
    address constant USDG   = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH   = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant UNI_V3 = 0xCaf681a66D020601342297493863E78C959E5cb2;

    struct TokenSpec {
        string ticker;
        address token;
        bool depositAsset;
    }

    // ─── Deployed infra (state vars to avoid stack-too-deep) ─
    OracleAdapter public oracle;
    AllocationController public controller;
    CashbackReserve public cashback;
    EmergencyRegistry public emergency;
    ExecutionRouter public router;
    VaultFactory public factory;
    PairFactory public pairFactory;
    address public swapVenue;
    address public firstVault;
    address public firstReceipt;
    uint256 public vaultsCreated;
    uint256 public feedsRegistered;

    TokenSpec[] internal tokens;

    function _tokens() internal {
        // Real ERC-8056 stock tokens on Robinhood Chain (see packages/config/src/tokens.ts).
        tokens.push(TokenSpec("NVDA",  0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC, true));
        tokens.push(TokenSpec("AAPL",  0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9, true));
        tokens.push(TokenSpec("MSFT",  0xe93237C50D904957Cf27E7B1133b510C669c2e74, true));
        tokens.push(TokenSpec("SPY",   0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, true));
        tokens.push(TokenSpec("QQQ",   0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, true));
        tokens.push(TokenSpec("GOOGL", 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3, true));
        tokens.push(TokenSpec("AMZN",  0x12f190a9F9d7D37a250758b26824B97CE941bF54, true));
        tokens.push(TokenSpec("TSLA",  0x322F0929c4625eD5bAd873c95208D54E1c003b2d, true));
        tokens.push(TokenSpec("SNDK",  0xB90A19fF0Af67f7779afF50A882A9CfF42446400, true));
        tokens.push(TokenSpec("META",  0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35, true));
        tokens.push(TokenSpec("AMD",   0x86923f96303D656E4aa86D9d42D1e57ad2023fdC, true));
        tokens.push(TokenSpec("PLTR",  0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A, true));
        tokens.push(TokenSpec("COIN",  0x6330D8C3178a418788dF01a47479c0ce7CCF450b, true));
        tokens.push(TokenSpec("SPCX",  0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa, true));
        tokens.push(TokenSpec("INTC",  0xc72b96e0E48ecd4DC75E1e45396e26300BC39681, true));
        tokens.push(TokenSpec("MU",    0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD, true));
        tokens.push(TokenSpec("ORCL",  0xb0992820E760d836549ba69BC7598b4af75dEE03, true));
        tokens.push(TokenSpec("NFLX",  0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8, true));
        // Stable sleeve: approved as a basket line, never a deposit asset.
        tokens.push(TokenSpec("USDG",  USDG, false));
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address venueOverride = vm.envOr("SWAP_VENUE_ROUTER", address(0));
        uint256 maxSlippageBps = vm.envOr("MAX_SWAP_SLIPPAGE_BPS", uint256(100));
        uint256 tvlCapUsd8 = vm.envOr("VAULT_TVL_CAP_USD", uint256(1_000_000)) * 1e8;
        bool allowMissingFeeds = vm.envOr("ALLOW_MISSING_FEEDS", false);

        _tokens();

        vm.startBroadcast(deployerPrivateKey);

        // ─── 1. Core infrastructure ────────────────────────
        oracle = new OracleAdapter(deployer);
        controller = new AllocationController(deployer);
        cashback = new CashbackReserve(deployer);
        emergency = new EmergencyRegistry(deployer);

        // ─── 2. Swap venue ─────────────────────────────────
        if (venueOverride != address(0)) {
            swapVenue = venueOverride;
        } else {
            swapVenue = address(new UniswapV3SwapAdapter(deployer, UNI_V3));
        }
        router = new ExecutionRouter(deployer, swapVenue);
        router.setEmergency(address(emergency));
        router.setOracle(address(oracle));
        router.setMaxSlippageBps(maxSlippageBps);
        if (venueOverride == address(0)) {
            UniswapV3SwapAdapter(swapVenue).setAuthorizedCaller(address(router), true);
        }

        factory = new VaultFactory(
            deployer,
            address(oracle),
            address(controller),
            address(cashback),
            address(emergency),
            address(router)
        );
        factory.setUsdStableAsset(USDG);

        // ─── 3. Launchpad ──────────────────────────────────
        // Tokens are listed with pairFactory.setTokenListed() once their feeds exist.
        pairFactory = new PairFactory(deployer, address(oracle), address(emergency), WETH);

        // ─── 4. Price feeds + asset approvals ──────────────
        for (uint256 i; i < tokens.length; ++i) {
            TokenSpec memory t = tokens[i];
            address feed = vm.envOr(string.concat("FEED_", t.ticker), address(0));
            if (feed != address(0)) {
                oracle.setPriceFeed(t.token, feed);
                feedsRegistered += 1;
            } else {
                require(allowMissingFeeds, string.concat("Missing FEED_", t.ticker, " (set ALLOW_MISSING_FEEDS=true to skip)"));
                console2.log("WARNING: no feed for", t.ticker);
            }
            controller.setApprovedAsset(t.token, true);
            router.setApprovedToken(t.token, true);
        }

        // ─── 5. One vault per deposit asset x strategy ─────
        for (uint256 i; i < tokens.length; ++i) {
            if (!tokens[i].depositAsset) continue;
            _createVaults(tokens[i], tvlCapUsd8);
        }

        vm.stopBroadcast();

        _exportDeployments();
    }

    function _createVaults(TokenSpec memory t, uint256 tvlCapUsd8) internal {
        string[3] memory suffix = ["D", "B", "A"];
        string[3] memory label = ["Defensive", "Balanced", "Aggressive"];
        for (uint256 s; s < 3; ++s) {
            (address v, ) = factory.createVault(
                t.token,
                AllocationController.Strategy(s),
                string.concat("Novex ", t.ticker, " ", label[s]),
                string.concat("t", t.ticker, "-", suffix[s]),
                tvlCapUsd8
            );
            router.setAuthorizedCaller(v, true);
            cashback.setAuthorizedVault(v, true);
            if (firstVault == address(0)) {
                firstVault = v;
                firstReceipt = address(StrategyVault(v).receiptToken());
            }
            vaultsCreated += 1;
        }
    }

    function _exportDeployments() internal {
        string memory json = "deployment";

        vm.serializeUint(json, "chainId", 4663);
        vm.serializeAddress(json, "usdg", USDG);
        vm.serializeAddress(json, "weth", WETH);
        vm.serializeAddress(json, "uniswapV3Router", UNI_V3);

        vm.serializeAddress(json, "oracle", address(oracle));
        vm.serializeAddress(json, "controller", address(controller));
        vm.serializeAddress(json, "cashback", address(cashback));
        vm.serializeAddress(json, "emergency", address(emergency));
        vm.serializeAddress(json, "executionRouter", address(router));
        vm.serializeAddress(json, "swapVenue", swapVenue);
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "pairFactory", address(pairFactory));
        vm.serializeAddress(json, "vault", firstVault);
        vm.serializeUint(json, "vaultCount", vaultsCreated);
        vm.serializeUint(json, "feedsRegistered", feedsRegistered);
        string memory output = vm.serializeAddress(json, "receiptToken", firstReceipt);
        vm.writeJson(output, "./deployments-mainnet.json");

        console2.log("=== Mainnet Deployment Complete ===");
        console2.log("Chain ID: 4663 (Robinhood Chain)");
        console2.log("OracleAdapter:", address(oracle));
        console2.log("ExecutionRouter:", address(router));
        console2.log("Swap venue:", swapVenue);
        console2.log("VaultFactory:", address(factory));
        console2.log("PairFactory:", address(pairFactory));
        console2.log("Vaults created:", vaultsCreated);
        console2.log("Feeds registered:", feedsRegistered);
        console2.log("First vault (tNVDA-D):", firstVault);
        console2.log("Addresses exported to deployments-mainnet.json");
        console2.log("");
        console2.log("Next: fund CashbackReserve, set NEXT_PUBLIC_FACTORY_ADDRESS / VAULT_FACTORY_ADDRESS");
    }
}
