// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReceiptToken} from "./ReceiptToken.sol";
import {PairVault} from "./PairVault.sol";
import {AllocationController} from "./AllocationController.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {ExecutionRouter} from "./ExecutionRouter.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";

/// @title PairFactory — permissionless pair vault launcher
/// @notice Any wallet can launch a unique 2-token pair vault. Uniqueness is
///         enforced by the sorted (tokenA, tokenB) hash so TSLA/AAPL cannot
///         be launched twice under different orderings.
contract PairFactory is Ownable {
    uint16 public constant MIN_WEIGHT_BPS = 1_000; // 10%
    uint16 public constant MAX_WEIGHT_BPS = 9_000; // 90%
    uint16 public constant MIN_CREATOR_FEE_BPS = 100; // 1%
    uint16 public constant MAX_CREATOR_FEE_BPS = 500; // 5%
    uint16 public constant MAX_PAIRS_PER_CREATOR = 10;

    AllocationController public immutable controller;
    OracleAdapter public immutable oracle;
    ExecutionRouter public executionRouter;
    EmergencyRegistry public immutable emergency;
    address public immutable usdgAsset;

    struct PairInfo {
        address pair;
        address receiptToken;
        address tokenA;
        address tokenB;
        uint16 weightABps;
        uint16 creatorFeeBps;
        address creator;
    }

    PairInfo[] public pairs;
    mapping(bytes32 => address) public pairByKey;
    mapping(address => uint256) public pairsCreatedBy;

    event PairLaunched(
        address indexed pair,
        address indexed receiptToken,
        address indexed creator,
        address tokenA,
        address tokenB,
        uint16 weightABps,
        uint16 creatorFeeBps
    );

    constructor(
        address owner_,
        address controller_,
        address oracle_,
        address executionRouter_,
        address emergency_,
        address usdgAsset_
    ) Ownable(owner_) {
        controller = AllocationController(controller_);
        oracle = OracleAdapter(oracle_);
        executionRouter = ExecutionRouter(executionRouter_);
        emergency = EmergencyRegistry(emergency_);
        usdgAsset = usdgAsset_;
    }

    /// @notice Owner can rotate the execution router if governance updates it
    function setExecutionRouter(address router_) external onlyOwner {
        executionRouter = ExecutionRouter(router_);
    }

    // ─── Views ──────────────────────────────────────────────

    function pairCount() external view returns (uint256) {
        return pairs.length;
    }

    /// @notice Compute the uniqueness key for a pair (sorted addresses)
    function computePairKey(address tokenA, address tokenB)
        public
        pure
        returns (bytes32)
    {
        (address lo, address hi) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        return keccak256(abi.encode(lo, hi));
    }

    /// @notice Look up a launched pair by its two tokens (order-independent)
    function getPair(address tokenA, address tokenB)
        external
        view
        returns (address pair, address receiptToken)
    {
        pair = pairByKey[computePairKey(tokenA, tokenB)];
        require(pair != address(0), "PairFactory: not found");
        receiptToken = address(PairVault(pair).receiptToken());
    }

    // ─── Launch ─────────────────────────────────────────────

    struct LaunchParams {
        address tokenA;
        address tokenB;
        uint16 weightABps;
        uint16 creatorFeeBps;
        string receiptName;
        string receiptSymbol;
    }

    /// @notice Permissionless launch of a new pair. Anyone can call.
    function launchPair(
        address tokenA,
        address tokenB,
        uint16 weightABps,
        uint16 creatorFeeBps,
        string calldata receiptName,
        string calldata receiptSymbol
    ) external returns (address pair, address receipt) {
        return
            _launchPair(
                LaunchParams({
                    tokenA: tokenA,
                    tokenB: tokenB,
                    weightABps: weightABps,
                    creatorFeeBps: creatorFeeBps,
                    receiptName: receiptName,
                    receiptSymbol: receiptSymbol
                })
            );
    }

    function _launchPair(LaunchParams memory p)
        internal
        returns (address pair, address receipt)
    {
        _validate(p);
        bytes32 key = computePairKey(p.tokenA, p.tokenB);
        require(pairByKey[key] == address(0), "PairFactory: exists");

        // Sort tokens for consistent ordering (weight applies to caller's tokenA)
        (address lo, address hi) = p.tokenA < p.tokenB
            ? (p.tokenA, p.tokenB)
            : (p.tokenB, p.tokenA);
        uint16 weightLoBps = p.tokenA < p.tokenB
            ? p.weightABps
            : uint16(10_000 - p.weightABps);

        // Deploy receipt token + pair vault
        receipt = address(new ReceiptToken(p.receiptName, p.receiptSymbol, address(this)));
        pair = _deployPair(lo, hi, weightLoBps, p.creatorFeeBps, receipt);

        ReceiptToken(receipt).setVault(pair);
        pairByKey[key] = pair;
        pairsCreatedBy[msg.sender] += 1;

        pairs.push(
            PairInfo({
                pair: pair,
                receiptToken: receipt,
                tokenA: lo,
                tokenB: hi,
                weightABps: weightLoBps,
                creatorFeeBps: p.creatorFeeBps,
                creator: msg.sender
            })
        );

        _tryAuthorizeSwap(pair);

        emit PairLaunched(
            pair,
            receipt,
            msg.sender,
            lo,
            hi,
            weightLoBps,
            p.creatorFeeBps
        );
    }

    function _validate(LaunchParams memory p) internal view {
        require(p.tokenA != address(0) && p.tokenB != address(0), "PairFactory: zero token");
        require(p.tokenA != p.tokenB, "PairFactory: identical tokens");
        require(
            controller.approvedAssets(p.tokenA) && controller.approvedAssets(p.tokenB),
            "PairFactory: unapproved token"
        );
        require(
            p.weightABps >= MIN_WEIGHT_BPS && p.weightABps <= MAX_WEIGHT_BPS,
            "PairFactory: invalid weight"
        );
        require(
            p.creatorFeeBps >= MIN_CREATOR_FEE_BPS &&
                p.creatorFeeBps <= MAX_CREATOR_FEE_BPS,
            "PairFactory: invalid fee"
        );
        require(
            pairsCreatedBy[msg.sender] < MAX_PAIRS_PER_CREATOR,
            "PairFactory: creator cap"
        );
    }

    function _deployPair(
        address lo,
        address hi,
        uint16 weightLoBps,
        uint16 creatorFeeBps,
        address receipt
    ) internal returns (address pair) {
        pair = address(
            new PairVault(
                msg.sender,
                lo,
                hi,
                weightLoBps,
                creatorFeeBps,
                receipt,
                usdgAsset,
                address(oracle),
                address(executionRouter),
                address(emergency)
            )
        );
    }

    /// @dev Attempt to authorize the pair with the ExecutionRouter. Silent on
    ///      failure to keep the launch flow permissionless — the factory owner
    ///      can back-fill authorization if needed.
    function _tryAuthorizeSwap(address pair) internal {
        try executionRouter.setAuthorizedCaller(pair, true) {} catch {}
    }

    /// @notice Owner-only fallback to authorize a pair with the router if the
    ///         factory itself is not the router owner. Useful for governance
    ///         migrations.
    function authorizePair(address pair) external onlyOwner {
        executionRouter.setAuthorizedCaller(pair, true);
    }
}
