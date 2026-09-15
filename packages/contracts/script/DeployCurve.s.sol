// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ComposeCurve} from "../src/ComposeCurve.sol";
import {CurveRouter} from "../src/CurveRouter.sol";
import {PairFactory} from "../src/PairFactory.sol";

/// @title DeployCurve — redeploy ComposeCurve + CurveRouter against an existing launchpad
/// @notice Reuses the live PairFactory and PairRouter; works on testnet and mainnet.
///
///   CURVE_FACTORY           live PairFactory
///   CURVE_PAIR_ROUTER       live PairRouter bound to that factory
///   CURVE_START_MCAP_USD8   starting market cap for new tokens
///   CURVE_TREASURY          protocol fee recipient (defaults to deployer)
contract DeployCurve is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address factory = vm.envAddress("CURVE_FACTORY");
        address pairRouter = vm.envAddress("CURVE_PAIR_ROUTER");
        uint256 startMcapUsd8 = vm.envUint("CURVE_START_MCAP_USD8");
        address treasury = vm.envOr("CURVE_TREASURY", deployer);

        vm.startBroadcast(pk);
        ComposeCurve curve = new ComposeCurve(deployer, factory, treasury, startMcapUsd8);
        CurveRouter curveRouter = new CurveRouter(address(curve), pairRouter);
        // Token buys deposit through CurveRouter; waive the pair creator fee on those shares.
        if (PairFactory(factory).owner() == deployer) {
            PairFactory(factory).setFeeExempt(address(curveRouter), true);
            console2.log("Fee exemption set on PairFactory for CurveRouter");
        } else {
            console2.log("SKIPPED setFeeExempt: deployer does not own the PairFactory; run it from the owner");
        }
        vm.stopBroadcast();

        vm.serializeUint("curve", "chainId", block.chainid);
        vm.serializeAddress("curve", "composeCurve", address(curve));
        string memory out = vm.serializeAddress("curve", "curveRouter", address(curveRouter));
        vm.writeJson(out, string.concat("./deployments-curve-", vm.toString(block.chainid), ".json"));

        console2.log("ComposeCurve: ", address(curve));
        console2.log("CurveRouter:", address(curveRouter));
        console2.log("Start market cap (USD8):", startMcapUsd8);
    }
}
