// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/IChainlink.sol";

contract MockOracle is AggregatorV3Interface {
    int256 public price;
    uint256 public updatedAt;

    constructor(int256 price_) {
        price = price_;
        updatedAt = block.timestamp;
    }

    function setPrice(int256 price_) external {
        price = price_;
        updatedAt = block.timestamp;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt_,
            uint80 answeredInRound
        )
    {
        return (1, price, block.timestamp, updatedAt, 1);
    }
}
