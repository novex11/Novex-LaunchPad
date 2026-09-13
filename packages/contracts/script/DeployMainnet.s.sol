// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {LaunchpadZap} from "../src/LaunchpadZap.sol";

/// @title DeployMainnet — deploys Novex protocol against real Robinhood Chain tokens
/// @notice No mocks. All token addresses are the real ERC-8056 contracts on
///         chainId 4663 fetched from the RHJ /assets API. USDG is the Paxos
///         Global Dollar at 6 decimals. WETH and Uniswap V3 SwapRouter02 are
///         the canonical deployments.
contract DeployMainnet is Script {
    // ─── Canonical Robinhood Chain addresses ────────────────
    address constant USDG   = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH   = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant UNI_V3 = 0xCaf681a66D020601342297493863E78C959E5cb2;

    // ─── Real ERC-8056 stock token addresses ────────────────
    address constant NVDA  = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant AAPL  = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address constant MSFT  = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address constant SPY   = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant QQQ   = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;
    address constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address constant AMZN  = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
    address constant TSLA  = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant SNDK  = 0xB90A19fF0Af67f7779afF50A882A9CfF42446400;

    // ─── Deployed infra (state vars to avoid stack-too-deep) ─
    OracleAdapter public oracle;
    AllocationController public controller;
    CashbackReserve public cashback;
    EmergencyRegistry public emergency;
    ExecutionRouter public router;
    VaultFactory public factory;
    PairFactory public pairFactory;
    LaunchpadZap public zap;
    address public firstVault;
    address public firstReceipt;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address rialtoRouter = vm.envOr("RIALTO_SWAP_ROUTER", address(0));
        require(rialtoRouter != address(0), "Set RIALTO_SWAP_ROUTER env var");

        vm.startBroadcast(deployerPrivateKey);

        // ─── 1. Deploy core infrastructure ─────────────────
        oracle = new OracleAdapter(msg.sender);
        controller = new AllocationController(msg.sender);
        cashback = new CashbackReserve(msg.sender);
        emergency = new EmergencyRegistry(msg.sender);
        router = new ExecutionRouter(msg.sender, rialtoRouter);

        factory = new VaultFactory(
            msg.sender,
            address(oracle),
            address(controller),
            address(cashback),
            address(emergency),
            address(router)
        );

        // ─── 2. Deploy launchpad ───────────────────────────
        pairFactory = new PairFactory(
            msg.sender,
            address(controller),
            address(oracle),
            address(router),
            address(emergency),
            USDG
        );

        zap = new LaunchpadZap(UNI_V3, WETH, USDG);

        // ─── 3. Register Chainlink price feeds ─────────────
        // NOTE: Replace these with real Chainlink feed addresses on Robinhood Chain.
        //       The deployer must call oracle.setPriceFeed(token, feed) for each token
        //       after obtaining the correct feed addresses. For now this section is
        //       a placeholder — the feeds below are zeroes and MUST be updated.
        //
        // Example (run after deployment via cast):
        //   cast send $ORACLE "setPriceFeed(address,address)" $NVDA $NVDA_FEED --private-key $KEY
        //
        // Tokens that need feeds: NVDA, AAPL, MSFT, SPY, QQQ, GOOGL, AMZN, TSLA, SNDK, USDG

        // ─── 4. Approve tokens in AllocationController ─────
        address[10] memory tokens = [NVDA, AAPL, MSFT, SPY, QQQ, GOOGL, AMZN, TSLA, SNDK, USDG];
        for (uint256 i; i < tokens.length; ++i) {
            controller.setApprovedAsset(tokens[i], true);
        }

        // ─── 5. Approve tokens in ExecutionRouter ──────────
        for (uint256 i; i < tokens.length; ++i) {
            router.setApprovedToken(tokens[i], true);
        }
        router.setEmergency(address(emergency));
        factory.setUsdStableAsset(USDG);

        // ─── 6. Create balanced StrategyVaults per equity ──
        {
            address[9] memory depositTokens = [NVDA, AAPL, MSFT, GOOGL, AMZN, TSLA, SNDK, SPY, QQQ];
            string[9] memory tickers = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "SNDK", "SPY", "QQQ"];

            for (uint256 i; i < depositTokens.length; ++i) {
                string memory symbol = string.concat("t", tickers[i], "-B");
                string memory name = string.concat("Novex ", tickers[i], " Balanced");
                (address v, ) = factory.createVault(
                    depositTokens[i],
                    AllocationController.Strategy.Balanced,
                    name,
                    symbol,
                    1_000_000e8
                );
                router.setAuthorizedCaller(v, true);
                cashback.setAuthorizedVault(v, true);
                if (i == 0) {
                    firstVault = v;
                }
            }
            firstReceipt = address(StrategyVault(firstVault).receiptToken());
        }

        // ─── 7. Transfer ExecutionRouter ownership to PairFactory
        router.transferOwnership(address(pairFactory));

        vm.stopBroadcast();

        _exportDeployments();
    }

    function _exportDeployments() internal {
        string memory json = "deployment";

        // Canonical (pre-existing)
        vm.serializeAddress(json, "usdg", USDG);
        vm.serializeAddress(json, "weth", WETH);
        vm.serializeAddress(json, "uniswapV3Router", UNI_V3);

        // Equity tokens
        vm.serializeAddress(json, "nvda", NVDA);
        vm.serializeAddress(json, "aapl", AAPL);
        vm.serializeAddress(json, "msft", MSFT);
        vm.serializeAddress(json, "spy", SPY);
        vm.serializeAddress(json, "qqq", QQQ);
        vm.serializeAddress(json, "googl", GOOGL);
        vm.serializeAddress(json, "amzn", AMZN);
        vm.serializeAddress(json, "tsla", TSLA);
        vm.serializeAddress(json, "sndk", SNDK);

        // Deployed infra
        vm.serializeAddress(json, "oracle", address(oracle));
        vm.serializeAddress(json, "controller", address(controller));
        vm.serializeAddress(json, "cashback", address(cashback));
        vm.serializeAddress(json, "emergency", address(emergency));
        vm.serializeAddress(json, "executionRouter", address(router));
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "pairFactory", address(pairFactory));
        vm.serializeAddress(json, "launchpadZap", address(zap));
        vm.serializeAddress(json, "vault", firstVault);
        string memory output = vm.serializeAddress(json, "receiptToken", firstReceipt);
        vm.writeJson(output, "./deployments-mainnet.json");

        console2.log("=== Mainnet Deployment Complete ===");
        console2.log("Chain ID: 4663 (Robinhood Chain)");
        console2.log("USDG (6 dec):", USDG);
        console2.log("WETH:", WETH);
        console2.log("Uniswap V3:", UNI_V3);
        console2.log("OracleAdapter:", address(oracle));
        console2.log("VaultFactory:", address(factory));
        console2.log("PairFactory:", address(pairFactory));
        console2.log("LaunchpadZap:", address(zap));
        console2.log("First vault (tNVDA-B):", firstVault);
        console2.log("First receipt:", firstReceipt);
        console2.log("Addresses exported to deployments-mainnet.json");
        console2.log("");
        console2.log("IMPORTANT: Register Chainlink price feeds via oracle.setPriceFeed()");
    }
}
