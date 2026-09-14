// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PushPriceFeed} from "./PushPriceFeed.sol";

/// @title PriceFeedUpdater — batches keeper price pushes into one transaction
contract PriceFeedUpdater is Ownable {
    mapping(address => bool) public keepers;

    event KeeperSet(address indexed keeper, bool allowed);

    constructor(address owner_) Ownable(owner_) {}

    function setKeeper(address keeper, bool allowed) external onlyOwner {
        keepers[keeper] = allowed;
        emit KeeperSet(keeper, allowed);
    }

    function pushPrices(address[] calldata feeds, int256[] calldata answers) external {
        require(keepers[msg.sender] || msg.sender == owner(), "PriceFeedUpdater: not keeper");
        require(feeds.length == answers.length, "PriceFeedUpdater: length mismatch");
        for (uint256 i; i < feeds.length; ++i) {
            PushPriceFeed(feeds[i]).updateAnswer(answers[i]);
        }
    }
}
