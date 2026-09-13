// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReceiptToken} from "./ReceiptToken.sol";
import {StrategyVault} from "./StrategyVault.sol";
import {AllocationController} from "./AllocationController.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {CashbackReserve} from "./CashbackReserve.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";
import {ExecutionRouter} from "./ExecutionRouter.sol";

/// @title VaultFactory — deploys and registers strategy vaults
contract VaultFactory is Ownable {
    OracleAdapter public oracle;
    AllocationController public controller;
    CashbackReserve public cashbackReserve;
    EmergencyRegistry public emergency;
    ExecutionRouter public executionRouter;
    address public usdStableAsset;

    struct VaultInfo {
        address vault;
        address receiptToken;
        address depositAsset;
        AllocationController.Strategy strategy;
    }

    VaultInfo[] public vaults;
    mapping(bytes32 => address) public vaultByKey;

    event VaultCreated(
        address indexed vault,
        address indexed receiptToken,
        address depositAsset,
        AllocationController.Strategy strategy
    );

    constructor(
        address owner_,
        address oracle_,
        address controller_,
        address cashback_,
        address emergency_,
        address router_
    ) Ownable(owner_) {
        oracle = OracleAdapter(oracle_);
        controller = AllocationController(controller_);
        cashbackReserve = CashbackReserve(cashback_);
        emergency = EmergencyRegistry(emergency_);
        executionRouter = ExecutionRouter(router_);
    }

    function setUsdStableAsset(address token) external onlyOwner {
        usdStableAsset = token;
    }

    function getVault(
        address depositAsset,
        AllocationController.Strategy strategy
    ) external view returns (address vault, address receiptToken) {
        vault = vaultByKey[keccak256(abi.encode(depositAsset, strategy))];
        require(vault != address(0), "VaultFactory: not found");
        receiptToken = address(StrategyVault(vault).receiptToken());
    }

    function createVault(
        address depositAsset,
        AllocationController.Strategy strategy,
        string calldata receiptName,
        string calldata receiptSymbol,
        uint256 tvlCapUsd8
    ) external onlyOwner returns (address vault, address receipt) {
        bytes32 key = keccak256(abi.encode(depositAsset, strategy));
        require(vaultByKey[key] == address(0), "VaultFactory: exists");

        receipt = address(new ReceiptToken(receiptName, receiptSymbol, address(this)));

        vault = address(
            new StrategyVault(
                address(this),
                depositAsset,
                strategy,
                receipt,
                address(oracle),
                address(controller),
                address(cashbackReserve),
                address(emergency),
                address(executionRouter),
                usdStableAsset,
                tvlCapUsd8
            )
        );

        ReceiptToken(receipt).setVault(vault);
        vaultByKey[key] = vault;
        vaults.push(
            VaultInfo({
                vault: vault,
                receiptToken: receipt,
                depositAsset: depositAsset,
                strategy: strategy
            })
        );

        emit VaultCreated(vault, receipt, depositAsset, strategy);
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }
}
