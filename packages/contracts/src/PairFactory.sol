// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ReceiptToken} from "./ReceiptToken.sol";
import {PairVault} from "./PairVault.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";
import {IWETH} from "./interfaces/IWETH.sol";

/// @title PairFactory — permissionless launcher for two-token pair vaults
/// @notice Any wallet can pair any two tokens the owner has listed. A launch
///         deploys the vault and seeds it with the creator's tokens in the same
///         transaction. Uniqueness is enforced on the sorted (tokenA, tokenB).
contract PairFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MIN_WEIGHT_BPS = 1_000; // 10%
    uint16 public constant MAX_WEIGHT_BPS = 9_000; // 90%
    uint16 public constant MIN_CREATOR_FEE_BPS = 100; // 1%
    uint16 public constant MAX_CREATOR_FEE_BPS = 500; // 5%
    uint16 public constant MAX_PAIRS_PER_CREATOR = 10;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_SYMBOL_LENGTH = 16;

    OracleAdapter public immutable oracle;
    EmergencyRegistry public immutable emergency;
    address public immutable weth;

    struct PairInfo {
        address pair;
        address receiptToken;
        address tokenA;
        address tokenB;
        uint16 weightABps;
        uint16 creatorFeeBps;
        address creator;
    }

    /// @param tokenA        Either token; order does not matter
    /// @param weightABps    Target value share of `tokenA`
    /// @param amountA       Seed amount of `tokenA` (for a WETH leg, send the same wei as msg.value to pay in ETH)
    /// @param minShares     Slippage guard on the creator's seed shares
    struct LaunchParams {
        address tokenA;
        address tokenB;
        uint16 weightABps;
        uint16 creatorFeeBps;
        string receiptName;
        string receiptSymbol;
        uint256 amountA;
        uint256 amountB;
        uint256 minShares;
    }

    mapping(address => bool) public isListed;
    address[] private _knownTokens;
    mapping(address => bool) private _known;

    PairInfo[] public pairs;
    mapping(bytes32 => address) public pairByKey;
    mapping(address => uint256) public pairsCreatedBy;
    mapping(address => bool) public isPair;

    event PairLaunched(
        address indexed pair,
        address indexed receiptToken,
        address indexed creator,
        address tokenA,
        address tokenB,
        uint16 weightABps,
        uint16 creatorFeeBps
    );
    event TokenListed(address indexed token, bool listed);

    constructor(address owner_, address oracle_, address emergency_, address weth_) Ownable(owner_) {
        oracle = OracleAdapter(oracle_);
        emergency = EmergencyRegistry(emergency_);
        weth = weth_;
    }

    // ─── Token listing ──────────────────────────────────────

    function setTokenListed(address token, bool listed) external onlyOwner {
        require(token != address(0), "PairFactory: zero token");
        if (listed) {
            require(oracle.hasFeed(token), "PairFactory: no price feed");
        }
        isListed[token] = listed;
        if (!_known[token]) {
            _known[token] = true;
            _knownTokens.push(token);
        }
        emit TokenListed(token, listed);
    }

    function listedTokens() external view returns (address[] memory out) {
        uint256 n;
        for (uint256 i; i < _knownTokens.length; ++i) {
            if (isListed[_knownTokens[i]]) ++n;
        }
        out = new address[](n);
        uint256 j;
        for (uint256 i; i < _knownTokens.length; ++i) {
            if (isListed[_knownTokens[i]]) out[j++] = _knownTokens[i];
        }
    }

    // ─── Views ──────────────────────────────────────────────

    function pairCount() external view returns (uint256) {
        return pairs.length;
    }

    function computePairKey(address tokenA, address tokenB) public pure returns (bytes32) {
        (address lo, address hi) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(lo, hi));
    }

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

    function launchPair(LaunchParams calldata p)
        external
        payable
        nonReentrant
        returns (address pair, address receipt, uint256 shares)
    {
        _validate(p);
        bytes32 key = computePairKey(p.tokenA, p.tokenB);
        require(pairByKey[key] == address(0), "PairFactory: exists");

        (pair, receipt) = _deploy(p);
        pairByKey[key] = pair;
        isPair[pair] = true;
        pairsCreatedBy[msg.sender] += 1;

        shares = _seed(p, pair);
    }

    function _validate(LaunchParams calldata p) internal view {
        require(p.tokenA != address(0) && p.tokenB != address(0), "PairFactory: zero token");
        require(p.tokenA != p.tokenB, "PairFactory: identical tokens");
        require(isListed[p.tokenA] && isListed[p.tokenB], "PairFactory: unlisted token");
        require(
            p.weightABps >= MIN_WEIGHT_BPS && p.weightABps <= MAX_WEIGHT_BPS,
            "PairFactory: invalid weight"
        );
        require(
            p.creatorFeeBps >= MIN_CREATOR_FEE_BPS && p.creatorFeeBps <= MAX_CREATOR_FEE_BPS,
            "PairFactory: invalid fee"
        );
        uint256 nameLen = bytes(p.receiptName).length;
        uint256 symbolLen = bytes(p.receiptSymbol).length;
        require(nameLen > 0 && nameLen <= MAX_NAME_LENGTH, "PairFactory: invalid name");
        require(symbolLen > 0 && symbolLen <= MAX_SYMBOL_LENGTH, "PairFactory: invalid symbol");
        require(pairsCreatedBy[msg.sender] < MAX_PAIRS_PER_CREATOR, "PairFactory: creator cap");
        if (msg.value > 0) {
            require(
                weth != address(0) && (p.tokenA == weth || p.tokenB == weth),
                "PairFactory: ETH not accepted"
            );
        }
    }

    function _deploy(LaunchParams calldata p) internal returns (address pair, address receipt) {
        bool ordered = p.tokenA < p.tokenB;
        address lo = ordered ? p.tokenA : p.tokenB;
        address hi = ordered ? p.tokenB : p.tokenA;
        uint16 weightLo = ordered ? p.weightABps : uint16(10_000 - p.weightABps);

        receipt = address(new ReceiptToken(p.receiptName, p.receiptSymbol, address(this)));
        pair = address(
            new PairVault(
                PairVault.Config({
                    creator: msg.sender,
                    tokenA: lo,
                    tokenB: hi,
                    weightABps: weightLo,
                    creatorFeeBps: p.creatorFeeBps,
                    receiptToken: receipt,
                    oracle: address(oracle),
                    emergency: address(emergency),
                    weth: weth
                })
            )
        );
        ReceiptToken(receipt).setVault(pair);

        pairs.push(
            PairInfo({
                pair: pair,
                receiptToken: receipt,
                tokenA: lo,
                tokenB: hi,
                weightABps: weightLo,
                creatorFeeBps: p.creatorFeeBps,
                creator: msg.sender
            })
        );

        emit PairLaunched(pair, receipt, msg.sender, lo, hi, weightLo, p.creatorFeeBps);
    }

    function _seed(LaunchParams calldata p, address pair) internal returns (uint256 shares) {
        PairVault vault = PairVault(pair);
        address lo = vault.tokenA();
        address hi = vault.tokenB();
        uint256 amountLo = lo == p.tokenA ? p.amountA : p.amountB;
        uint256 amountHi = lo == p.tokenA ? p.amountB : p.amountA;

        uint256 nativeUsed = _collect(lo, amountLo, pair) + _collect(hi, amountHi, pair);
        require(msg.value == nativeUsed, "PairFactory: ETH amount mismatch");

        shares = vault.depositFor(msg.sender, amountLo, amountHi, p.minShares);
    }

    /// @dev Moves the creator's seed into the factory and approves the vault.
    function _collect(address token, uint256 amount, address pair) internal returns (uint256 nativeUsed) {
        if (token == weth && msg.value > 0) {
            IWETH(weth).deposit{value: amount}();
            nativeUsed = amount;
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
        IERC20(token).forceApprove(pair, amount);
    }
}
