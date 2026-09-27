// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Allowlist} from "../src/Allowlist.sol";

contract AllowlistTest is Test {
    uint256 constant SUPPLY = 1_000_000_000e18;

    Allowlist token;
    address deployer = makeAddr("deployer");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        vm.prank(deployer);
        token = new Allowlist();
    }

    function test_metadata() public view {
        assertEq(token.name(), "Allowlist");
        assertEq(token.symbol(), "ALST");
        assertEq(token.decimals(), 18);
    }

    function test_mintsWholeSupplyToDeployerOnce() public view {
        assertEq(token.TOTAL_SUPPLY(), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(deployer), SUPPLY);
    }

    function test_noMintPathAfterConstruction() public {
        string[4] memory signatures = ["mint(address,uint256)", "mint(uint256)", "mint()", "transferOwnership(address)"];
        for (uint256 i = 0; i < signatures.length; i++) {
            bytes memory data = abi.encodeWithSignature(signatures[i], alice, uint256(1));
            vm.prank(deployer);
            (bool ok,) = address(token).call(data);
            assertFalse(ok, signatures[i]);
            vm.prank(alice);
            (ok,) = address(token).call(data);
            assertFalse(ok, signatures[i]);
        }
        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_transferMovesExactAmount() public {
        vm.prank(deployer);
        assertTrue(token.transfer(alice, 5e18));
        assertEq(token.balanceOf(alice), 5e18);
        assertEq(token.balanceOf(deployer), SUPPLY - 5e18);
        assertEq(token.totalSupply(), SUPPLY);
    }

    function test_transferRevertsWithoutBalance() public {
        vm.prank(alice);
        vm.expectRevert();
        token.transfer(bob, 1);
    }

    function test_transferFromNeedsAllowance() public {
        vm.prank(deployer);
        token.transfer(alice, 10e18);

        vm.prank(bob);
        vm.expectRevert();
        token.transferFrom(alice, bob, 1e18);

        vm.prank(alice);
        token.approve(bob, 1e18);
        vm.prank(bob);
        assertTrue(token.transferFrom(alice, bob, 1e18));
        assertEq(token.balanceOf(bob), 1e18);
        assertEq(token.allowance(alice, bob), 0);
    }

    function testFuzz_transferConservesSupply(uint256 amount) public {
        amount = bound(amount, 0, SUPPLY);
        vm.prank(deployer);
        token.transfer(alice, amount);
        assertEq(token.balanceOf(alice) + token.balanceOf(deployer), SUPPLY);
        assertEq(token.totalSupply(), SUPPLY);
    }
}
