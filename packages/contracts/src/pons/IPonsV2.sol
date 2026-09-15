// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Pons v2 surface used by Compose
/// @notice Minimal ABI of the Pons v2 launch factory and bonding curve on
///         Robinhood Chain (factory 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e,
///         verified source PonsV2LaunchFactory / PonsV2BondingCurve). Struct
///         field order is part of the ABI and must not change:
///         launchToken(TokenParams,uint256,address,address[]) = 0xa72101af.
interface IPonsV2LaunchFactory {
    struct Socials {
        string twitter;
        string telegram;
        string discord;
        string website;
        string farcaster;
    }

    struct TokenParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        /// Zero waives the check; otherwise must equal previewLaunchEconomics().
        bytes32 expectedEconomics;
        /// CREATE2 salt, namespaced per launching account.
        bytes32 salt;
    }

    struct LaunchConfig {
        uint256 supply;
        uint256 curveFeeBps;
        uint256 phantomQuote;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        bool enabled;
    }

    event TokenLaunched(
        address indexed token,
        address indexed curve,
        address indexed deployer,
        address pairToken,
        uint256 launchConfigId,
        uint256 graduationThreshold
    );

    /// @notice Launch with a creator-declared list of snipe-tax-exempt wallets (max 32).
    ///         `msg.value` must equal `launchFee()`. `pairToken` is address(0) for ETH
    ///         or an approved ERC-20 (Robinhood stock tokens, USDG). The caller is the
    ///         launch's deployer and is exempt from the snipe tax, as is
    ///         `creatorFeeRecipient`.
    function launchToken(
        TokenParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        address[] calldata snipeTaxExemptions
    ) external payable returns (address token, address curve);

    function launchFee() external view returns (uint256);
    function canLaunch(address launcher) external view returns (bool);
    function launchEnabled() external view returns (bool);
    function approvedPairTokens(address pairToken) external view returns (bool);
    function maxCreatorTaxBps() external view returns (uint256);
    function launchConfigCount() external view returns (uint256);
    function getLaunchConfig(uint256 id) external view returns (LaunchConfig memory);
    function previewLaunchEconomics(uint256 launchConfigId, address pairToken) external view returns (bytes32);
    function pairTokenEconomics(address pairToken)
        external
        view
        returns (uint256 phantomQuote, uint256 graduationThreshold, uint8 decimals);
}

interface IPonsV2BondingCurve {
    event CurveBuy(
        address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax
    );
    event CurveSell(
        address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax
    );

    function token() external view returns (address);
    function pairToken() external view returns (address);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
    function phantomQuote() external view returns (uint256);
    function graduationThreshold() external view returns (uint256);
    function launchSupply() external view returns (uint256);
    function reservedTokens() external view returns (uint256);
    function graduated() external view returns (bool);
    function readyToGraduate() external view returns (bool);
    function sellableTokens() external view returns (uint256);
    /// @notice Tradeable reserves: phantom + real quote net of pending fees, and tokens held.
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function realQuoteReserve() external view returns (uint256);
    function currentSnipeTaxBps(address recipient) external view returns (uint256);

    /// @notice Buy with `quoteIn` of the quote asset (ERC-20: pulled via transferFrom;
    ///         ETH: msg.value). Fees and any snipe tax come off the quote leg. A fill
    ///         that would cross the sellable allocation is clamped and the excess
    ///         quote refunded to msg.sender; `minTokensOut` then bounds the price.
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);

    /// @notice Sell `tokensIn` back to the curve; fee and tax come off the quote output.
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
}
