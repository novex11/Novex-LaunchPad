// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title AllocationController — validates target weights against strategy limits
contract AllocationController is Ownable {
    enum Strategy {
        Defensive,
        Balanced,
        Aggressive
    }

    struct StrategyConfig {
        uint16 maxSingleStockBps;
        bool active;
    }

    mapping(Strategy => StrategyConfig) public strategies;
    mapping(address => bool) public approvedAssets;

    event AssetApproved(address indexed token, bool approved);
    event StrategyUpdated(Strategy indexed strategy, uint16 maxSingleStockBps);

    constructor(address owner_) Ownable(owner_) {
        strategies[Strategy.Defensive] = StrategyConfig(1500, true);
        strategies[Strategy.Balanced] = StrategyConfig(2500, true);
        strategies[Strategy.Aggressive] = StrategyConfig(3500, true);
    }

    function setApprovedAsset(address token, bool approved) external onlyOwner {
        approvedAssets[token] = approved;
        emit AssetApproved(token, approved);
    }

    function validateAllocation(
        Strategy strategy,
        address[] calldata tokens,
        uint256[] calldata weightsBps
    ) external view returns (bool valid, string memory reason) {
        require(tokens.length == weightsBps.length, "AllocationController: length mismatch");
        StrategyConfig memory config = strategies[strategy];
        require(config.active, "AllocationController: strategy inactive");

        uint256 total;
        uint256 maxWeight;
        for (uint256 i; i < tokens.length; ++i) {
            require(approvedAssets[tokens[i]], "AllocationController: unapproved asset");
            total += weightsBps[i];
            if (weightsBps[i] > maxWeight) maxWeight = weightsBps[i];
        }
        require(total == 10_000, "AllocationController: weights must sum to 100%");
        if (maxWeight > config.maxSingleStockBps) {
            return (false, "Max single stock exceeded");
        }
        return (true, "");
    }
}
