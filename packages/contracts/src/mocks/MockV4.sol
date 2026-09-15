// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolKey, IV4PositionManager, IPermit2, V4Actions} from "../interfaces/IUniswapV4.sol";

/// @dev Minimal Permit2 stand-in: `approve` records an allowance and
///      `transferFrom` moves tokens using the ERC-20 approval the payer gave
///      this contract. Test / testnet only.
contract MockPermit2 is IPermit2 {
    using SafeERC20 for IERC20;

    mapping(address => mapping(address => mapping(address => uint160))) public allowance; // owner => token => spender

    function approve(address token, address spender, uint160 amount, uint48) external {
        allowance[msg.sender][token][spender] = amount;
    }

    function transferFrom(address from, address to, uint160 amount, address token) external {
        uint160 allowed = allowance[from][token][msg.sender];
        require(allowed >= amount, "MockPermit2: allowance");
        allowance[from][token][msg.sender] = allowed - amount;
        IERC20(token).safeTransferFrom(from, to, amount);
    }
}

/// @title MockV4PositionManager — Uniswap v4 PositionManager stand-in
/// @notice Records initialized pools, decodes MINT_POSITION + SETTLE_PAIR,
///         pulls the max amounts through MockPermit2 into a per-pool holding
///         address, and hands out sequential position ids. Robinhood Chain
///         testnet has no v4 deployment, so this also backs the testnet
///         pool-seeding switch.
contract MockV4PositionManager is IV4PositionManager {
    using SafeERC20 for IERC20;

    MockPermit2 public immutable permit2;
    uint256 public nextTokenId = 1;
    mapping(bytes32 => uint160) public sqrtPriceOf; // poolId => initial price
    mapping(bytes32 => address) public holdingOf; // poolId => where liquidity sits
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => bytes32) public poolOfPosition;
    mapping(uint256 => uint256) public liquidityOf;

    constructor(MockPermit2 permit2_) {
        permit2 = permit2_;
    }

    function poolId(PoolKey memory key) public pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function initializePool(PoolKey calldata key, uint160 sqrtPriceX96) external payable returns (int24) {
        require(key.currency0 < key.currency1, "MockV4PM: unsorted");
        bytes32 id = poolId(key);
        if (sqrtPriceOf[id] == 0) {
            sqrtPriceOf[id] = sqrtPriceX96;
            holdingOf[id] = address(new PoolHolding());
        }
        return 0;
    }

    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable {
        require(block.timestamp <= deadline, "MockV4PM: expired");
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        require(actions.length == params.length, "MockV4PM: length");
        for (uint256 i; i < actions.length; ++i) {
            uint8 action = uint8(actions[i]);
            if (action == V4Actions.MINT_POSITION) {
                (PoolKey memory key, int24 tl, int24 tu, uint256 liquidity, uint128 max0, uint128 max1, address owner, ) =
                    abi.decode(params[i], (PoolKey, int24, int24, uint256, uint128, uint128, address, bytes));
                require(tl < tu, "MockV4PM: ticks");
                bytes32 id = poolId(key);
                require(sqrtPriceOf[id] != 0, "MockV4PM: pool not initialized");
                address holding = holdingOf[id];
                if (max0 > 0) permit2.transferFrom(msg.sender, holding, max0, key.currency0);
                if (max1 > 0) permit2.transferFrom(msg.sender, holding, max1, key.currency1);
                uint256 tokenId = nextTokenId++;
                ownerOf[tokenId] = owner;
                poolOfPosition[tokenId] = id;
                liquidityOf[tokenId] = liquidity;
            } else if (action == V4Actions.SETTLE_PAIR) {
                // amounts were pulled during MINT_POSITION; nothing to settle
            } else {
                revert("MockV4PM: unsupported action");
            }
        }
    }
}

/// @dev Holds a mock pool's tokens so balances can be asserted in tests.
contract PoolHolding {}
