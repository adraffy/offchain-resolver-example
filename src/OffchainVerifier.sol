// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

import {ERC165} from "@oz/utils/introspection/ERC165.sol";
import {ECDSA} from "@oz/utils/cryptography/ECDSA.sol";
import {
    IOffchainVerifier,
    IOffchainVerifierSigner
} from "./IOffchainVerifier.sol";

contract OffchainVerifier is IOffchainVerifier {
    function verifyResponse(
        bytes memory request,
        bytes calldata response
    ) internal view returns (bytes memory) {
        (bytes memory answer, uint64 expiry, bytes memory sig) = abi.decode(
            response,
            (bytes, uint64, bytes)
        );
        if (expiry < block.timestamp) {
            revert CCIPReadExpired(expiry);
        }
        // standard "ens" offchain signing protocol
        bytes32 hash = keccak256(
            abi.encodePacked(
                hex"1900",
                address(msg.sender),
                expiry,
                keccak256(request), // original calldata, eg. msg.data
                keccak256(answer) // response from server
            )
        );
        address signed = ECDSA.recover(hash, sig);
        if (!IOffchainVerifierSigner(msg.sender).isTrusedSigner(signed)) {
            revert CCIPReadUntrusted(signed);
        }
        return answer;
    }
}
