// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Subset of Uniswap V3 SwapRouter02 (no `deadline` in the single-hop params).
interface IUniswapV3SwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}
