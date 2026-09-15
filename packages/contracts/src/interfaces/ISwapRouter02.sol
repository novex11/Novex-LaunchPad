// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISwapRouter02 — the Uniswap v3 SwapRouter02 `exactInput` subset
/// @notice Path encoding: tokenIn (20 bytes) | fee (3 bytes) | token (20 bytes) ...
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
