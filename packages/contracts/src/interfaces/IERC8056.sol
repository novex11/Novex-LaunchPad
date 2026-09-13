// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC8056 {
    function uiMultiplier() external view returns (uint256);
    function balanceOfUI(address account) external view returns (uint256);
    function totalSupplyUI() external view returns (uint256);
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);

    event UIMultiplierUpdated(
        uint256 oldMultiplier,
        uint256 newMultiplier,
        uint256 effectiveAtTimestamp
    );
}
