// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {HookFlags} from "../../src/HookFlags.sol";

/// @notice Mines a CREATE2 salt and deploys creation code at an address carrying exactly `flags`, the same way
/// the launch deployer does. Reverts if no salt in range works.
abstract contract HookDeployer {
    function deployAtFlags(bytes memory creationCode, uint160 flags) internal returns (address at) {
        bytes32 initCodeHash = keccak256(creationCode);
        for (uint256 i = 0; i < 200_000; i++) {
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(i), initCodeHash))))
            );
            if (!HookFlags.matches(predicted, flags)) continue;

            bytes32 salt = bytes32(i);
            assembly ("memory-safe") {
                at := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
            }
            require(at != address(0), "hook deployment reverted");
            require(at == predicted, "hook landed somewhere else");
            return at;
        }
        revert("no salt produced an address carrying the declared flags");
    }
}
