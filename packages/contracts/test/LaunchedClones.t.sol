// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PairFactory} from "../src/PairFactory.sol";
import {PairDeployer} from "../src/PairDeployer.sol";
import {PairVault} from "../src/PairVault.sol";
import {PairShareToken} from "../src/PairShareToken.sol";
import {ComposeCurve} from "../src/ComposeCurve.sol";
import {CreatorToken} from "../src/CreatorToken.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {EmergencyRegistry} from "../src/EmergencyRegistry.sol";
import {PushPriceFeed} from "../src/PushPriceFeed.sol";
import {PriceFeedUpdater} from "../src/PriceFeedUpdater.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWRHT} from "../src/mocks/MockWRHT.sol";

/// Every contract a launch creates (PairVault, PairShareToken, CreatorToken) must be an
/// EIP-1167 minimal proxy of a single implementation. Block explorers resolve such
/// proxies to the verified implementation automatically, which is what makes every
/// launched pair and token show up verified, with its name and symbol, the moment it
/// exists — without any per-launch verification request.
contract LaunchedClonesTest is Test {
    PairFactory factory;
    PairDeployer deployer;
    ComposeCurve curve;
    OracleAdapter oracle;
    EmergencyRegistry emergency;
    PriceFeedUpdater updater;

    MockERC20 tsla;
    MockERC20 amd;
    MockWRHT weth;

    address alice = address(0xA11CE);

    function setUp() public {
        tsla = new MockERC20("Tesla", "TSLA");
        amd = new MockERC20("AMD", "AMD");
        weth = new MockWRHT();

        oracle = new OracleAdapter(address(this));
        emergency = new EmergencyRegistry(address(this));
        updater = new PriceFeedUpdater(address(this));
        oracle.setPriceFeed(address(tsla), address(new PushPriceFeed(address(this), address(updater), "TSLA / USD", 250e8)));
        oracle.setPriceFeed(address(amd), address(new PushPriceFeed(address(this), address(updater), "AMD / USD", 100e8)));
        oracle.setPriceFeed(address(weth), address(new PushPriceFeed(address(this), address(updater), "ETH / USD", 2_500e8)));

        deployer = new PairDeployer();
        factory = new PairFactory(address(this), address(oracle), address(emergency), address(weth), address(deployer));
        factory.setTokenListed(address(tsla), true);
        factory.setTokenListed(address(amd), true);
        factory.setTokenListed(address(weth), true);
        curve = new ComposeCurve(address(this), address(factory), address(this), 3_450e8);

        tsla.mint(alice, 1_000 ether);
        amd.mint(alice, 1_000 ether);
        vm.startPrank(alice);
        tsla.approve(address(factory), type(uint256).max);
        amd.approve(address(factory), type(uint256).max);
        vm.stopPrank();
    }

    function _launch() internal returns (PairVault pair, PairShareToken share) {
        vm.prank(alice);
        (address p, address r, ) = factory.launchPair(
            PairFactory.LaunchParams({
                tokenA: address(tsla),
                tokenB: address(amd),
                weightABps: 6000,
                creatorFeeBps: 0,
                receiptName: "Tesla x AMD",
                receiptSymbol: "TSAMD",
                amountA: 2.4 ether,
                amountB: 4 ether,
                minShares: 0
            })
        );
        return (PairVault(p), PairShareToken(r));
    }

    /// Runtime bytecode of an EIP-1167 minimal proxy delegating to `implementation`.
    function _minimalProxyCode(address implementation) internal pure returns (bytes memory) {
        return abi.encodePacked(
            hex"363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"
        );
    }

    // ─── Launched contracts are clones of the verified implementations ───

    function test_PairVaultAndShareTokenAreMinimalProxies() public {
        (PairVault pair, PairShareToken share) = _launch();
        assertEq(address(pair).code, _minimalProxyCode(deployer.vaultImplementation()), "vault is a clone");
        assertEq(address(share).code, _minimalProxyCode(deployer.shareTokenImplementation()), "share token is a clone");
        assertEq(address(pair).code.length, 45, "EIP-1167 runtime is 45 bytes");
    }

    function test_CreatorTokenIsMinimalProxy() public {
        (PairVault pair, PairShareToken share) = _launch();
        vm.prank(alice);
        (address token, ) = curve.createToken(address(pair), 0, 0);
        assertEq(token.code, _minimalProxyCode(curve.creatorTokenImplementation()), "creator token is a clone");
        assertEq(CreatorToken(token).name(), share.name());
        assertEq(CreatorToken(token).symbol(), share.symbol());
        assertEq(CreatorToken(token).totalSupply(), curve.TOTAL_SUPPLY());
        assertEq(CreatorToken(token).balanceOf(address(curve)), curve.TOTAL_SUPPLY());
    }

    function test_EveryLaunchSharesTheSameImplementation() public {
        (PairVault first, PairShareToken firstShare) = _launch();
        // A different token combination (each pair of tokens launches once); the ETH leg is paid in ETH.
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (address second, address secondShare, ) = factory.launchPair{value: 0.2 ether}(
            PairFactory.LaunchParams({
                tokenA: address(amd),
                tokenB: address(weth),
                weightABps: 5000,
                creatorFeeBps: 0,
                receiptName: "AMD x ETH",
                receiptSymbol: "AMDETH",
                amountA: 5 ether,
                amountB: 0.2 ether,
                minShares: 0
            })
        );
        assertEq(address(first).code, second.code, "identical proxy bytecode");
        assertEq(address(firstShare).code, secondShare.code, "identical proxy bytecode");
    }

    // ─── Clone state: name, symbol and vault config are per pair ───

    function test_CloneCarriesItsOwnIdentityAndConfig() public {
        (PairVault pair, PairShareToken share) = _launch();
        assertEq(share.name(), "Tesla x AMD");
        assertEq(share.symbol(), "TSAMD");
        assertEq(share.decimals(), 18);
        assertEq(share.owner(), address(factory));
        assertEq(share.vault(), address(pair));

        assertEq(pair.factory(), address(factory));
        assertEq(pair.creator(), alice);
        assertEq(address(pair.receiptToken()), address(share));
        assertEq(address(pair.oracle()), address(oracle));
        assertEq(address(pair.emergency()), address(emergency));
        assertEq(pair.weth(), address(weth));
        assertEq(pair.decimalsA(), 18);
        assertEq(pair.decimalsB(), 18);
        assertEq(pair.navUsd8(), 1_000e8);
        assertEq(share.balanceOf(alice), 1_000e18);
    }

    // ─── Implementations are locked and clones initialize exactly once ───

    function test_ImplementationsCannotBeInitialized() public {
        PairShareToken shareImpl = PairShareToken(deployer.shareTokenImplementation());
        vm.expectRevert("PairShareToken: initialized");
        shareImpl.initialize("x", "X", address(this));
        assertEq(shareImpl.owner(), address(deployer), "implementation stays owned by its deployer");

        PairVault vaultImpl = PairVault(deployer.vaultImplementation());
        PairVault.Config memory cfg = _config();
        vm.expectRevert("PairVault: initialized");
        vaultImpl.initialize(cfg);

        CreatorToken tokenImpl = CreatorToken(curve.creatorTokenImplementation());
        vm.expectRevert("CreatorToken: initialized");
        tokenImpl.initialize("x", "X", 1, address(this));
        assertEq(tokenImpl.totalSupply(), 0);
    }

    function test_ClonesCannotBeReinitialized() public {
        (PairVault pair, PairShareToken share) = _launch();
        vm.expectRevert("PairShareToken: initialized");
        share.initialize("Hijack", "HJK", address(this));
        PairVault.Config memory cfg = _config();
        vm.expectRevert("PairVault: initialized");
        pair.initialize(cfg);

        vm.prank(alice);
        (address token, ) = curve.createToken(address(pair), 0, 0);
        vm.expectRevert("CreatorToken: initialized");
        CreatorToken(token).initialize("Hijack", "HJK", 1, address(this));
        assertEq(CreatorToken(token).totalSupply(), curve.TOTAL_SUPPLY(), "supply unchanged");
    }

    function test_VaultInitializeRejectsZeroAddresses() public {
        PairVault fresh = PairVault(_bareVaultClone());
        PairVault.Config memory c = _config();
        c.tokenA = address(0);
        vm.expectRevert("PairVault: zero token");
        fresh.initialize(c);

        c = _config();
        c.receiptToken = address(0);
        vm.expectRevert("PairVault: zero address");
        fresh.initialize(c);
    }

    function _bareVaultClone() internal returns (address clone) {
        bytes memory code = abi.encodePacked(
            hex"3d602d80600a3d3981f3", _minimalProxyCode(deployer.vaultImplementation())
        );
        assembly {
            clone := create(0, add(code, 0x20), mload(code))
        }
        require(clone != address(0), "clone failed");
    }

    function _config() internal view returns (PairVault.Config memory) {
        return PairVault.Config({
            creator: alice,
            tokenA: address(tsla),
            tokenB: address(amd),
            weightABps: 6000,
            creatorFeeBps: 0,
            receiptToken: address(deployer.shareTokenImplementation()),
            oracle: address(oracle),
            emergency: address(emergency),
            weth: address(weth),
            factory: address(factory)
        });
    }
}
