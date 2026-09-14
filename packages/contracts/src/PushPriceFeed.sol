// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "./interfaces/IChainlink.sol";

/// @title PushPriceFeed — Chainlink-compatible USD price feed updated by a keeper
/// @notice Used on networks without Chainlink stock feeds (Robinhood Chain
///         testnet). A keeper pushes real market prices; consumers read it
///         through the same `latestRoundData()` interface as a Chainlink
///         aggregator, so mainnet can swap in real feeds without code changes.
contract PushPriceFeed is AggregatorV3Interface, Ownable {
    uint8 public constant decimals = 8;
    string public description;

    address public updater;
    uint80 public latestRound;
    int256 private _answer;
    uint256 private _updatedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    event UpdaterSet(address indexed updater);

    constructor(
        address owner_,
        address updater_,
        string memory description_,
        int256 initialAnswer
    ) Ownable(owner_) {
        updater = updater_;
        description = description_;
        _setAnswer(initialAnswer);
    }

    function setUpdater(address updater_) external onlyOwner {
        updater = updater_;
        emit UpdaterSet(updater_);
    }

    function updateAnswer(int256 answer) external {
        require(msg.sender == updater || msg.sender == owner(), "PushPriceFeed: not updater");
        _setAnswer(answer);
    }

    function latestAnswer() external view returns (int256) {
        return _answer;
    }

    function latestTimestamp() external view returns (uint256) {
        return _updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (latestRound, _answer, _updatedAt, _updatedAt, latestRound);
    }

    function _setAnswer(int256 answer) internal {
        require(answer > 0, "PushPriceFeed: invalid answer");
        latestRound += 1;
        _answer = answer;
        _updatedAt = block.timestamp;
        emit AnswerUpdated(answer, latestRound, block.timestamp);
    }
}
