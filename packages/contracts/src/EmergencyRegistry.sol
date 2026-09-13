// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title EmergencyRegistry — independent pause flags per subsystem
contract EmergencyRegistry is Ownable {
    bool public depositsPaused;
    bool public swapsPaused;
    bool public rebalancesPaused;
    bool public cashbackPaused;

    event PauseUpdated(string subsystem, bool paused);

    constructor(address owner_) Ownable(owner_) {}

    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit PauseUpdated("deposits", paused);
    }

    function setSwapsPaused(bool paused) external onlyOwner {
        swapsPaused = paused;
        emit PauseUpdated("swaps", paused);
    }

    function setRebalancesPaused(bool paused) external onlyOwner {
        rebalancesPaused = paused;
        emit PauseUpdated("rebalances", paused);
    }

    function setCashbackPaused(bool paused) external onlyOwner {
        cashbackPaused = paused;
        emit PauseUpdated("cashback", paused);
    }
}
