// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";

/// @title ExecutionRouter — routes swaps with slippage and approved asset enforcement
contract ExecutionRouter is Ownable {
    using SafeERC20 for IERC20;

    ISwapRouter public swapRouter;
    EmergencyRegistry public emergency;
    mapping(address => bool) public approvedTokens;
    mapping(address => bool) public authorizedCallers;
    uint256 public maxSlippageBps = 50;

    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor(address owner_, address swapRouter_) Ownable(owner_) {
        swapRouter = ISwapRouter(swapRouter_);
    }

    function setEmergency(address emergency_) external onlyOwner {
        emergency = EmergencyRegistry(emergency_);
    }

    function setApprovedToken(address token, bool approved) external onlyOwner {
        approvedTokens[token] = approved;
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setMaxSlippageBps(uint256 bps) external onlyOwner {
        require(bps <= 500, "ExecutionRouter: slippage too high");
        maxSlippageBps = bps;
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        require(
            msg.sender == owner() || authorizedCallers[msg.sender],
            "ExecutionRouter: unauthorized"
        );
        if (address(emergency) != address(0)) {
            require(!emergency.swapsPaused(), "ExecutionRouter: swaps paused");
        }
        require(approvedTokens[tokenIn] && approvedTokens[tokenOut], "ExecutionRouter: unapproved");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.swap(
            ISwapRouter.SwapParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                minAmountOut: minAmountOut,
                recipient: recipient
            })
        );
        emit SwapExecuted(tokenIn, tokenOut, amountIn, amountOut);
    }
}
