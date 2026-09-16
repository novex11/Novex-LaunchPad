// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console2} from "forge-std/Script.sol";
import {MainnetScriptBase} from "./MainnetScriptBase.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @title DeployMainnetStockbackVesting — vesting CashbackReserve + VaultFactory
/// @notice Replaces the flat per-strategy Stockback with a percentage reward (1% of the
///         deposit, capped $10 per deposit and $25 per wallet) that vests for 7 days and
///         is forfeited if the shares are redeemed first. Vaults call the reserve with a
///         new interface, so this needs a new reserve and a new factory; the
///         AllocationController, ExecutionRouter and UniswapV3SwapAdapter are reused.
///         The replaced factory and reserve move to "retired" (the pair before them is
///         kept as "retiredV1") so their vaults can be wound down and inventory moved.
///         Run CreateMainnetVaults afterwards to create vaults on the new factory.
///
///   Idempotent: exits without broadcasting when the recorded reserve already vests.
///   DEPLOYER_PRIVATE_KEY / FORK_IMPERSONATE_OWNER  see MainnetScriptBase
contract DeployMainnetStockbackVesting is MainnetScriptBase {
    function _tag() internal pure override returns (string memory) {
        return "DeployMainnetStockbackVesting";
    }

    function run() external {
        _loadLaunchpad();
        require(_loadBaskets(), _err("deployments-mainnet-baskets.json missing (run DeployMainnetBaskets first)"));
        if (_isVesting(cashbackReserve)) {
            console2.log("reserve already vesting, nothing to do:", cashbackReserve);
            return;
        }
        require(VaultFactory(vaultFactory).owner() == owner, _err("launchpad owner does not own the VaultFactory"));

        address retiredFactory = vaultFactory;
        address retiredReserve = cashbackReserve;

        _startBroadcastAsOwner();
        CashbackReserve reserve = new CashbackReserve(owner);
        // Cap every grant at its USD reward via the oracle (1% tolerance).
        reserve.setOracle(oracle, 100);
        VaultFactory factory =
            new VaultFactory(owner, oracle, allocationController, address(reserve), emergency, executionRouter);
        factory.setUsdStableAsset(usdg);
        vm.stopBroadcast();

        _export(address(reserve), address(factory), retiredReserve, retiredFactory);
        console2.log("CashbackReserve (vesting):", address(reserve));
        console2.log("VaultFactory:             ", address(factory));
        console2.log("retired reserve:          ", retiredReserve);
        console2.log("retired factory:          ", retiredFactory);
    }

    function _isVesting(address reserve) internal view returns (bool) {
        (bool ok, bytes memory ret) = reserve.staticcall(abi.encodeWithSignature("vestingPeriod()"));
        return ok && ret.length == 32;
    }

    function _export(address reserve, address factory, address retiredReserve, address retiredFactory) internal {
        string memory previous = vm.readFile(_basketsPath());

        vm.serializeAddress("contracts", "allocationController", allocationController);
        vm.serializeAddress("contracts", "cashbackReserve", reserve);
        vm.serializeAddress("contracts", "swapAdapter", swapAdapter);
        vm.serializeAddress("contracts", "executionRouter", executionRouter);
        vm.serializeAddress("contracts", "vaultFactory", factory);
        string memory contractsJson = vm.serializeAddress("contracts", "owner", owner);

        vm.serializeAddress("retired", "cashbackReserve", retiredReserve);
        string memory retiredJson = vm.serializeAddress("retired", "vaultFactory", retiredFactory);

        if (vm.keyExistsJson(previous, ".retired.vaultFactory")) {
            vm.serializeAddress("retiredV1", "cashbackReserve", vm.parseJsonAddress(previous, ".retired.cashbackReserve"));
            string memory v1Json =
                vm.serializeAddress("retiredV1", "vaultFactory", vm.parseJsonAddress(previous, ".retired.vaultFactory"));
            vm.serializeString("root", "retiredV1", v1Json);
        }

        vm.serializeUint("root", "chainId", block.chainid);
        vm.serializeAddress("root", "oracle", oracle);
        vm.serializeAddress("root", "emergency", emergency);
        vm.serializeAddress("root", "swapRouter", swapRouter);
        vm.serializeString("root", "retired", retiredJson);
        string memory out = vm.serializeString("root", "contracts", contractsJson);
        vm.writeJson(out, _basketsPath());
    }
}
