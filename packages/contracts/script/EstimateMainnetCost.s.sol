// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PriceFeedUpdater} from "../src/PriceFeedUpdater.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairRouter} from "../src/PairRouter.sol";
import {ComposeCurve} from "../src/ComposeCurve.sol";
import {CurveRouter} from "../src/CurveRouter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @title EstimateMainnetCost — full Compose stack as it would be deployed on mainnet
/// @notice Run against an anvil fork of Robinhood Chain mainnet to measure the gas of
///         every deployment and configuration transaction. Not for real broadcasts.
contract EstimateMainnetCost is Script {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant UNI_V3_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
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

    OracleAdapter oracle;
    EmergencyRegistry emergency;
    PriceFeedUpdater updater;
    PairFactory factory;
    AllocationController controller;
    CashbackReserve cashback;
    ExecutionRouter execRouter;
    VaultFactory vaultFactory;

    function run() external {
        uint256 pk = vm.envUint("ESTIMATE_PRIVATE_KEY");
        address owner = vm.addr(pk);
        address[9] memory stocks = [NVDA, AAPL, MSFT, SPY, QQQ, GOOGL, AMZN, TSLA, SNDK];

        vm.startBroadcast(pk);

        // ─── Launchpad core ────────────────────────────────
        oracle = new OracleAdapter(owner);
        emergency = new EmergencyRegistry(owner);
        updater = new PriceFeedUpdater(owner);
        updater.setKeeper(owner, true);
        for (uint256 i; i < stocks.length; ++i) {
            oracle.setPriceFeed(stocks[i], address(new PushPriceFeed(owner, address(updater), "STOCK / USD", 100e8)));
        }
        oracle.setPriceFeed(WETH, address(new PushPriceFeed(owner, address(updater), "ETH / USD", 2_500e8)));
        oracle.setPriceFeed(USDG, address(new PushPriceFeed(owner, address(updater), "USDG / USD", 1e8)));

        factory = new PairFactory(owner, address(oracle), address(emergency), WETH, address(new PairDeployer()));
        for (uint256 i; i < stocks.length; ++i) {
            factory.setTokenListed(stocks[i], true);
        }
        factory.setTokenListed(WETH, true);
        factory.setPoolConfig(V4_POSITION_MANAGER, PERMIT2, USDG);

        PairRouter pairRouter = new PairRouter(address(factory), UNI_V3_ROUTER, USDG);
        ComposeCurve curve = new ComposeCurve(owner, address(factory), owner, 3_450e8);
        new CurveRouter(address(curve), address(pairRouter));

        // ─── Basket protocol ───────────────────────────────
        controller = new AllocationController(owner);
        cashback = new CashbackReserve(owner);
        execRouter = new ExecutionRouter(owner, UNI_V3_ROUTER);
        vaultFactory = new VaultFactory(
            owner,
            address(oracle),
            address(controller),
            address(cashback),
            address(emergency),
            address(execRouter)
        );
        for (uint256 i; i < stocks.length; ++i) {
            controller.setApprovedAsset(stocks[i], true);
            execRouter.setApprovedToken(stocks[i], true);
        }
        controller.setApprovedAsset(USDG, true);
        execRouter.setApprovedToken(USDG, true);
        execRouter.setEmergency(address(emergency));
        vaultFactory.setUsdStableAsset(USDG);
        // Representative 5-line mix (20% each) so the estimate covers setTargetMix.
        for (uint256 i; i < stocks.length; ++i) {
            address[] memory mixTokens = new address[](5);
            uint256[] memory mixWeights = new uint256[](5);
            for (uint256 j; j < 5; ++j) {
                mixTokens[j] = stocks[(i + j) % stocks.length];
                mixWeights[j] = 2000;
            }
            (address v, ) = vaultFactory.createVault(
                VaultFactory.CreateParams({
                    depositAsset: stocks[i],
                    strategy: AllocationController.Strategy.Balanced,
                    receiptName: "Compose Balanced Basket",
                    receiptSymbol: "tSTK-B",
                    tvlCapUsd8: 1_000_000e8,
                    targetTokens: mixTokens,
                    targetWeightsBps: mixWeights
                })
            );
            execRouter.setAuthorizedCaller(v, true);
            cashback.setAuthorizedVault(v, true);
        }

        vm.stopBroadcast();
    }
}
