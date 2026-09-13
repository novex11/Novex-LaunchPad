// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV3Router} from "../interfaces/IUniswapV3Router.sol";
import {OracleAdapter} from "../OracleAdapter.sol";

/// @title MockUniswapV3Router — deterministic test router priced by OracleAdapter
/// @notice For unit tests only. Assumes every token is 18-decimal and that the
///         oracle returns 1e8-scaled USD prices. Router must be pre-funded with
///         `tokenOut` liquidity before test cases run.
contract MockUniswapV3Router is IUniswapV3Router {
    using SafeERC20 for IERC20;

    OracleAdapter public immutable oracle;

    constructor(address oracle_) {
        oracle = OracleAdapter(oracle_);
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        returns (uint256 amountOut)
    {
        require(params.amountIn > 0, "MockV3: zero amountIn");

        uint256 priceIn = oracle.getPrice(params.tokenIn); // 1e8
        uint256 priceOut = oracle.getPrice(params.tokenOut); // 1e8

        // amountOut (18-dec) = amountIn (18-dec) * priceIn / priceOut
        amountOut = (params.amountIn * priceIn) / priceOut;
        require(amountOut >= params.amountOutMinimum, "MockV3: slippage");

        IERC20(params.tokenIn).safeTransferFrom(
            msg.sender,
            address(this),
            params.amountIn
        );
        IERC20(params.tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
