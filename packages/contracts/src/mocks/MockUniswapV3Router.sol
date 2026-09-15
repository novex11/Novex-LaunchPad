// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3SwapRouter02} from "../interfaces/IUniswapV3SwapRouter02.sol";
import {OracleAdapter} from "../OracleAdapter.sol";

/// @title MockUniswapV3Router — SwapRouter02 stand-in for adapter tests
/// @notice Prices at the oracle, then applies `lossBps` to simulate pool slippage.
contract MockUniswapV3Router is IUniswapV3SwapRouter02 {
    OracleAdapter public oracle;
    uint256 public lossBps;
    uint24 public lastFee;

    constructor(address oracle_) {
        oracle = OracleAdapter(oracle_);
    }

    function setLossBps(uint256 bps) external {
        lossBps = bps;
    }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        lastFee = p.fee;
        uint256 priceIn = oracle.getPrice(p.tokenIn);
        uint256 priceOut = oracle.getPrice(p.tokenOut);
        amountOut = (p.amountIn * priceIn) / priceOut;
        amountOut = (amountOut * (10_000 - lossBps)) / 10_000;
        require(amountOut >= p.amountOutMinimum, "Too little received");
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        IERC20(p.tokenOut).transfer(p.recipient, amountOut);
    }
}
