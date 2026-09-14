// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";
import {OracleAdapter} from "../OracleAdapter.sol";

/// @title MockSwapRouter — oracle-priced swap for testing
/// @notice Computes amountOut using oracle prices so tests with oracle-guarded
///         minOut (e.g. PairVault redeem) receive realistic outputs.
///         Pre-fund the router with target tokens before use.
contract MockSwapRouter is ISwapRouter {
    using SafeERC20 for IERC20;

    OracleAdapter public oracle;

    constructor() {}

    /// @dev Optional: attach oracle for price-aware swaps.
    ///      If no oracle is set, falls back to 1:1 raw-amount swap.
    function setOracle(address oracle_) external {
        oracle = OracleAdapter(oracle_);
    }

    function swap(SwapParams calldata params) external returns (uint256 amountOut) {
        if (address(oracle) != address(0)) {
            uint256 priceIn = oracle.getPrice(params.tokenIn);
            uint256 priceOut = oracle.getPrice(params.tokenOut);
            amountOut = (params.amountIn * priceIn) / priceOut;
        } else {
            amountOut = params.amountIn;
        }
        require(amountOut >= params.minAmountOut, "MockSwapRouter: slippage");
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}
