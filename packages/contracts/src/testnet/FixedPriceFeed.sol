// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/IChainlink.sol";

/// @title FixedPriceFeed — TESTNET ONLY constant USD price (e.g. TestUSDG at $1)
/// @notice Always reports as fresh, so it never trips the oracle staleness check.
contract FixedPriceFeed is AggregatorV3Interface {
    uint8 public constant decimals = 8;
    string public description;
    int256 public immutable price;

    constructor(string memory description_, int256 price_) {
        require(price_ > 0, "FixedPriceFeed: invalid price");
        description = description_;
        price = price_;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}
