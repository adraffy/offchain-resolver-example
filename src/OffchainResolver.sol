// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

import {Ownable} from "@oz/access/Ownable.sol";
import {ERC165} from "@oz/utils/introspection/ERC165.sol";
import {IERC7996} from "@ens/utils/IERC7996.sol";
import {ResolverFeatures} from "@ens/resolvers/ResolverFeatures.sol";
import {IExtendedResolver} from "@ens/resolvers/profiles/IExtendedResolver.sol";
import {
    IVerifiableResolver
} from "@ens/resolvers/profiles/IVerifiableResolver.sol";
import {OffchainLookup} from "@ens/ccipRead/EIP3668.sol";
import {IOffchainVerifier, IOffchainVerifierSigner} from "./IOffchainVerifier.sol";

contract OffchainResolver is
    Ownable,
    ERC165,
    IExtendedResolver,
    IVerifiableResolver,
    IOffchainVerifierSigner,
    IERC7996
{
    event SignerChanged(address signer, bool enabled);
    event GatewaysChanged(string[] gateways);

    IOffchainVerifier _verifier;
    string[] _gateways;

    /// @notice Determine if `signer` is a trusted signer.
    mapping(address signer => bool enabled) public isOffchainSigner;

    constructor(
        address owner,
        IOffchainVerifier verifier,
        address[] memory signers,
        string[] memory gateways
    ) Ownable(owner) {
        _verifier = verifier;
        for (uint256 i; i < signers.length; ++i) {
            address signer = signers[i];
            isOffchainSigner[signer] = true;
            emit SignerChanged(signer, true);
        }
        if (gateways.length > 0) {
            _gateways = gateways;
            emit GatewaysChanged(gateways);
        }
    }

    /// @inheritdoc ERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public view override returns (bool) {
        return
            interfaceId == type(IExtendedResolver).interfaceId ||
            interfaceId == type(IVerifiableResolver).interfaceId ||
            interfaceId == type(IERC7996).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IERC7996
    function supportsFeature(
        bytes4 featureId
    ) external pure virtual returns (bool) {
        return featureId == ResolverFeatures.RESOLVE_MULTICALL;
    }

    /// @inheritdoc IVerifiableResolver
    function verifierMetadata(
        bytes calldata /*name*/
    ) external view returns (address verifier, string[] memory gateways) {
        return (address(_verifier), _gateways);
    }

    /// @notice Set `signer` as an trusted signer.
    function setSigner(address signer, bool enabled) external onlyOwner {
        require(isOffchainSigner[signer] != enabled);
        isOffchainSigner[signer] = enabled;
        emit SignerChanged(signer, enabled);
    }

    /// @notice Set the gateways.
    function setGateways(string[] memory gateways_) external onlyOwner {
        _gateways = gateways_;
        emit GatewaysChanged(gateways_);
    }

    /// @inheritdoc IExtendedResolver
    function resolve(
        bytes calldata /*name*/,
        bytes calldata /*data*/
    ) external view returns (bytes memory) {
        revert OffchainLookup(
            address(this),
            _gateways,
            msg.data, // forward request to offchain server
            this.resolveCallback.selector,
            msg.data // remember request since we sign over (address, expiry, request, response)
        );
    }

    /// @dev CCIP-Read callback for `resolve()`.
    function resolveCallback(
        bytes calldata response,
        bytes calldata request
    ) external view returns (bytes memory) {
        return _verifier.verifyResponse(request, response);
    }
}
