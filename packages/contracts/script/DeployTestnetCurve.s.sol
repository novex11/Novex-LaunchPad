// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairRouter} from "../src/PairRouter.sol";
import {ComposeCurve} from "../src/ComposeCurve.sol";
import {CurveRouter} from "../src/CurveRouter.sol";

/// @title DeployTestnetCurve — bonding-curve launchpad on Robinhood Chain Testnet
/// @notice Creator tokens need transferable pair shares, so this deploys a fresh
///         PairFactory (PairShareToken) and a PairRouter bound to it, then
///         ComposeCurve and CurveRouter. Reuses the live oracle, feeds, keeper,
///         testnet swap router and TestUSDG.
///
///   TESTNET_ORACLE, TESTNET_EMERGENCY, TESTNET_SWAP_ROUTER, TESTNET_USDG
///   CURVE_TREASURY          protocol fee recipient (defaults to deployer)
///   CURVE_START_MCAP_USD8   starting market cap (default $50 so testnet graduation is reachable)
contract DeployTestnetCurve is Script {
    address constant WETH = 0x7943e237c7F95DA44E0301572D358911207852Fa;
    address constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;
    address constant AMZN = 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02;
    address constant AMD = 0x71178BAc73cBeb415514eB542a8995b82669778d;
    address constant PLTR = 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0;
    address constant NFLX = 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93;

    PairFactory public factory;
    PairRouter public router;
    ComposeCurve public curve;
    CurveRouter public curveRouter;

    function run() external {
        require(block.chainid == 46630, "DeployTestnetCurve: wrong chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address oracle = vm.envAddress("TESTNET_ORACLE");
        address emergency = vm.envAddress("TESTNET_EMERGENCY");
        address swapRouter = vm.envAddress("TESTNET_SWAP_ROUTER");
        address usdg = vm.envAddress("TESTNET_USDG");
        address treasury = vm.envOr("CURVE_TREASURY", deployer);
        uint256 startMcapUsd8 = vm.envOr("CURVE_START_MCAP_USD8", uint256(50e8));

        address[6] memory listed = [TSLA, AMZN, AMD, PLTR, NFLX, WETH];

        vm.startBroadcast(pk);
        factory = new PairFactory(deployer, oracle, emergency, WETH, address(new PairDeployer()));
        for (uint256 i; i < listed.length; ++i) {
            factory.setTokenListed(listed[i], true);
        }
        router = new PairRouter(address(factory), swapRouter, usdg);
        curve = new ComposeCurve(deployer, address(factory), treasury, startMcapUsd8);
        curveRouter = new CurveRouter(address(curve), address(router));
        vm.stopBroadcast();

        vm.serializeAddress("curve", "pairFactory", address(factory));
        vm.serializeAddress("curve", "pairRouter", address(router));
        vm.serializeAddress("curve", "composeCurve", address(curve));
        string memory out = vm.serializeAddress("curve", "curveRouter", address(curveRouter));
        vm.writeJson(out, "./deployments-testnet-curve.json");

        console2.log("PairFactory:", address(factory));
        console2.log("PairRouter:", address(router));
        console2.log("ComposeCurve:", address(curve));
        console2.log("CurveRouter:", address(curveRouter));
        console2.log("Start market cap (USD8):", startMcapUsd8);
    }
}
