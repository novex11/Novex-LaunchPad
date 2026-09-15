// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {IUniswapV3SwapRouter02} from "./interfaces/IUniswapV3SwapRouter02.sol";

/// @title UniswapV3SwapAdapter — ISwapRouter venue backed by Uniswap V3 SwapRouter02
/// @notice The ExecutionRouter approves this adapter and calls `swap`; the adapter
///         pulls `amountIn`, routes a single-hop exactInputSingle through the pool
///         fee tier configured for the pair (default 0.30%) and delivers output to
///         `recipient`. Only authorized callers may swap so the adapter can never be
///         used to move third-party allowances.
contract UniswapV3SwapAdapter is ISwapRouter, Ownable {
    using SafeERC20 for IERC20;

    IUniswapV3SwapRouter02 public immutable uniswapRouter;
    uint24 public defaultFee = 3000;
    mapping(address => bool) public authorizedCallers;
    /// @dev keccak256(tokenA, tokenB) sorted → fee tier override (0 = use default)
    mapping(bytes32 => uint24) public pairFee;

    event AuthorizedCallerSet(address indexed caller, bool authorized);
    event DefaultFeeSet(uint24 fee);
    event PairFeeSet(address indexed tokenA, address indexed tokenB, uint24 fee);

    constructor(address owner_, address uniswapRouter_) Ownable(owner_) {
        require(uniswapRouter_ != address(0), "UniswapV3SwapAdapter: zero router");
        uniswapRouter = IUniswapV3SwapRouter02(uniswapRouter_);
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    function setDefaultFee(uint24 fee) external onlyOwner {
        require(_validFee(fee), "UniswapV3SwapAdapter: bad fee");
        defaultFee = fee;
        emit DefaultFeeSet(fee);
    }

    function setPairFee(address tokenA, address tokenB, uint24 fee) external onlyOwner {
        require(fee == 0 || _validFee(fee), "UniswapV3SwapAdapter: bad fee");
        pairFee[_pairKey(tokenA, tokenB)] = fee;
        emit PairFeeSet(tokenA, tokenB, fee);
    }

    function feeFor(address tokenA, address tokenB) public view returns (uint24) {
        uint24 fee = pairFee[_pairKey(tokenA, tokenB)];
        return fee == 0 ? defaultFee : fee;
    }

    function swap(SwapParams calldata params) external override returns (uint256 amountOut) {
        require(authorizedCallers[msg.sender], "UniswapV3SwapAdapter: unauthorized");
        require(params.recipient != address(0), "UniswapV3SwapAdapter: zero recipient");

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenIn).forceApprove(address(uniswapRouter), params.amountIn);

        amountOut = uniswapRouter.exactInputSingle(
            IUniswapV3SwapRouter02.ExactInputSingleParams({
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                fee: feeFor(params.tokenIn, params.tokenOut),
                recipient: params.recipient,
                amountIn: params.amountIn,
                amountOutMinimum: params.minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
        require(amountOut >= params.minAmountOut, "UniswapV3SwapAdapter: slippage");
    }

    function _pairKey(address a, address b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _validFee(uint24 fee) internal pure returns (bool) {
        return fee == 100 || fee == 500 || fee == 3000 || fee == 10000;
    }
}
