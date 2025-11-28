// SPDX-License-Identifier: MIT
pragma solidity >=0.8.13;

import {Ownable} from "@oz/access/Ownable.sol";
import {ERC165} from "@oz/utils/introspection/ERC165.sol";
import {ECDSA} from "@oz/utils/cryptography/ECDSA.sol";
import {IERC7996} from "@ens/utils/IERC7996.sol";
import {ResolverFeatures} from "@ens/resolvers/ResolverFeatures.sol";
import {IExtendedResolver} from "@ens/resolvers/profiles/IExtendedResolver.sol";
import {OffchainLookup} from "@ens/ccipRead/EIP3668.sol";
import {IGatewayProvider} from "@ens/ccipRead/IGatewayProvider.sol";

contract OffchainResolver is
    Ownable,
    ERC165,
    IExtendedResolver,
    IGatewayProvider,
    IERC7996
{
    error CCIPReadExpired(uint64 expiry);
    error CCIPReadUntrusted(address signed);
    error UnsupportedResolverProfile(bytes4 selector);

    event SignerChanged(address signer, bool enabled);
    event GatewaysChanged(string[] gateways);

    string[] _gateways;

    /// @notice The current offchain signer.
    mapping(address signer => bool enabled) public isSigner;

    constructor(
        address owner,
        address[] memory signers,
        string[] memory gateways_
    ) Ownable(owner) {
        for (uint256 i; i < signers.length; ++i) {
            address signer = signers[i];
            isSigner[signer] = true;
            emit SignerChanged(signer, true);
        }
        _gateways = gateways_;
        emit GatewaysChanged(gateways_);
    }

    /// @inheritdoc ERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public view override returns (bool) {
        return
            interfaceId == type(IExtendedResolver).interfaceId ||
            interfaceId == type(IERC7996).interfaceId ||
            interfaceId == type(IGatewayProvider).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @inheritdoc IERC7996
    function supportsFeature(bytes4 featureId) external pure returns (bool) {
        return featureId == ResolverFeatures.RESOLVE_MULTICALL;
    }

    /// @notice Set the offchain signer.
    function setSigner(address signer, bool enabled) external onlyOwner {
        require(isSigner[signer] != enabled);
        isSigner[signer] = enabled;
        emit SignerChanged(signer, enabled);
    }

    /// @notice Set the gateways.
    function setGateways(string[] memory gateways_) external onlyOwner {
        _gateways = gateways_;
        emit GatewaysChanged(gateways_);
    }

    /// @inheritdoc IGatewayProvider
    function gateways() external view returns (string[] memory) {
        return _gateways;
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
        return _verifyResponse(request, response);
    }

    /// @dev Verify `signedResponse` was signed by `signer`.
    function _verifyResponse(
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
                address(this),
                expiry,
                keccak256(request), // original calldata, eg. msg.data
                keccak256(answer) // response from server
            )
        );
        address signed = ECDSA.recover(hash, sig);
        if (!isSigner[signed]) {
            revert CCIPReadUntrusted(signed);
        }
        return answer;
    }
}
