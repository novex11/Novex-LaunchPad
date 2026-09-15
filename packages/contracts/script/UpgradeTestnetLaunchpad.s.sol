// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairRouter} from "../src/PairRouter.sol";
import {ComposeCurve} from "../src/ComposeCurve.sol";
import {CurveRouter} from "../src/CurveRouter.sol";

/// @title UpgradeTestnetLaunchpad — redeploy the launchpad stack on Robinhood Chain Testnet
/// @notice Deploys a new PairDeployer + PairFactory (vaults with the fee-exempt
///         recipient check), re-lists every token from the old factory, copies its
///         pool config, then deploys PairRouter, ComposeCurve and CurveRouter against
///         the new factory and marks CurveRouter fee-exempt. Oracle, emergency
///         registry, price feeds, keeper, TestUSDG and the testnet swap router are
///         reused as-is. Old pairs stay on the old factory and are not migrated.
///
///   OLD_FACTORY             live PairFactory being replaced
///   TESTNET_SWAP_ROUTER     OracleSwapRouter (config contracts.swapRouter)
///   TESTNET_USDG            TestUSDG (config contracts.usdg)
///   CURVE_START_MCAP_USD8   starting market cap for new tokens
///   CURVE_TREASURY          protocol fee recipient (defaults to deployer)
contract UpgradeTestnetLaunchpad is Script {
    function run() external {
        require(block.chainid == 46630, "UpgradeTestnetLaunchpad: wrong chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        PairFactory old = PairFactory(vm.envAddress("OLD_FACTORY"));
        address swapRouter = vm.envAddress("TESTNET_SWAP_ROUTER");
        address usdg = vm.envAddress("TESTNET_USDG");
        uint256 startMcapUsd8 = vm.envUint("CURVE_START_MCAP_USD8");
        address treasury = vm.envOr("CURVE_TREASURY", deployer);

        address oracle = address(old.oracle());
        address emergency = address(old.emergency());
        address weth = old.weth();
        address[] memory tokens = old.listedTokens();
        require(tokens.length > 0, "UpgradeTestnetLaunchpad: old factory lists no tokens");

        vm.startBroadcast(pk);

        PairDeployer pairDeployer = new PairDeployer();
        PairFactory factory = new PairFactory(deployer, oracle, emergency, weth, address(pairDeployer));
        for (uint256 i; i < tokens.length; ++i) {
            factory.setTokenListed(tokens[i], true);
        }
        if (old.poolEnabled()) {
            factory.setPoolConfig(address(old.positionManager()), address(old.permit2()), old.poolQuoteToken());
        }

        PairRouter pairRouter = new PairRouter(address(factory), swapRouter, usdg);
        ComposeCurve curve = new ComposeCurve(deployer, address(factory), treasury, startMcapUsd8);
        CurveRouter curveRouter = new CurveRouter(address(curve), address(pairRouter));
        factory.setFeeExempt(address(curveRouter), true);

        vm.stopBroadcast();

        vm.serializeUint("upgrade", "chainId", block.chainid);
        vm.serializeUint("upgrade", "startBlock", block.number);
        vm.serializeAddress("upgrade", "pairDeployer", address(pairDeployer));
        vm.serializeAddress("upgrade", "pairFactory", address(factory));
        vm.serializeAddress("upgrade", "pairRouter", address(pairRouter));
        vm.serializeAddress("upgrade", "composeCurve", address(curve));
        string memory out = vm.serializeAddress("upgrade", "curveRouter", address(curveRouter));
        vm.writeJson(out, "./deployments-launchpad-upgrade-46630.json");

        console2.log("PairDeployer:", address(pairDeployer));
        console2.log("PairFactory: ", address(factory));
        console2.log("PairRouter:  ", address(pairRouter));
        console2.log("ComposeCurve:", address(curve));
        console2.log("CurveRouter: ", address(curveRouter));
        console2.log("Listed tokens re-listed:", tokens.length);
        console2.log("Start market cap (USD8):", startMcapUsd8);
    }
}
