// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {MockPermit2, MockV4PositionManager} from "../src/mocks/MockV4.sol";

/// @title EnableTestnetPool — turn on launch-time Uniswap v4 pool seeding on testnet
/// @notice Robinhood Chain testnet has the canonical Uniswap v4 deployment
///         (same addresses as mainnet), so by default this points the
///         PairFactory at the real PositionManager + Permit2 with TestUSDG as
///         the quote asset. Set USE_MOCK_V4=true to deploy the mocks instead
///         (useful when the v4 pools would be noise). On mainnet run
///         RegisterFeeds.s.sol with UNISWAP_V4_POSITION_MANAGER instead.
///
///   TESTNET_PAIR_FACTORY  factory deployed by DeployTestnetRouter
///   TESTNET_USDG          TestUSDG address (must have a price feed)
///   USE_MOCK_V4           optional; "true" deploys MockPermit2 + MockV4PositionManager
contract EnableTestnetPool is Script {
    address constant V4_POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    function run() external {
        require(block.chainid == 46630, "EnableTestnetPool: wrong chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        PairFactory factory = PairFactory(vm.envAddress("TESTNET_PAIR_FACTORY"));
        address usdg = vm.envAddress("TESTNET_USDG");
        bool useMock = vm.envOr("USE_MOCK_V4", false);

        vm.startBroadcast(pk);
        address pm = V4_POSITION_MANAGER;
        address permit2 = PERMIT2;
        if (useMock) {
            MockPermit2 mockPermit2 = new MockPermit2();
            pm = address(new MockV4PositionManager(mockPermit2));
            permit2 = address(mockPermit2);
        } else {
            require(V4_POSITION_MANAGER.code.length > 0 && PERMIT2.code.length > 0, "EnableTestnetPool: v4 missing");
        }
        factory.setPoolConfig(pm, permit2, usdg);
        vm.stopBroadcast();

        console2.log(useMock ? "MockV4PositionManager:" : "Uniswap v4 PositionManager:", pm);
        console2.log("Permit2:", permit2);
        console2.log("Pool quote token:", usdg);
    }
}
