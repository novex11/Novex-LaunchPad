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

    /// @param targetTokens     Fixed basket every deposit is swapped into.
    /// @param targetWeightsBps Weights in bps (sum 10 000), validated by the controller.
    struct CreateParams {
        address depositAsset;
        AllocationController.Strategy strategy;
        string receiptName;
        string receiptSymbol;
        uint256 tvlCapUsd8;
        address[] targetTokens;
        uint256[] targetWeightsBps;
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

    /// @notice Update the TVL cap of a vault this factory owns.
    function setVaultTvlCap(address vault, uint256 tvlCapUsd8) external onlyOwner {
        StrategyVault(vault).setTvlCapUsd8(tvlCapUsd8);
    }

    /// @notice Replace the target mix of a vault this factory owns.
    function setVaultTargetMix(
        address vault,
        address[] calldata tokens,
        uint256[] calldata weightsBps
    ) external onlyOwner {
        StrategyVault(vault).setTargetMix(tokens, weightsBps);
    }

    function getVault(
        address depositAsset,
        AllocationController.Strategy strategy
    ) external view returns (address vault, address receiptToken) {
        vault = vaultByKey[keccak256(abi.encode(depositAsset, strategy))];
        require(vault != address(0), "VaultFactory: not found");
        receiptToken = address(StrategyVault(vault).receiptToken());
    }

    /// @notice Deploy a receipt token + StrategyVault for one deposit asset and
    ///         strategy, with its fixed target mix set atomically.
    function createVault(CreateParams calldata p) external onlyOwner returns (address vault, address receipt) {
        bytes32 key = keccak256(abi.encode(p.depositAsset, p.strategy));
        require(vaultByKey[key] == address(0), "VaultFactory: exists");

        receipt = address(new ReceiptToken(p.receiptName, p.receiptSymbol, address(this)));
        vault = _deployVault(p.depositAsset, p.strategy, receipt, p.tvlCapUsd8);

        ReceiptToken(receipt).setVault(vault);
        StrategyVault(vault).setTargetMix(p.targetTokens, p.targetWeightsBps);
        vaultByKey[key] = vault;
        vaults.push(
            VaultInfo({
                vault: vault,
                receiptToken: receipt,
                depositAsset: p.depositAsset,
                strategy: p.strategy
            })
        );

        emit VaultCreated(vault, receipt, p.depositAsset, p.strategy);
    }

    function vaultCount() external view returns (uint256) {
        return vaults.length;
    }

    /// @dev Split out of createVault to keep its stack shallow.
    function _deployVault(
        address depositAsset,
        AllocationController.Strategy strategy,
        address receipt,
        uint256 tvlCapUsd8
    ) internal returns (address) {
        return address(
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
    }
}
