// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Uniswap v4 PoolKey. `currency0/1` are `Currency` (an address) and
///      `hooks` is `IHooks` (an address) in v4-core; the ABI is identical.
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

/// @title IV4PositionManager — the v4-periphery PositionManager subset we use
interface IV4PositionManager {
    /// @notice Initializes the pool if needed; does not revert when it already exists.
    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external payable returns (int24 tick);

    /// @notice Executes an encoded batch of actions (mint, settle, …).
    /// @param unlockData abi.encode(bytes actions, bytes[] params)
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;

    function nextTokenId() external view returns (uint256);
}

/// @title IPermit2 — allowance-transfer subset used to fund PositionManager
interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @dev v4-periphery `Actions` ids we encode.
library V4Actions {
    uint8 internal constant MINT_POSITION = 0x02;
    uint8 internal constant SETTLE_PAIR = 0x0d;
}
