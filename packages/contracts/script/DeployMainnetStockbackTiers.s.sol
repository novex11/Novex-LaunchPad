// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {MainnetScriptBase} from "./MainnetScriptBase.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @title DeployMainnetStockbackTiers — tiered CashbackReserve + VaultFactory
/// @notice The first mainnet CashbackReserve paid one flat reward to every vault and
///         VaultFactory wires each vault to a fixed reserve, so per-strategy Stockback
///         needs a new reserve and a new factory. Everything else in
///         deployments-mainnet-baskets.json (AllocationController, ExecutionRouter,
///         UniswapV3SwapAdapter) is reused. The previous factory and reserve are kept
///         under "retired" so their vaults can be wound down and inventory withdrawn.
///         Run CreateMainnetVaults afterwards to create vaults on the new factory.
///
///   Idempotent: exits without broadcasting when the recorded reserve is already tiered.
///   DEPLOYER_PRIVATE_KEY / FORK_IMPERSONATE_OWNER  see MainnetScriptBase
contract DeployMainnetStockbackTiers is MainnetScriptBase {
    function _tag() internal pure override returns (string memory) {
        return "DeployMainnetStockbackTiers";
    }

    function run() external {
        _loadLaunchpad();
        require(_loadBaskets(), _err("deployments-mainnet-baskets.json missing (run DeployMainnetBaskets first)"));
        if (_isTiered(cashbackReserve)) {
            console2.log("reserve already tiered, nothing to do:", cashbackReserve);
            return;
        }
        require(VaultFactory(vaultFactory).owner() == owner, _err("launchpad owner does not own the VaultFactory"));

        address retiredFactory = vaultFactory;
        address retiredReserve = cashbackReserve;

        _startBroadcastAsOwner();
        CashbackReserve reserve = new CashbackReserve(owner);
        // Cap every Stockback payout at its USD reward via the oracle (1% tolerance).
        reserve.setOracle(oracle, 100);
        VaultFactory factory =
            new VaultFactory(owner, oracle, allocationController, address(reserve), emergency, executionRouter);
        factory.setUsdStableAsset(usdg);
        vm.stopBroadcast();

        _export(address(reserve), address(factory), retiredReserve, retiredFactory);
        console2.log("CashbackReserve (tiered):", address(reserve));
        console2.log("VaultFactory:            ", address(factory));
        console2.log("retired reserve:         ", retiredReserve);
        console2.log("retired factory:         ", retiredFactory);
    }

    function _isTiered(address reserve) internal view returns (bool) {
        (bool ok, bytes memory ret) = reserve.staticcall(
            abi.encodeCall(CashbackReserve.rewardUsd8For, (AllocationController.Strategy.Balanced))
        );
        return ok && ret.length == 32;
    }

    function _export(address reserve, address factory, address retiredReserve, address retiredFactory) internal {
        vm.serializeAddress("contracts", "allocationController", allocationController);
        vm.serializeAddress("contracts", "cashbackReserve", reserve);
        vm.serializeAddress("contracts", "swapAdapter", swapAdapter);
        vm.serializeAddress("contracts", "executionRouter", executionRouter);
        vm.serializeAddress("contracts", "vaultFactory", factory);
        string memory contractsJson = vm.serializeAddress("contracts", "owner", owner);

        vm.serializeAddress("retired", "cashbackReserve", retiredReserve);
        string memory retiredJson = vm.serializeAddress("retired", "vaultFactory", retiredFactory);

        vm.serializeUint("root", "chainId", block.chainid);
        vm.serializeAddress("root", "oracle", oracle);
        vm.serializeAddress("root", "emergency", emergency);
        vm.serializeAddress("root", "swapRouter", swapRouter);
        vm.serializeString("root", "retired", retiredJson);
        string memory out = vm.serializeString("root", "contracts", contractsJson);
        vm.writeJson(out, _basketsPath());
    }
}
