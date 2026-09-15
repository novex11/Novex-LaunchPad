// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";

/// @title UniswapV3SwapAdapter — ISwapRouter venue backed by Uniswap V3 SwapRouter02
/// @notice The ExecutionRouter approves this adapter and calls `swap`; the adapter
///         pulls `amountIn`, routes it through SwapRouter02 `exactInput` and
///         delivers the output to `recipient`. Routing per pair:
///           1. an explicit multi-hop path set with `setPairPath` (tokenIn → … → tokenOut),
///           2. otherwise a single hop through the pool fee tier from `setPairFee`,
///           3. otherwise a single hop through `defaultFee` (0.30%).
///         Most tokenized stocks on Robinhood Chain only have USDG pools, so
///         stock → USDG → stock two-hop paths are the common override.
///         Only authorized callers may swap so the adapter can never be used
///         to move third-party allowances.
contract UniswapV3SwapAdapter is ISwapRouter, Ownable {
    using SafeERC20 for IERC20;

    ISwapRouter02 public immutable uniswapRouter;
    uint24 public defaultFee = 3000;
    mapping(address => bool) public authorizedCallers;
    /// @dev keccak256(sorted tokenA, tokenB) → fee tier override (0 = use default)
    mapping(bytes32 => uint24) public pairFee;
    /// @dev keccak256(tokenIn, tokenOut) (directional) → full SwapRouter02 path override
    mapping(bytes32 => bytes) public pairPath;

    event AuthorizedCallerSet(address indexed caller, bool authorized);
    event DefaultFeeSet(uint24 fee);
    event PairFeeSet(address indexed tokenA, address indexed tokenB, uint24 fee);
    event PairPathSet(address indexed tokenIn, address indexed tokenOut, bytes path);
    event Swapped(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, address recipient);

    constructor(address owner_, address uniswapRouter_) Ownable(owner_) {
        require(uniswapRouter_ != address(0), "UniswapV3SwapAdapter: zero router");
        uniswapRouter = ISwapRouter02(uniswapRouter_);
    }

    // ─── Admin ──────────────────────────────────────────────

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
        emit AuthorizedCallerSet(caller, authorized);
    }

    function setDefaultFee(uint24 fee) external onlyOwner {
        require(_validFee(fee), "UniswapV3SwapAdapter: bad fee");
        defaultFee = fee;
        emit DefaultFeeSet(fee);
    }

    /// @param fee Pool fee tier for the pair in either direction; 0 clears the override.
    function setPairFee(address tokenA, address tokenB, uint24 fee) external onlyOwner {
        require(fee == 0 || _validFee(fee), "UniswapV3SwapAdapter: bad fee");
        pairFee[_pairKey(tokenA, tokenB)] = fee;
        emit PairFeeSet(tokenA, tokenB, fee);
    }

    /// @param path SwapRouter02 path `tokenIn | fee | token | fee | … | tokenOut`; empty clears the override.
    function setPairPath(address tokenIn, address tokenOut, bytes calldata path) external onlyOwner {
        if (path.length != 0) {
            require(path.length >= 43 && (path.length - 20) % 23 == 0, "UniswapV3SwapAdapter: bad path");
            require(address(bytes20(path[:20])) == tokenIn, "UniswapV3SwapAdapter: path tokenIn");
            require(address(bytes20(path[path.length - 20:])) == tokenOut, "UniswapV3SwapAdapter: path tokenOut");
            for (uint256 i = 20; i < path.length; i += 23) {
                require(_validFee(uint24(bytes3(path[i:i + 3]))), "UniswapV3SwapAdapter: path fee");
            }
        }
        pairPath[_pathKey(tokenIn, tokenOut)] = path;
        emit PairPathSet(tokenIn, tokenOut, path);
    }

    // ─── Views ──────────────────────────────────────────────

    function feeFor(address tokenA, address tokenB) public view returns (uint24) {
        uint24 fee = pairFee[_pairKey(tokenA, tokenB)];
        return fee == 0 ? defaultFee : fee;
    }

    /// @notice Path `swap` will route `tokenIn → tokenOut` through.
    function pathFor(address tokenIn, address tokenOut) public view returns (bytes memory) {
        bytes memory path = pairPath[_pathKey(tokenIn, tokenOut)];
        if (path.length != 0) return path;
        return abi.encodePacked(tokenIn, feeFor(tokenIn, tokenOut), tokenOut);
    }

    // ─── Swap ───────────────────────────────────────────────

    function swap(SwapParams calldata params) external override returns (uint256 amountOut) {
        require(authorizedCallers[msg.sender], "UniswapV3SwapAdapter: unauthorized");
        require(params.recipient != address(0), "UniswapV3SwapAdapter: zero recipient");
        require(params.tokenIn != params.tokenOut, "UniswapV3SwapAdapter: same token");
        require(params.amountIn > 0, "UniswapV3SwapAdapter: zero amount");

        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(params.tokenIn).forceApprove(address(uniswapRouter), params.amountIn);

        amountOut = uniswapRouter.exactInput(
            ISwapRouter02.ExactInputParams({
                path: pathFor(params.tokenIn, params.tokenOut),
                recipient: params.recipient,
                amountIn: params.amountIn,
                amountOutMinimum: params.minAmountOut
            })
        );
        require(amountOut >= params.minAmountOut, "UniswapV3SwapAdapter: slippage");
        emit Swapped(params.tokenIn, params.tokenOut, params.amountIn, amountOut, params.recipient);
    }

    // ─── Internal ───────────────────────────────────────────

    function _pairKey(address a, address b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _pathKey(address tokenIn, address tokenOut) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut));
    }

    function _validFee(uint24 fee) internal pure returns (bool) {
        return fee == 100 || fee == 500 || fee == 3000 || fee == 10000;
    }
}
