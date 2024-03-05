// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

import { Criteria } from "./Structs.sol";
import { InvalidCriteria } from "./Errors.sol";

/**
 * @title Kettle Collateral Verification
 * @author diamondjim.eth
 * @notice Verifies token matches identifier or proof of identifier
 */
contract CollateralVerifier {
    
    /**
     * @dev Internal function to verify collateral information based on specified criteria.
     *
     * @param criteria The criteria for verifying collateral information (PROOF or SIMPLE).
     * @param identifier The identifier associated with the collateral (could be an NFT token ID or another identifier).
     * @param tokenId The unique identifier of the asset token.
     * @param proof An array of Merkle proof elements (used when criteria is set to PROOF).
     *
     * Requirements:
     * - If criteria is PROOF, the provided Merkle proof must be valid for the given identifier and asset token ID.
     * - If criteria is SIMPLE, the asset token ID must match the specified identifier.
     *
     * @dev throws InvalidCriteria if the collateral verification fails based on the specified criteria.
     */
    function _verifyCollateral(
        Criteria criteria,
        uint256 identifier,
        uint256 tokenId,
        bytes32[] calldata proof
    ) internal pure {
        if (criteria == Criteria.PROOF) {
            if (
                proof.length == 0 
                || !MerkleProof.verifyCalldata(proof, bytes32(identifier), keccak256(abi.encode(bytes32(tokenId))))
            ) {
                revert InvalidCriteria();
            }
        } else {
            if (!(tokenId == identifier)) {
                revert InvalidCriteria();
            }
        }
    }
}
