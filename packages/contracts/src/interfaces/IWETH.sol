// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IWETH — canonical wrapped native ETH
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}
