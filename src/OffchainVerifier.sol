// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

import {ERC165} from "@oz/utils/introspection/ERC165.sol";
import {ECDSA} from "@oz/utils/cryptography/ECDSA.sol";
import {
    IOffchainVerifier,
    IOffchainVerifierSigner
} from "./IOffchainVerifier.sol";

contract OffchainVerifier is ERC165, IOffchainVerifier {
    /// @inheritdoc ERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public view override returns (bool) {
        return
            interfaceId == type(IOffchainVerifier).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IOffchainVerifier
    function verifyResponse(
        bytes calldata request,
        bytes calldata response
    ) external view returns (bytes memory) {
        (bytes memory answer, uint64 expiry, bytes memory sig) = abi.decode(
            response,
            (bytes, uint64, bytes)
        );
        if (expiry < block.timestamp) {
            revert CCIPReadExpired(expiry);
        }
        /// forge-lint: disable-next-item(asm-keccak256)
        // standard "ens" offchain signing protocol
        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes2(0x1900),
                msg.sender,
                expiry,
                keccak256(request), // original calldata, eg. msg.data
                keccak256(answer) // response from server
            )
        );
        address signed = ECDSA.recover(hash, sig);
        if (!IOffchainVerifierSigner(msg.sender).isOffchainSigner(signed)) {
            revert CCIPReadUntrusted(signed);
        }
        return answer;
    }
}
