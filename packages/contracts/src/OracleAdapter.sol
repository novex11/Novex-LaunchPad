// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {AggregatorV3Interface} from "./interfaces/IChainlink.sol";
import {IERC8056} from "./interfaces/IERC8056.sol";

/// @title OracleAdapter — Chainlink price reads with staleness checks
contract OracleAdapter is Ownable {
    uint256 public stalenessThreshold = 3600;
    mapping(address => address) public priceFeeds;

    event PriceFeedSet(address indexed token, address indexed feed);

    constructor(address owner_) Ownable(owner_) {}

    function setPriceFeed(address token, address feed) external onlyOwner {
        priceFeeds[token] = feed;
        emit PriceFeedSet(token, feed);
    }

    function setStalenessThreshold(uint256 threshold) external onlyOwner {
        stalenessThreshold = threshold;
    }

    function getPrice(address token) public view returns (uint256 priceUsd8) {
        address feed = priceFeeds[token];
        require(feed != address(0), "OracleAdapter: no feed");
        (, int256 answer, , uint256 updatedAt, ) = AggregatorV3Interface(feed)
            .latestRoundData();
        require(answer > 0, "OracleAdapter: invalid price");
        require(block.timestamp - updatedAt <= stalenessThreshold, "OracleAdapter: stale");
        return uint256(answer);
    }

    /// @notice Latest price without the staleness check. For views only (NAV,
    ///         previews) so a late keeper never breaks reads or exits.
    function getPriceUnchecked(address token) public view returns (uint256 priceUsd8) {
        address feed = priceFeeds[token];
        require(feed != address(0), "OracleAdapter: no feed");
        (, int256 answer, , , ) = AggregatorV3Interface(feed).latestRoundData();
        require(answer > 0, "OracleAdapter: invalid price");
        return uint256(answer);
    }

    function hasFeed(address token) external view returns (bool) {
        return priceFeeds[token] != address(0);
    }

    function getTokenValueUsd(
        address token,
        uint256 rawAmount
    ) external view returns (uint256 valueUsd8) {
        uint256 price = getPrice(token);
        uint8 dec = IERC20Metadata(token).decimals();
        return (rawAmount * price) / (10 ** dec);
    }

    function isMultiplierPending(address token) external view returns (bool) {
        try IERC8056(token).effectiveAt() returns (uint256 effectiveAt) {
            if (effectiveAt == 0) return false;
            uint256 newMult = IERC8056(token).newUIMultiplier();
            uint256 curMult = IERC8056(token).uiMultiplier();
            return newMult != curMult && effectiveAt > block.timestamp;
        } catch {
            return false;
        }
    }
}
