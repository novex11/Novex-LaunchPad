// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";

/// @title MockSwapRouter — 1:1 swap for testing
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    function swap(SwapParams calldata params) external returns (uint256 amountOut) {
        amountOut = params.amountIn;
        require(amountOut >= params.minAmountOut, "MockSwapRouter: slippage");
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}
