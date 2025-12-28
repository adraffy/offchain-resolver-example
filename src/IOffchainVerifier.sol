// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

interface IOffchainVerifierSigner {
    function isOffchainSigner(address) external view returns (bool);
}

interface IOffchainVerifier {
    error CCIPReadExpired(uint64 expiry);
    error CCIPReadUntrusted(address signed);

    /// @notice Verify `response` was signed by `IOffchainVerifierSigner(msg.sender).isOffchainSigner()`.
    function verifyResponse(
        bytes calldata request,
        bytes calldata response
    ) external view returns (bytes memory);
}
