// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairRouter} from "../src/PairRouter.sol";
import {ComposeCurve} from "../src/ComposeCurve.sol";
import {CurveRouter} from "../src/CurveRouter.sol";

/// @title UpgradeLaunchpad — redeploy the launchpad stack against the live oracle
/// @notice Works on Robinhood Chain Testnet (46630) and mainnet (4663). Deploys a
///         new PairDeployer + PairFactory (creator-only vaults with fee-exempt
///         recipients), re-lists every token from the old factory, copies its v4
///         pool config, then deploys PairRouter, ComposeCurve and CurveRouter
///         against the new factory and marks CurveRouter fee-exempt. Oracle,
///         emergency registry, price feeds, keeper, USDG and the swap router are
///         reused as-is. Old pairs stay on the old factory and are not migrated.
///
///   OLD_FACTORY             live PairFactory being replaced
///   SWAP_ROUTER             Uniswap SwapRouter02 (mainnet) / OracleSwapRouter (testnet)
///   USDG                    USDG (mainnet) / TestUSDG (testnet)
///   CURVE_START_MCAP_USD8   starting market cap for new tokens
///   CURVE_TREASURY          protocol fee recipient (defaults to deployer)
contract UpgradeLaunchpad is Script {
    struct Deployed {
        address pairDeployer;
        address pairFactory;
        address pairRouter;
        address composeCurve;
        address curveRouter;
        address swapRouter;
        address usdg;
        address owner;
        uint256 startMcapUsd8;
        uint256 tokensListed;
        bool poolCopied;
    }

    function run() external {
        require(block.chainid == 46630 || block.chainid == 4663, "UpgradeLaunchpad: unsupported chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Deployed memory d;
        d.owner = vm.addr(pk);
        d.swapRouter = vm.envAddress("SWAP_ROUTER");
        d.usdg = vm.envAddress("USDG");
        d.startMcapUsd8 = vm.envUint("CURVE_START_MCAP_USD8");
        address treasury = vm.envOr("CURVE_TREASURY", d.owner);
        PairFactory old = PairFactory(vm.envAddress("OLD_FACTORY"));

        address[] memory tokens = old.listedTokens();
        require(tokens.length > 0, "UpgradeLaunchpad: old factory lists no tokens");
        d.tokensListed = tokens.length;

        vm.startBroadcast(pk);
        PairFactory factory = _deployFactory(old, d);
        for (uint256 i; i < tokens.length; ++i) {
            factory.setTokenListed(tokens[i], true);
        }
        if (old.poolEnabled()) {
            factory.setPoolConfig(address(old.positionManager()), address(old.permit2()), old.poolQuoteToken());
            d.poolCopied = true;
        }
        PairRouter pairRouter = new PairRouter(address(factory), d.swapRouter, d.usdg);
        ComposeCurve curve = new ComposeCurve(d.owner, address(factory), treasury, d.startMcapUsd8);
        CurveRouter curveRouter = new CurveRouter(address(curve), address(pairRouter));
        factory.setFeeExempt(address(curveRouter), true);
        vm.stopBroadcast();

        d.pairRouter = address(pairRouter);
        d.composeCurve = address(curve);
        d.curveRouter = address(curveRouter);
        _write(d);
    }

    function _deployFactory(PairFactory old, Deployed memory d) internal returns (PairFactory factory) {
        PairDeployer pairDeployer = new PairDeployer();
        factory = new PairFactory(d.owner, address(old.oracle()), address(old.emergency()), old.weth(), address(pairDeployer));
        d.pairDeployer = address(pairDeployer);
        d.pairFactory = address(factory);
    }

    function _write(Deployed memory d) internal {
        vm.serializeUint("upgrade", "chainId", block.chainid);
        vm.serializeUint("upgrade", "startBlock", block.number);
        vm.serializeUint("upgrade", "curveStartMarketCapUsd8", d.startMcapUsd8);
        vm.serializeAddress("upgrade", "pairDeployer", d.pairDeployer);
        vm.serializeAddress("upgrade", "pairFactory", d.pairFactory);
        vm.serializeAddress("upgrade", "pairRouter", d.pairRouter);
        vm.serializeAddress("upgrade", "composeCurve", d.composeCurve);
        vm.serializeAddress("upgrade", "swapRouter", d.swapRouter);
        vm.serializeAddress("upgrade", "usdg", d.usdg);
        vm.serializeAddress("upgrade", "owner", d.owner);
        string memory out = vm.serializeAddress("upgrade", "curveRouter", d.curveRouter);
        vm.writeJson(out, string.concat("./deployments-launchpad-upgrade-", vm.toString(block.chainid), ".json"));

        console2.log("PairDeployer:", d.pairDeployer);
        console2.log("PairFactory: ", d.pairFactory);
        console2.log("PairRouter:  ", d.pairRouter);
        console2.log("ComposeCurve:", d.composeCurve);
        console2.log("CurveRouter: ", d.curveRouter);
        console2.log("Listed tokens re-listed:", d.tokensListed);
        console2.log("Pool config copied:", d.poolCopied);
        console2.log("Start market cap (USD8):", d.startMcapUsd8);
    }
}
