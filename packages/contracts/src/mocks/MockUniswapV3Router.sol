// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";
import {OracleAdapter} from "../OracleAdapter.sol";

/// @title MockUniswapV3Router — SwapRouter02 stand-in for adapter tests
/// @notice Prices the path's first token against its last at the oracle, then
///         applies `lossBps` to simulate pool slippage. `lastFee` records the
///         first hop's fee tier.
contract MockUniswapV3Router is ISwapRouter02 {
    OracleAdapter public oracle;
    uint256 public lossBps;
    uint24 public lastFee;

    constructor(address oracle_) {
        oracle = OracleAdapter(oracle_);
    }

    function setLossBps(uint256 bps) external {
        lossBps = bps;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amountOut) {
        address tokenIn = address(bytes20(p.path[:20]));
        address tokenOut = address(bytes20(p.path[p.path.length - 20:]));
        lastFee = uint24(bytes3(p.path[20:23]));
        amountOut = (p.amountIn * oracle.getPrice(tokenIn)) / oracle.getPrice(tokenOut);
        amountOut = (amountOut * (10_000 - lossBps)) / 10_000;
        require(amountOut >= p.amountOutMinimum, "Too little received");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        IERC20(tokenOut).transfer(p.recipient, amountOut);
    }
}
