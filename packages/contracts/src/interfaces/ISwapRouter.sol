// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISwapRouter {
    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
    }

    function swap(SwapParams calldata params) external returns (uint256 amountOut);
}
