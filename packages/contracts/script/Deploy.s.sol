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
import {LaunchpadZap} from "../src/LaunchpadZap.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";
import {MockUniswapV3Router} from "../src/mocks/MockUniswapV3Router.sol";
import {MockWRHT} from "../src/mocks/MockWRHT.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";

contract Deploy is Script {
    // Equity mock tokens
    MockERC20 public nvda;
    MockERC20 public aapl;
    MockERC20 public msft;
    MockERC20 public spy;
    MockERC20 public qqq;
    MockERC20 public googl;
    MockERC20 public amzn;
    MockERC20 public tsla;
    MockERC20 public sndk;
    MockERC20 public usdg;

    // Forex mock tokens
    MockERC20 public eurusd;
    MockERC20 public gbpusd;
    MockERC20 public audusd;
    MockERC20 public nzdusd;
    MockERC20 public usdcad;
    MockERC20 public usdchf;

    // Infra (kept as state to avoid stack-too-deep in run())
    OracleAdapter public oracle;
    AllocationController public controller;
    CashbackReserve public cashback;
    EmergencyRegistry public emergency;
    MockSwapRouter public mockRouter;
    ExecutionRouter public router;
    VaultFactory public factory;
    PairFactory public pairFactory;
    MockUniswapV3Router public v3;
    MockWRHT public wrht;
    LaunchpadZap public zap;
    address public vault;
    address public receipt;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // ─── 1. Deploy equity mock tokens ──────────────────
        nvda = new MockERC20("NVIDIA", "NVDA");
        aapl = new MockERC20("Apple", "AAPL");
        msft = new MockERC20("Microsoft", "MSFT");
        spy = new MockERC20("SPDR S&P 500", "SPY");
        qqq = new MockERC20("Invesco QQQ", "QQQ");
        googl = new MockERC20("Alphabet", "GOOGL");
        amzn = new MockERC20("Amazon", "AMZN");
        tsla = new MockERC20("Tesla", "TSLA");
        sndk = new MockERC20("SanDisk", "SNDK");
        usdg = new MockERC20("USD Stable Reserve", "USDG");

        // ─── 2. Deploy forex mock tokens ───────────────────
        eurusd = new MockERC20("Euro / US Dollar", "EURUSD");
        gbpusd = new MockERC20("British Pound / US Dollar", "GBPUSD");
        audusd = new MockERC20("Australian Dollar / US Dollar", "AUDUSD");
        nzdusd = new MockERC20("New Zealand Dollar / US Dollar", "NZDUSD");
        usdcad = new MockERC20("US Dollar / Canadian Dollar", "USDCAD");
        usdchf = new MockERC20("US Dollar / Swiss Franc", "USDCHF");

        // All tokens (16 total: 10 equity + 6 forex)
        address[] memory tokens = new address[](16);
        tokens[0] = address(nvda);
        tokens[1] = address(aapl);
        tokens[2] = address(msft);
        tokens[3] = address(spy);
        tokens[4] = address(qqq);
        tokens[5] = address(googl);
        tokens[6] = address(amzn);
        tokens[7] = address(tsla);
        tokens[8] = address(sndk);
        tokens[9] = address(usdg);
        tokens[10] = address(eurusd);
        tokens[11] = address(gbpusd);
        tokens[12] = address(audusd);
        tokens[13] = address(nzdusd);
        tokens[14] = address(usdcad);
        tokens[15] = address(usdchf);

        // ─── 3. Deploy mock oracles ────────────────────────
        int256[] memory prices = new int256[](16);
        // Equities
        prices[0] = 135e8;      // NVDA  $135
        prices[1] = 200e8;      // AAPL  $200
        prices[2] = 400e8;      // MSFT  $400
        prices[3] = 530e8;      // SPY   $530
        prices[4] = 490e8;      // QQQ   $490
        prices[5] = 180e8;      // GOOGL $180
        prices[6] = 200e8;      // AMZN  $200
        prices[7] = 250e8;      // TSLA  $250
        prices[8] = 100e8;      // SNDK  $100
        prices[9] = 1e8;        // USDG  $1
        // Forex (USD price per 1 token)
        prices[10] = 108500000; // EURUSD $1.085
        prices[11] = 127000000; // GBPUSD $1.270
        prices[12] = 64000000;  // AUDUSD $0.640
        prices[13] = 59000000;  // NZDUSD $0.590
        prices[14] = 135000000; // USDCAD $1.350
        prices[15] = 88000000;  // USDCHF $0.880

        address[] memory feeds = new address[](16);
        for (uint256 i; i < 16; ++i) {
            feeds[i] = address(new MockOracle(prices[i]));
        }

        // ─── 4. Deploy core infrastructure ─────────────────
        oracle = new OracleAdapter(msg.sender);
        controller = new AllocationController(msg.sender);
        cashback = new CashbackReserve(msg.sender);
        emergency = new EmergencyRegistry(msg.sender);
        mockRouter = new MockSwapRouter();
        router = new ExecutionRouter(msg.sender, address(mockRouter));

        factory = new VaultFactory(
            msg.sender,
            address(oracle),
            address(controller),
            address(cashback),
            address(emergency),
            address(router)
        );

        // Pair launchpad factory — permissionless 2-token pair vaults
        pairFactory = new PairFactory(
            msg.sender,
            address(controller),
            address(oracle),
            address(router),
            address(emergency),
            address(usdg)
        );

        // ─── 5. Register all price feeds ───────────────────
        for (uint256 i; i < 16; ++i) {
            oracle.setPriceFeed(tokens[i], feeds[i]);
        }

        // ─── 6. Approve all assets in AllocationController ─
        for (uint256 i; i < 16; ++i) {
            controller.setApprovedAsset(tokens[i], true);
        }

        // ─── 7. Approve all tokens in ExecutionRouter ──────
        for (uint256 i; i < 16; ++i) {
            router.setApprovedToken(tokens[i], true);
        }

        router.setEmergency(address(emergency));

        factory.setUsdStableAsset(address(usdg));

        // ─── 8. Create balanced vaults per deposit asset (t{TICKER}-B) ─
        {
            address[] memory depositTokens = new address[](9);
            depositTokens[0] = address(nvda);
            depositTokens[1] = address(aapl);
            depositTokens[2] = address(msft);
            depositTokens[3] = address(googl);
            depositTokens[4] = address(amzn);
            depositTokens[5] = address(tsla);
            depositTokens[6] = address(sndk);
            depositTokens[7] = address(spy);
            depositTokens[8] = address(qqq);

            string[] memory tickers = new string[](9);
            tickers[0] = "NVDA";
            tickers[1] = "AAPL";
            tickers[2] = "MSFT";
            tickers[3] = "GOOGL";
            tickers[4] = "AMZN";
            tickers[5] = "TSLA";
            tickers[6] = "SNDK";
            tickers[7] = "SPY";
            tickers[8] = "QQQ";

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
                    vault = v;
                }
            }
            receipt = address(StrategyVault(vault).receiptToken());
        }

        // ─── 9. Authorizations set in vault loop above ─────

        // ─── 10. Fund MockSwapRouter with all tokens ───────
        uint256 fundAmount = 500_000 ether;
        for (uint256 i; i < 16; ++i) {
            MockERC20(tokens[i]).transfer(address(mockRouter), fundAmount);
        }

        // ─── 11. Fund CashbackReserve ──────────────────────
        uint256 cashbackFund = 10_000 ether;
        nvda.approve(address(cashback), cashbackFund);
        cashback.fund(address(nvda), cashbackFund);

        // ─── 12. Deploy Uniswap-v3 mock + WRHT wrapper + LaunchpadZap ──
        // On mainnet these come from the Robinhood-Chain Uniswap v3 deployment
        // and the canonical WRHT contract. On testnet / local we deploy mocks
        // priced by the OracleAdapter so the launchpad flow is exercisable
        // end-to-end without external DEX liquidity.
        v3 = new MockUniswapV3Router(address(oracle));
        wrht = new MockWRHT();
        // Register WRHT with the oracle (needed for native-RHT seeding)
        oracle.setPriceFeed(address(wrht), address(new MockOracle(3_000e8)));
        // Fund the v3 router with USDG so it can pay out on swaps
        usdg.transfer(address(v3), 200_000 ether);

        zap = new LaunchpadZap(address(v3), address(wrht), address(usdg));

        // ─── 13. Transfer ExecutionRouter ownership to PairFactory ─
        // Allows the launchpad factory to auto-authorize newly launched
        // PairVaults with the router (permissionless launches). The
        // primary strategy vaults were already authorized in step 8.
        router.transferOwnership(address(pairFactory));

        vm.stopBroadcast();

        _exportDeployments();
    }

    function _exportDeployments() internal {
        string memory json = "deployment";
        _serializeEquities(json);
        _serializeForex(json);
        _serializeInfra(json);
        vm.serializeAddress(json, "vault", vault);
        string memory output = vm.serializeAddress(json, "receiptToken", receipt);
        vm.writeJson(output, "./deployments.json");

        console2.log("=== Deployment Complete ===");
        console2.log("Primary vault (tNVDA-B):", vault);
        console2.log("Receipt Token:", receipt);
        console2.log("Factory:", address(factory));
        console2.log("PairFactory (launchpad):", address(pairFactory));
        console2.log("LaunchpadZap:", address(zap));
        console2.log("WRHT:", address(wrht));
        console2.log("Uniswap v3 (mock):", address(v3));
        console2.log("Equity tokens: 10, Forex tokens: 6");
        console2.log("Addresses exported to deployments.json");
    }

    function _serializeEquities(string memory json) internal {
        vm.serializeAddress(json, "nvda", address(nvda));
        vm.serializeAddress(json, "aapl", address(aapl));
        vm.serializeAddress(json, "msft", address(msft));
        vm.serializeAddress(json, "spy", address(spy));
        vm.serializeAddress(json, "qqq", address(qqq));
        vm.serializeAddress(json, "googl", address(googl));
        vm.serializeAddress(json, "amzn", address(amzn));
        vm.serializeAddress(json, "tsla", address(tsla));
        vm.serializeAddress(json, "sndk", address(sndk));
        vm.serializeAddress(json, "usdg", address(usdg));
    }

    function _serializeForex(string memory json) internal {
        vm.serializeAddress(json, "eurusd", address(eurusd));
        vm.serializeAddress(json, "gbpusd", address(gbpusd));
        vm.serializeAddress(json, "audusd", address(audusd));
        vm.serializeAddress(json, "nzdusd", address(nzdusd));
        vm.serializeAddress(json, "usdcad", address(usdcad));
        vm.serializeAddress(json, "usdchf", address(usdchf));
    }

    function _serializeInfra(string memory json) internal {
        vm.serializeAddress(json, "oracle", address(oracle));
        vm.serializeAddress(json, "controller", address(controller));
        vm.serializeAddress(json, "cashback", address(cashback));
        vm.serializeAddress(json, "emergency", address(emergency));
        vm.serializeAddress(json, "mockRouter", address(mockRouter));
        vm.serializeAddress(json, "executionRouter", address(router));
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "pairFactory", address(pairFactory));
        vm.serializeAddress(json, "launchpadZap", address(zap));
        vm.serializeAddress(json, "wrht", address(wrht));
        vm.serializeAddress(json, "uniswapV3Router", address(v3));
    }
}
