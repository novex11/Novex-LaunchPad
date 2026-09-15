// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {MainnetScriptBase} from "./MainnetScriptBase.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @title DeployMainnetBaskets — basket stack on top of the live Compose launchpad
/// @notice Reads the existing oracle / emergency / swap router from
///         deployments-mainnet-launchpad.json and deploys AllocationController,
///         CashbackReserve, UniswapV3SwapAdapter, ExecutionRouter and VaultFactory,
///         wired together and owned by the launchpad owner. USDG and WETH are
///         approved for baskets; stock tokens follow in OnboardMainnetTokens.
///         Writes deployments-mainnet-baskets.json.
///
///   Refuses to run when that file already names a vaultFactory unless
///   FORCE_REDEPLOY=yes (a redeploy orphans the previous stack and its vaults).
///
///   DEPLOYER_PRIVATE_KEY / FORK_IMPERSONATE_OWNER  see MainnetScriptBase
///   MAINNET_LAUNCHPAD_FILE, MAINNET_DEPLOYMENTS_DIR see MainnetScriptBase
contract DeployMainnetBaskets is MainnetScriptBase {
    AllocationController public controller;
    CashbackReserve public cashback;
    UniswapV3SwapAdapter public adapter;
    ExecutionRouter public execRouter;
    VaultFactory public factory;

    function _tag() internal pure override returns (string memory) {
        return "DeployMainnetBaskets";
    }

    function run() external {
        _loadLaunchpad();
        _guardExisting();
        require(
            OracleAdapter(oracle).owner() == owner,
            _err("launchpad json owner does not own the on-chain oracle")
        );

        _startBroadcastAsOwner();

        controller = new AllocationController(owner);
        cashback = new CashbackReserve(owner);
        // Cap every Stockback payout at its USD reward via the oracle (1% tolerance).
        cashback.setOracle(oracle, 100);
        adapter = new UniswapV3SwapAdapter(owner, swapRouter);
        execRouter = new ExecutionRouter(owner, address(adapter));
        adapter.setAuthorizedCaller(address(execRouter), true);
        factory = new VaultFactory(owner, oracle, address(controller), address(cashback), emergency, address(execRouter));
        execRouter.setEmergency(emergency);
        factory.setUsdStableAsset(usdg);
        controller.setApprovedAsset(usdg, true);
        execRouter.setApprovedToken(usdg, true);
        controller.setApprovedAsset(weth, true);
        execRouter.setApprovedToken(weth, true);

        vm.stopBroadcast();

        _export();
    }

    function _guardExisting() internal {
        if (_loadBaskets() && !_same(vm.envOr("FORCE_REDEPLOY", string("")), "yes")) {
            revert(
                _err(
                    string.concat(
                        "baskets already deployed (vaultFactory ",
                        vm.toString(vaultFactory),
                        " in ",
                        _basketsPath(),
                        "); set FORCE_REDEPLOY=yes to deploy a new stack"
                    )
                )
            );
        }
    }

    function _export() internal {
        vm.serializeAddress("contracts", "allocationController", address(controller));
        vm.serializeAddress("contracts", "cashbackReserve", address(cashback));
        vm.serializeAddress("contracts", "swapAdapter", address(adapter));
        vm.serializeAddress("contracts", "executionRouter", address(execRouter));
        vm.serializeAddress("contracts", "vaultFactory", address(factory));
        string memory contractsJson = vm.serializeAddress("contracts", "owner", owner);

        vm.serializeUint("root", "chainId", block.chainid);
        vm.serializeAddress("root", "oracle", oracle);
        vm.serializeAddress("root", "emergency", emergency);
        vm.serializeAddress("root", "swapRouter", swapRouter);
        string memory out = vm.serializeString("root", "contracts", contractsJson);
        vm.writeJson(out, _basketsPath());

        console2.log("AllocationController:", address(controller));
        console2.log("CashbackReserve:     ", address(cashback));
        console2.log("UniswapV3SwapAdapter:", address(adapter));
        console2.log("ExecutionRouter:     ", address(execRouter));
        console2.log("VaultFactory:        ", address(factory));
        console2.log("wrote", _basketsPath());
    }
}
